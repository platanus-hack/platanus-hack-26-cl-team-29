// Datos de la empresa leídos del portal del SII de certificación con el certificado del proveedor: razón social,
// dirección, comuna y actividades económicas, tal como el SII las tiene inscritas. Solo lectura.
//
// Login con certificado: GET de IngresoCertificado.html en zeusr (cookie del balanceador) y POST a CAutInicio.cgi en
// herculesr, que pide el certificado de cliente en el handshake TLS y responde con las cookies de sesión
// NETSCAPE_LIVEWIRE.*. Con esa sesión, `ce_consulta_muestra_e` en maullin devuelve la ficha del contribuyente.
// El SII limita las sesiones abiertas por persona y cerrar sesión no libera el cupo: la sesión se reusa en memoria.
import { constants } from 'node:crypto';
import https from 'node:https';
import forge from 'node-forge';
import type { Empresa } from './almacen.ts';

const DESTINO = 'https://misiir.sii.cl/cgi_misii/siihome.cgi';
const INGRESO = `https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html?${DESTINO}`;
const AUTENTICACION = `https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?${DESTINO}`;
const FICHA = 'https://maullin.sii.cl/cvc_cgi/dte/ce_consulta_muestra_e';
const REFERER_FICHA = 'https://maullin.sii.cl/cvc_cgi/dte/ad_empresa2';
const VIGENCIA_SESION_MS = 45 * 60_000;
const TIMEOUT_MS = 30_000;

export interface DatosPortal extends Empresa {
  rut: string;
  /** Todas las actividades inscritas, por si el proveedor quiere elegir otra como giro. */
  actividades: { codigo: number; descripcion: string }[];
}

export type LeerEmpresa = (pfx: Buffer, clave: string, rutEmpresa: string) => Promise<DatosPortal>;

interface Respuesta {
  status: number;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo: string;
}

/** Certificado y llave en PEM, con la cadena que traiga el .pfx: herculesr pide el certificado de cliente. */
function pemsDelPfx(pfx: Buffer, clave: string): { cert: string; key: string } {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), clave);
  const llave = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]
    .flatMap(oid => p12.getBags({ bagType: oid })[oid] ?? [])
    .find(b => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).flatMap(b => (b.cert ? [b.cert] : []));
  if (!llave || certificados.length === 0) throw new Error('El .pfx no trae llave o certificado');
  const esHoja = (c: forge.pki.Certificate) => {
    const p = c.publicKey as forge.pki.rsa.PublicKey;
    return p.n?.equals(llave.n) && p.e?.equals(llave.e);
  };
  const ordenados = [...certificados.filter(esHoja), ...certificados.filter(c => !esHoja(c))];
  return { cert: ordenados.map(c => forge.pki.certificateToPem(c)).join(''), key: forge.pki.privateKeyToPem(llave) };
}

