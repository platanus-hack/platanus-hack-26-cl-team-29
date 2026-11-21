// La sesión del portal web del SII, una sola para todo lo que lo toca (ficha de la empresa, resolución, CAF).
// Reglas que aplica (detalle y fuentes en docs/hallazgos, reglas del portal del SII):
// - Cada login cuenta contra un cupo de sesiones por RUT. Al pasarlo, el SII responde "superado el máximo de
//   sesiones" (código ...720) y bloquea por 30 a más de 60 minutos; cerrar sesión no libera el cupo. Por eso:
//   un solo login por certificado (candado), la sesión se guarda y se reutiliza (almacén compartido, cifrado), y
//   ante el 720 no se reintenta: se anota una espera que todas las instancias respetan sin conectar.
// - Antes de reutilizar una sesión guardada se compara la huella del certificado y el RUT del titular.
// - Sesión vencida (el SII redirige al login): se descarta y se hace UN login nuevo; si vuelve a fallar, se informa.
//   Un trabajo que escribe en el SII no se repite solo.
// - Solo se reintenta lo que nunca llegó al SII (DNS, conexión rechazada, handshake). Una respuesta del SII no se
//   reintenta nunca como si fuera red.
// - Las solicitudes de una sesión van en serie (candado por certificado) y todo pasa por un limitador global.
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { abrirCertificado } from '../sii/index.ts';
import type { AlmacenSesiones, RegistroSesion } from './almacen.ts';
import type { Candado } from './candado.ts';
import { ErrorPortal, esErrorPortal } from './errores.ts';
import { alertas, normalizar, textoVisible } from './html.ts';
import {
  cabecerasNavegador, cabecerasXhr, codificarFormulario, ErrorTransporte, httpNode, redactar, tieneSesion, unirCookies,
  type CredencialTls, type Http, type RespuestaHttp,
} from './http.ts';
import { CODIGO_AUTENTICACION, detectarRechazo } from './rechazo.ts';
import { crearLimitador, relojReal, type Limitador, type Reloj } from './ritmo.ts';

const DESTINO_LOGIN = 'https://misiir.sii.cl/cgi_misii/siihome.cgi';
const INGRESO = `https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html?${DESTINO_LOGIN}`;
const AUTENTICACION = `https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?${DESTINO_LOGIN}`;
/** Espera tras el límite de sesiones. Medido: el cupo se liberó entre 25 y 85 minutos después; 35 no siempre basta. */
export const ESPERA_LIMITE_MS = 45 * 60_000;
/** Reintentos de transporte (solo lo que no llegó al SII): 1 s y 2 s. */
const ESPERAS_TRANSPORTE_MS = [1000, 2000];

export interface CertificadoPortal {
  pfx: Buffer;
  clave: string;
}

export interface Credencial {
  /** SHA-256 del certificado (DER), en hex. */
  huella: string;
  rutTitular: string;
  tls: CredencialTls;
}

/** Hoja, cadena y llave del .pfx en PEM, más la huella y el RUT del titular. */
export function credencialDe(certificado: CertificadoPortal): Credencial {
  const abierto = abrirCertificado(certificado.pfx, certificado.clave);
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(certificado.pfx.toString('binary')), certificado.clave);
  const llave = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]
    .flatMap(oid => p12.getBags({ bagType: oid })[oid] ?? [])
    .find(b => b.key)?.key as forge.pki.rsa.PrivateKey;
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).flatMap(b => (b.cert ? [b.cert] : []));
  const esHoja = (c: forge.pki.Certificate) => {
    const p = c.publicKey as forge.pki.rsa.PublicKey;
    return !!(p.n?.equals(llave.n) && p.e?.equals(llave.e));
  };
  const ordenados = [...certificados.filter(esHoja), ...certificados.filter(c => !esHoja(c))];
  return {
    huella: createHash('sha256').update(Buffer.from(abierto.certificadoBase64, 'base64')).digest('hex'),
    rutTitular: abierto.rut,
    tls: { cert: ordenados.map(c => forge.pki.certificateToPem(c)).join(''), key: forge.pki.privateKeyToPem(llave) },
  };
}

export interface PeticionPortal {
  paso: string;
  metodo: 'GET' | 'POST';
  url: string;
  campos?: [string, string][];
  referer?: string;
  /**
   * `xhr`: una llamada de una SPA del SII (`cabecerasXhr`, exige `referer`), como la API de las apps nuevas de `www2c`.
   * Sin él, la navegación de una página (`cabecerasNavegador`).
   */
  modo?: 'xhr';
  /** Cabeceras propias de la solicitud, después de las comunes. */
  cabeceras?: [string, string][];
  /** Devuelve la respuesta aunque traiga un rechazo conocido (quien llama lo lee como dato). */
  crudo?: boolean;
}

/** La sesión abierta, entregada a un trabajo. Cada solicitud agrega cookies y cabeceras y revisa el rechazo. */
export interface SesionPortal {
  /** RUT del titular del certificado (`12345678-9`): las apps nuevas lo piden en una cabecera. */
  readonly rutTitular: string;
  pedir(p: PeticionPortal): Promise<RespuestaHttp>;
}

export interface OpcionesTrabajo {
  /** El trabajo escribe en el SII (pide o reobtiene folios): ante una sesión vencida no se repite solo. */
  escritura?: boolean;
  /** Separación mínima entre solicitudes de este trabajo (flujos de folios: 1001 ms). */
  ritmoMs?: number;
}

export interface Captura {
  operacion: string;
  paso: string;
  metodo: string;
  url: string;
  estado: number | null;
  ubicacion: string | null;
  ms: number;
  /** Cuerpo redactado (sin cookies ni llaves). */
  cuerpo: string;
  error: string | null;
}