/** Cookies `nombre=valor` de la sesión; las nuevas reemplazan a las del mismo nombre. */
function unirCookies(jar: Map<string, string>, setCookie: string | string[] | undefined) {
  for (const linea of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
    const par = linea.split(';')[0] ?? '';
    const i = par.indexOf('=');
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}

function pedir(url: string, opciones: { metodo?: 'GET' | 'POST'; cuerpo?: string; jar: Map<string, string>; agente: https.Agent; referer?: string }): Promise<Respuesta> {
  const destino = new URL(url);
  if (destino.protocol !== 'https:' || !destino.hostname.endsWith('.sii.cl')) throw new Error(`Solo se habla con el SII por HTTPS: ${url}`);
  return new Promise((resolver, rechazar) => {
    const cabeceras: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9',
    };
    if (opciones.jar.size > 0) cabeceras.Cookie = [...opciones.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (opciones.referer) cabeceras.Referer = opciones.referer;
    if (opciones.cuerpo !== undefined) {
      cabeceras['Content-Type'] = 'application/x-www-form-urlencoded';
      cabeceras['Content-Length'] = String(Buffer.byteLength(opciones.cuerpo));
      cabeceras.Origin = destino.origin;
    }
    const req = https.request(url, { method: opciones.metodo ?? 'GET', headers: cabeceras, agent: opciones.agente, timeout: TIMEOUT_MS }, res => {
      unirCookies(opciones.jar, res.headers['set-cookie']);
      const partes: Buffer[] = [];
      res.on('data', (p: Buffer) => partes.push(p));
      res.on('end', () => {
        const utf8 = /charset=utf-?8/i.test(String(res.headers['content-type'] ?? ''));
        resolver({ status: res.statusCode ?? 0, cabeceras: res.headers, cuerpo: Buffer.concat(partes).toString(utf8 ? 'utf8' : 'latin1') });
      });
      res.on('error', rechazar);
    });
    req.on('timeout', () => req.destroy(new Error(`El SII no respondió a tiempo (${destino.hostname})`)));
    req.on('error', rechazar);
    if (opciones.cuerpo !== undefined) req.write(opciones.cuerpo);
    req.end();
  });
}

const textoPlano = (html: string) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&([aeiouAEIOU])acute;/g, (_, v: string) => ({ a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' })[v] ?? v)
  .replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const etiqueta = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * La dirección viene en una celda ("CALLE 123, Villa/Pob. X, Ciudad Y, Comuna Z"). Las etiquetas son texto del SII, no
 * del dato: pegadas en `DirOrigen` pasan el largo del XSD y el SII rechaza el envío. Se separan desde el final.
 */
export function separarDomicilio(celda: string): { direccion: string; comuna: string; ciudad?: string } {
  let resto = celda;
  const partes: Record<string, string> = {};
  const patrones: [string, RegExp][] = [['comuna', /,?\s*Comuna\s+([^,]+)$/i], ['ciudad', /,?\s*Ciudad\s+([^,]+)$/i], ['villa', /,?\s*Villa\/Pob\.?\s+([^,]+)$/i]];
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const [campo, re] of patrones) {
      const m = re.exec(resto);
      if (m && partes[campo] === undefined) {
        partes[campo] = (m[1] ?? '').trim();
        resto = resto.slice(0, m.index);
        cambio = true;
      }
    }
  }
  const direccion = [resto.replace(/,\s*$/, '').trim(), partes.villa].filter(Boolean).join(', ');
  return { direccion, comuna: partes.comuna ?? '', ...(partes.ciudad ? { ciudad: partes.ciudad } : {}) };
}

/** Lee la página `ce_consulta_muestra_e`. Falla con el texto de la página si no trae la ficha. */
export function leerFicha(html: string): DatosPortal {
  const datos = new Map<string, string>();
  const actividades: DatosPortal['actividades'] = [];
  for (const fila of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...(fila[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => textoPlano(c[1] ?? ''));
    if (celdas.length === 2 && celdas[0]) datos.set(etiqueta(celdas[0]), celdas[1] ?? '');
    else if (celdas.length === 3 && /^\d{6}$/.test((celdas[0] ?? '').replace(/\s/g, ''))) {
      actividades.push({ codigo: Number((celdas[0] ?? '').replace(/\s/g, '')), descripcion: celdas[1] ?? '' });
    }
  }
  const rut = datos.get('DATOS DEL CONTRIBUYENTE RUT');
  const razonSocial = datos.get('NOMBRE O RAZON SOCIAL');
  const domicilio = datos.get('DIRECCION DE LA EMPRESA');
  if (!rut || !razonSocial || !domicilio) {
    throw new Error(`El SII no entregó la ficha de la empresa. Página: ${textoPlano(html).slice(0, 2000)}`);
  }
  const principal = actividades[0];
  return {
    rut,
    razonSocial,
    giro: principal?.descripcion ?? '',
    acteco: principal?.codigo ?? 0,
    ...separarDomicilio(domicilio),
    actividades,
  };
}

/** Lector real contra el SII, con la sesión del portal guardada en memoria por certificado. */
export function crearLectorPortal(): LeerEmpresa {
  const sesiones = new Map<string, { jar: Map<string, string>; desde: number }>();

  async function login(agente: https.Agent): Promise<Map<string, string>> {
    const jar = new Map<string, string>();
    const ingreso = await pedir(INGRESO, { jar, agente });
    if (ingreso.status !== 200) throw new Error(`El SII no abrió el ingreso con certificado (HTTP ${ingreso.status})`);
    const r = await pedir(AUTENTICACION, { metodo: 'POST', cuerpo: `referencia=${encodeURIComponent(DESTINO)}`, jar, agente, referer: INGRESO });
    const texto = textoPlano(r.cuerpo);
    if (/m[aá]ximo de sesiones|01\.01\.215\.500\.7(09|20)/i.test(texto)) {
      throw new Error(`El SII no abre más sesiones con este certificado por ahora (límite de sesiones). Espera una hora o escribe los datos a mano. ${texto.slice(0, 500)}`);
    }
    if (/Cambiar clave|01\.01\.215\.500\.473/i.test(texto)) {
      throw new Error('El certificado no está habilitado para entrar al SII: habilítalo en sii.cl o escribe los datos a mano.');
    }
    if (![...jar.keys()].some(k => k.startsWith('NETSCAPE_LIVEWIRE'))) {
      throw new Error(`El SII no abrió la sesión con el certificado (HTTP ${r.status}). ${texto.slice(0, 500)}`);
    }
    return jar;
  }

  return async (pfx, clave, rutEmpresa) => {
    const { cert, key } = pemsDelPfx(pfx, clave);
    const agente = new https.Agent({
      cert, key, maxVersion: 'TLSv1.2',
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT | constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
    });
    try {
      const huella = forge.md.sha256.create().update(cert).digest().toHex();
      const [cuerpo = '', dv = ''] = rutEmpresa.split('-');
      const consultar = (jar: Map<string, string>) => pedir(FICHA, {
        metodo: 'POST', jar, agente, referer: REFERER_FICHA,
        cuerpo: `RUT_EMP=${encodeURIComponent(cuerpo)}&DV_EMP=${encodeURIComponent(dv)}&ACEPTAR=CONSULTAR`,
      });
      const guardada = sesiones.get(huella);
      if (guardada && Date.now() - guardada.desde < VIGENCIA_SESION_MS) {
        const r = await consultar(guardada.jar);
        if (r.status === 200) {
          try { return leerFicha(r.cuerpo); } catch { /* sesión vencida u otra página: un login nuevo */ }
        }
      }
      const jar = await login(agente);
      sesiones.set(huella, { jar, desde: Date.now() });
      const r = await consultar(jar);
      if (r.status !== 200) throw new Error(`El SII respondió HTTP ${r.status} al pedir la ficha de ${rutEmpresa}`);
      return leerFicha(r.cuerpo);
    } finally {
      agente.destroy();
    }
  };
}