export interface Log {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface OpcionesPortal {
  almacen: AlmacenSesiones;
  candado: Candado;
  limitador?: Limitador;
  http?: Http;
  reloj?: Reloj;
  log?: Log;
  esperaLimiteMs?: number;
  /** Recibe cada respuesta del SII redactada (para guardarla en almacenamiento privado al diagnosticar). */
  capturar?: (c: Captura) => void;
}

export interface PortalSii {
  /** true si la sesión sobrevive a reinicios y despliegues (Postgres con llave de cifrado). */
  readonly persistente: boolean;
  /** Corre `trabajo` con la sesión del portal de este certificado, en exclusiva. */
  conSesion<T>(certificado: CertificadoPortal, operacion: string, trabajo: (s: SesionPortal) => Promise<T>, opciones?: OpcionesTrabajo): Promise<T>;
}

interface Estado {
  cookies: string;
  creadaEn: number;
  reutilizada: boolean;
}

const corto = (huella: string) => huella.slice(0, 12);

export function crearPortalSii(o: OpcionesPortal): PortalSii {
  const http = o.http ?? httpNode;
  const reloj = o.reloj ?? relojReal;
  const log = o.log ?? console;
  const limitador = o.limitador ?? crearLimitador({ reloj });
  const esperaLimiteMs = o.esperaLimiteMs ?? ESPERA_LIMITE_MS;

  /** Una solicitud con reintento solo ante fallas que no llegaron al SII. */
  async function enviar(operacion: string, paso: string, cred: Credencial, p: Parameters<Http>[0]): Promise<RespuestaHttp> {
    for (let intento = 0; ; intento++) {
      const inicio = reloj.ahora();
      try {
        const r = await http(p, cred.tls);
        o.capturar?.({ operacion, paso, metodo: p.metodo, url: p.url, estado: r.estado, ubicacion: r.ubicacion, ms: reloj.ahora() - inicio, cuerpo: redactar(r.cuerpo), error: null });
        log.info(`[sii-portal] ${operacion}/${paso} ${p.metodo} ${new URL(p.url).host}${new URL(p.url).pathname} -> ${r.estado} (${reloj.ahora() - inicio} ms)`);
        return r;
      } catch (e) {
        const t = e instanceof ErrorTransporte ? e : new ErrorTransporte((e as Error).message, (e as Error).message, true);
        o.capturar?.({ operacion, paso, metodo: p.metodo, url: p.url, estado: null, ubicacion: null, ms: reloj.ahora() - inicio, cuerpo: '', error: t.message });
        const espera = ESPERAS_TRANSPORTE_MS[intento];
        if (t.llego || espera === undefined) {
          throw new ErrorPortal('TRANSPORTE', `No se pudo hablar con el SII (${paso}): ${t.message}`, { paso: `${operacion}/${paso}` });
        }
        log.warn(`[sii-portal] ${operacion}/${paso}: ${t.causa} antes de llegar al SII, reintento en ${espera} ms`);
        await reloj.esperar(espera);
      }
    }
  }

  async function login(cred: Credencial): Promise<Estado> {
    const espera = await o.almacen.leerEspera(cred.rutTitular);
    if (espera && espera.hasta > reloj.ahora()) {
      throw new ErrorPortal('LIMITE_SESIONES', limiteTexto(espera.hasta), { paso: 'login', mensajeSii: espera.mensajeSii, esperarHasta: espera.hasta });
    }
    const ingreso = await enviar('login', 'ingreso', cred, { metodo: 'GET', url: INGRESO, cabeceras: cabecerasNavegador({ metodo: 'GET' }), conCertificado: false });
    if (ingreso.estado !== 200) throw new ErrorPortal('RESPUESTA_INESPERADA', `El SII no abrió el ingreso con certificado (HTTP ${ingreso.estado}).`, { paso: 'login/ingreso' });
    let cookies = unirCookies('', ingreso.setCookie);
    const r = await enviar('login', 'autenticacion', cred, {
      metodo: 'POST',
      url: AUTENTICACION,
      cabeceras: cabecerasNavegador({ metodo: 'POST', cookies, referer: INGRESO, origen: new URL(INGRESO).origin }),
      cuerpo: codificarFormulario([['referencia', DESTINO_LOGIN]]),
      conCertificado: true,
    });
    cookies = unirCookies(cookies, r.setCookie);
    const mensajes = alertas(r.cuerpo);
    const codigo = mensajes.find(m => CODIGO_AUTENTICACION.test(m)) ?? null;
    const visible = textoVisible(r.cuerpo);
    if (codigo?.match(CODIGO_AUTENTICACION)?.[0].split('.')[4] === '720' || normalizar(`${codigo ?? ''} ${visible}`).includes('MAXIMO DE SESIONES')) {
      const hasta = reloj.ahora() + esperaLimiteMs;
      await o.almacen.guardarEspera({ rutTitular: cred.rutTitular, hasta, mensajeSii: codigo ?? visible }).catch(e => log.error('[sii-portal] no se pudo anotar la espera del límite de sesiones', e));
      log.error(`[sii-portal] límite de sesiones del SII (certificado ${corto(cred.huella)}): sin logins hasta ${new Date(hasta).toISOString()}`);
      throw new ErrorPortal('LIMITE_SESIONES', limiteTexto(hasta), { paso: 'login', mensajeSii: codigo ?? visible, esperarHasta: hasta });
    }
    if (codigo?.includes('.473') || normalizar(visible).includes('CAMBIAR CLAVE')) {
      throw new ErrorPortal('CERTIFICADO_NO_HABILITADO',
        'El certificado no está habilitado para entrar al sitio del SII. Habilítalo en sii.cl (Clave Tributaria, autenticación con certificado digital).',
        { paso: 'login', mensajeSii: codigo ?? visible });
    }
    if (!tieneSesion(cookies)) {
      throw new ErrorPortal('RESPUESTA_INESPERADA', `El SII no abrió la sesión con el certificado (HTTP ${r.estado}).`, { paso: 'login', mensajeSii: codigo ?? visible });
    }
    const ahora = reloj.ahora();
    log.info(`[sii-portal] login con certificado ${corto(cred.huella)} (sesión nueva)`);
    await guardar(cred, { cookies, creadaEn: ahora, reutilizada: false });
    return { cookies, creadaEn: ahora, reutilizada: false };
  }

  /** Guardar la sesión es de mejor esfuerzo: si falla, la operación sigue. */
  async function guardar(cred: Credencial, e: Estado) {
    const registro: RegistroSesion = { huella: cred.huella, rutTitular: cred.rutTitular, cookies: e.cookies, creadaEn: e.creadaEn, usadaEn: reloj.ahora() };
    await o.almacen.guardarSesion(registro).catch(error => log.error('[sii-portal] no se pudo guardar la sesión del SII', error));
  }

  async function asegurar(cred: Credencial): Promise<Estado> {
    const guardada = await o.almacen.leerSesion(cred.huella);
    if (guardada) {
      if (guardada.huella === cred.huella && guardada.rutTitular === cred.rutTitular && tieneSesion(guardada.cookies)) {
        log.info(`[sii-portal] sesión reutilizada (certificado ${corto(cred.huella)})`);
        return { cookies: guardada.cookies, creadaEn: guardada.creadaEn, reutilizada: true };
      }
      // Sesión de otro certificado o ilegible: se borra solo esa, nunca las de otros.
      log.warn(`[sii-portal] la sesión guardada no corresponde al certificado ${corto(cred.huella)}: se descarta`);
      await o.almacen.borrarSesion(cred.huella).catch(() => {});
    }
    return login(cred);
  }

  function sesionSobre(cred: Credencial, operacion: string, estado: Estado, ritmoMs: number): SesionPortal {
    let ultima = Number.NEGATIVE_INFINITY;
    return {
      rutTitular: cred.rutTitular,
      async pedir(p) {
        const destino = new URL(p.url);
        if (destino.protocol !== 'https:' || !destino.hostname.endsWith('.sii.cl')) {
          throw new ErrorPortal('RESPUESTA_INESPERADA', `La página apunta fuera del SII (${destino.host}); no se envían cookies.`, { paso: p.paso });
        }
        const falta = ultima + ritmoMs - reloj.ahora();
        if (falta > 0) await reloj.esperar(falta);
        const r = await enviar(operacion, p.paso, cred, {
          metodo: p.metodo,
          url: p.url,
          cabeceras: [
            ...(p.modo === 'xhr'
              ? cabecerasXhr({ cookies: estado.cookies, referer: p.referer ?? `${destino.origin}/` })
              : cabecerasNavegador({ metodo: p.metodo, cookies: estado.cookies, referer: p.referer, origen: destino.origin })),
            ...(p.cabeceras ?? []),
          ],
          ...(p.metodo === 'POST' ? { cuerpo: codificarFormulario(p.campos ?? []) } : {}),
          conCertificado: false,
        });
        ultima = reloj.ahora();
        estado.cookies = unirCookies(estado.cookies, r.setCookie);
        const rechazo = detectarRechazo(r, `${operacion}/${p.paso}`);
        if (rechazo && (rechazo.codigo === 'SESION_VENCIDA' || !p.crudo)) throw rechazo;
        return r;
      },
    };
  }

  return {
    persistente: o.almacen.persistente,
    conSesion(certificado, operacion, trabajo, opciones = {}) {
      const cred = credencialDe(certificado);
      return o.candado.conCandado(cred.huella, () => limitador.turno(async () => {
        let estado = await asegurar(cred);
        const correr = async (e: Estado) => {
          try {
            return await trabajo(sesionSobre(cred, operacion, e, opciones.ritmoMs ?? 0));
          } finally {
            if (tieneSesion(e.cookies)) await guardar(cred, e);
          }
        };
        try {
          return await correr(estado);
        } catch (error) {
          if (!esErrorPortal(error, 'SESION_VENCIDA')) throw error;
          log.warn(`[sii-portal] ${operacion}: la sesión del SII venció (certificado ${corto(cred.huella)})`);
          await o.almacen.borrarSesion(cred.huella).catch(() => {});
          // Una sesión recién creada que ya no sirve no se arregla con otro login; una escritura no se repite sola.
          if (!estado.reutilizada || opciones.escritura) throw error;
          estado = await login(cred);
          return correr(estado);
        }
      }));
    },
  };
}

function limiteTexto(hasta: number): string {
  const hora = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }).format(new Date(hasta));
  return `El SII no abre más sesiones con este certificado por ahora (máximo de sesiones). No se vuelve a intentar hasta las ${hora}.`;
}
