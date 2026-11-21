// "Conectar mi SII": el proveedor sube su certificado, confirma los datos de su empresa (leídos del portal del SII),
// la fecha de resolución y sus CAF. Con eso la red emite en el SII de certificación sin variables de entorno.
// Los secretos se guardan cifrados (cifrado.ts) y nunca salen en una respuesta, un evento ni el log.
import { abrirCertificado, leerCaf, normalizarRut, primerDiaVencido } from '../sii/index.ts';
import type { ConsultaDocumento, EstadoDocumento, Log } from '../sii/index.ts';
import { TIPOS_CAF } from './almacen.ts';
import type { AlmacenConexion, CafGuardado, ConexionGuardada, Empresa, TipoCaf } from './almacen.ts';
import { cifrar, descifrar, llaveDesdeEnv } from './cifrado.ts';
import type { LeerEmpresa, DatosPortal } from './portal.ts';
import { buscarPrimerLibre } from './primer-libre.ts';

export class ErrorConexion extends Error {
  readonly status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConexion';
    this.status = status;
  }
}

export interface EstadoCaf {
  tipo: TipoCaf;
  desde: number;
  hasta: number;
  fa: string;
  primerLibre: number | null;
  /** Folios que quedan desde el primer libre, descontando los que la red ya tomó. */
  libres: number | null;
  escaneando: boolean;
  progreso: { revisados: number; folio: number; total: number } | null;
  error: string | null;
}

/** Lo que ve el panel. Sin secretos: del certificado solo el RUT del titular y su vencimiento. */
export interface EstadoConexion {
  /** La red emite con esta conexión (certificado, empresa, resolución y CAF de factura con su primer folio libre). */
  conectado: boolean;
  /** Hay un SII configurado por variables de entorno, que se usa mientras la conexión de la app esté incompleta. */
  respaldoVariables: boolean;
  /** SII_LLAVE_CIFRADO válida: sin ella no se puede guardar nada. */
  puedeGuardar: boolean;
  titular: string | null;
  venceEl: string | null;
  rutEmisor: string | null;
  empresa: Empresa | null;
  origenEmpresa: 'sii' | 'manual' | null;
  resolucion: { fecha: string; numero: number } | null;
  cafs: EstadoCaf[];
}

export type CrearConsulta = (pfx: Buffer, clave: string, rutEmisor: string) => (c: ConsultaDocumento) => Promise<EstadoDocumento>;

export interface OpcionesConexion {
  almacen: AlmacenConexion;
  env?: NodeJS.ProcessEnv;
  log?: Log;
  leerEmpresa: LeerEmpresa;
  crearConsulta: CrearConsulta;
  /** Mayor folio que la red ya tomó del tipo (almacén de folios), para no contarlo como libre. */
  ultimoUsado?: (tipo: number) => Promise<number>;
  /** `AAAA-MM-DD` en Chile. */
  hoy?: () => string;
}

export interface ConexionSii {
  estado(): Promise<EstadoConexion>;
  subirCertificado(pfxBase64: unknown, clave: unknown): Promise<EstadoConexion>;
  consultarEmpresa(rutEmisor: unknown): Promise<DatosPortal>;
  guardarEmpresa(datos: Record<string, unknown>): Promise<EstadoConexion>;
  subirCaf(xmlBase64: unknown): Promise<{ estado: EstadoConexion; avisos: string[] }>;
  fijarFolio(tipo: unknown, folio: unknown): Promise<EstadoConexion>;
  desconectar(): Promise<EstadoConexion>;
  /**
   * Variables SII_* para emitir con esta conexión, sobre `base` sin las del emisor configurado por entorno (si ambos
   * existen, gana la app). `null` si la conexión está incompleta.
   */
  entorno(base: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv | null>;
  /** Cambia cada vez que cambia algo que afecta la emisión. */
  version(): number;
  /** Espera a que terminen las búsquedas de folio en curso (tests). */
  esperarBusquedas(): Promise<void>;
}

/** Un .pfx real pesa entre 3 y 10 KB; con holgura para cadenas largas. */
const MAX_PFX_BASE64 = 40_000;
const MAX_CAF_BASE64 = 20_000;
const SEIS_MESES_MS = 182 * 86_400_000;
const NOMBRE: Record<TipoCaf, string> = { 33: 'factura', 52: 'guía de despacho', 61: 'nota de crédito' };
/** Variables del emisor por entorno que la conexión de la app reemplaza completas (no se mezclan dos empresas). */
const DEL_EMISOR = /^SII_(PFX_|RUT_EMISOR$|FCH_RESOL$|EMISOR_|CAF_|FOLIO_DESDE_)/;

const hoyEnChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const base64Valido = (v: string) => /^[A-Za-z0-9+/]+={0,2}$/.test(v.replace(/\s+/g, ''));

function rutValido(v: unknown): string {
  try {
    return normalizarRut(texto(v));
  } catch {
    throw new ErrorConexion(400, 'El RUT de la empresa no es válido. Escríbelo con guion y dígito verificador, por ejemplo 76123456-7.');
  }
}

function campo(datos: Record<string, unknown>, nombre: string, etiqueta: string, max: number, obligatorio = true): string {
  const v = texto(datos[nombre]);
  if (obligatorio && !v) throw new ErrorConexion(400, `Falta ${etiqueta}.`);
  if (v.length > max) throw new ErrorConexion(400, `${etiqueta[0]!.toUpperCase()}${etiqueta.slice(1)} admite hasta ${max} caracteres.`);
  return v;
}

export function crearConexionSii({
  almacen, env = process.env, log = console, leerEmpresa, crearConsulta, ultimoUsado = async () => 0, hoy = hoyEnChile,
}: OpcionesConexion): ConexionSii {
  let version = 0;
  const busquedas = new Map<TipoCaf, { generacion: number; revisados: number; folio: number; total: number; error: string | null; activa: boolean; promesa: Promise<void> }>();
  let generacion = 0;

  const llave = () => {
    try {
      return llaveDesdeEnv(env);
    } catch (error) {
      throw new ErrorConexion(503, (error as Error).message);
    }
  };
  const puedeGuardar = () => {
    try { llaveDesdeEnv(env); return true; } catch { return false; }
  };

  const leer = async (): Promise<ConexionGuardada> =>
    (await almacen.leer()) ?? { cafs: {}, actualizadoEn: new Date().toISOString() };
  const guardar = async (c: ConexionGuardada) => {
    c.actualizadoEn = new Date().toISOString();
    await almacen.guardar(c);
    version++;
  };

  function certificadoDe(c: ConexionGuardada): { pfx: Buffer; clave: string } {
    if (!c.certificado) throw new ErrorConexion(409, 'Primero sube tu certificado digital.');
    const { pfxBase64, clave } = JSON.parse(descifrar(llave(), c.certificado.cifrado)) as { pfxBase64: string; clave: string };
    return { pfx: Buffer.from(pfxBase64, 'base64'), clave };
  }

  async function estado(): Promise<EstadoConexion> {
    const c = await leer();
    const cafs: EstadoCaf[] = [];
    for (const tipo of TIPOS_CAF) {
      const g = c.cafs[tipo];
      if (!g) continue;
      const b = busquedas.get(tipo);
      const primerLibre = g.primerLibre ?? null;
      const siguiente = primerLibre === null ? null : Math.max(primerLibre, (await ultimoUsado(tipo)) + 1);
      cafs.push({
        tipo, desde: g.desde, hasta: g.hasta, fa: g.fa, primerLibre,
        libres: siguiente === null ? null : Math.max(0, g.hasta - siguiente + 1),
        escaneando: !!b?.activa,
        progreso: b ? { revisados: b.revisados, folio: b.folio, total: b.total } : null,
        error: b?.error ?? null,
      });
    }
    return {
      conectado: listo(c),
      respaldoVariables: !!env.SII_PFX_BASE64,
      puedeGuardar: puedeGuardar(),
      titular: c.certificado?.rut ?? null,
      venceEl: c.certificado?.venceEl ?? null,
      rutEmisor: c.rutEmisor ?? null,
      empresa: c.empresa ?? null,
      origenEmpresa: c.origenEmpresa ?? null,
      resolucion: c.resolucion ?? null,
      cafs,
    };
  }

  const listo = (c: ConexionGuardada) =>
    !!(c.certificado && c.rutEmisor && c.empresa && c.resolucion && c.cafs[33]?.primerLibre !== undefined);

  /** Busca en segundo plano el primer folio libre del CAF del tipo, desde `desde`. Nunca baja el ya conocido. */
  function buscar(tipo: TipoCaf, cert: { pfx: Buffer; clave: string }, rutEmisor: string, caf: CafGuardado, desde: number) {
    const mia = ++generacion;
    const b = { generacion: mia, revisados: 0, folio: desde, total: caf.hasta - desde + 1, error: null as string | null, activa: true, promesa: Promise.resolve() };
    busquedas.set(tipo, b);
    const vigente = () => busquedas.get(tipo)?.generacion === mia;
    const consulta = crearConsulta(cert.pfx, cert.clave, rutEmisor);
    log.info(`[conexion-sii] buscando el primer folio libre del tipo ${tipo} desde ${desde} (rango ${caf.desde} a ${caf.hasta})`);
    b.promesa = (async () => {
      try {
        const libre = await buscarPrimerLibre({
          desde, hasta: caf.hasta,
          cancelada: () => !vigente(),
          alProgreso: p => { b.revisados = p.revisados; b.folio = p.folio; },
          consultar: async folio => {
            const r = await consulta({ tipo, folio, fechaEmision: hoy(), montoTotal: 1, rutReceptor: rutEmisor });
            log.info(`[conexion-sii] QueryEstDte tipo ${tipo} folio ${folio}: ${r.codigo} ${r.glosa ?? ''}`);
            return { codigo: r.codigo, detalle: r.respuesta };
          },
        });
        if (!vigente()) return;
        if (libre === null) {
          b.error = `El CAF de ${NOMBRE[tipo]} no tiene folios libres en el SII: sube otro CAF.`;
          return;
        }
        const c = await leer();
        const actual = c.cafs[tipo];
        if (!actual || actual.desde !== caf.desde || actual.hasta !== caf.hasta) return;
        actual.primerLibre = Math.max(libre, actual.primerLibre ?? 0);
        await guardar(c);
        log.info(`[conexion-sii] tipo ${tipo}: primer folio libre ${actual.primerLibre}`);
      } catch (error) {
        b.error = error instanceof Error ? error.message : String(error);
        log.error(`[conexion-sii] la búsqueda de folio del tipo ${tipo} falló: ${b.error}`);
      } finally {
        b.activa = false;
      }
    })();
  }

  return {
    estado,

    async subirCertificado(pfxBase64, clave) {
      const base64 = texto(pfxBase64);
      if (!base64 || !base64Valido(base64)) throw new ErrorConexion(400, 'Sube el archivo .pfx de tu certificado digital.');
      if (base64.length > MAX_PFX_BASE64) throw new ErrorConexion(413, 'El archivo es demasiado grande para ser un certificado .pfx.');
      if (typeof clave !== 'string' || !clave) throw new ErrorConexion(400, 'Escribe la clave de tu certificado.');
      const k = llave();
      let cert: ReturnType<typeof abrirCertificado>;
      try {
        cert = abrirCertificado(Buffer.from(base64, 'base64'), clave);
      } catch {
        throw new ErrorConexion(400, 'No pudimos abrir el certificado. Revisa que sea el .pfx correcto y su clave.');
      }
      if (cert.venceEl.getTime() <= Date.now()) {
        throw new ErrorConexion(400, `El certificado venció el ${cert.venceEl.toISOString().slice(0, 10)}. Sube uno vigente.`);
      }
      const c = await leer();
      c.certificado = { cifrado: cifrar(k, JSON.stringify({ pfxBase64: base64, clave })), rut: cert.rut, venceEl: cert.venceEl.toISOString() };
      await guardar(c);
      log.info(`[conexion-sii] certificado guardado (titular ${cert.rut}, vence ${c.certificado.venceEl.slice(0, 10)})`);
      return estado();
    },

    async consultarEmpresa(rutEmisor) {
      const rut = rutValido(rutEmisor);
      const { pfx, clave } = certificadoDe(await leer());
      try {
        const datos = await leerEmpresa(pfx, clave, rut);
        log.info(`[conexion-sii] ficha de ${rut} leída del portal del SII`);
        return datos;
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        log.warn(`[conexion-sii] no se pudo leer la ficha de ${rut} del portal: ${detalle}`);
        throw new ErrorConexion(502, `No pudimos leer tus datos del SII. Escríbelos tú. Detalle: ${detalle}`);
      }
    },

    async guardarEmpresa(datos) {
      const rut = rutValido(datos.rutEmisor);
      const acteco = Number(texto(datos.acteco));
      if (!/^\d{6}$/.test(texto(datos.acteco))) throw new ErrorConexion(400, 'El código de actividad económica tiene 6 dígitos.');
      const empresa: Empresa = {
        razonSocial: campo(datos, 'razonSocial', 'la razón social', 100),
        giro: campo(datos, 'giro', 'el giro', 80),
        acteco,
        direccion: campo(datos, 'direccion', 'la dirección', 70),
        comuna: campo(datos, 'comuna', 'la comuna', 20),
      };
      const ciudad = campo(datos, 'ciudad', 'la ciudad', 20, false);
      if (ciudad) empresa.ciudad = ciudad;
      const fecha = texto(datos.fchResol);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha)) || fecha > hoy()) {
        throw new ErrorConexion(400, 'La fecha de resolución va como AAAA-MM-DD y no puede ser futura.');
      }
      const numero = datos.nroResol === undefined || datos.nroResol === '' ? 0 : Number(datos.nroResol);
      if (!Number.isInteger(numero) || numero < 0) throw new ErrorConexion(400, 'El número de resolución es un entero (0 en certificación).');
      llave();
      const c = await leer();
      if (!c.certificado) throw new ErrorConexion(409, 'Primero sube tu certificado digital.');
      if (c.rutEmisor && c.rutEmisor !== rut) {
        // Otra empresa: sus CAF no sirven.
        c.cafs = {};
        for (const tipo of TIPOS_CAF) busquedas.delete(tipo);
      }
      c.rutEmisor = rut;
      c.empresa = empresa;
      c.origenEmpresa = datos.origen === 'sii' ? 'sii' : 'manual';
      c.resolucion = { fecha, numero };
      await guardar(c);
      log.info(`[conexion-sii] empresa ${rut} guardada (resolución ${fecha} n.º ${numero})`);
      return estado();
    },

    async subirCaf(xmlBase64) {
      const base64 = texto(xmlBase64);
      if (!base64 || !base64Valido(base64)) throw new ErrorConexion(400, 'Sube el archivo XML del CAF.');
      if (base64.length > MAX_CAF_BASE64) throw new ErrorConexion(413, 'El archivo es demasiado grande para ser un CAF.');
      const k = llave();
      const c = await leer();
      const cert = certificadoDe(c);
      if (!c.rutEmisor) throw new ErrorConexion(409, 'Primero guarda los datos de tu empresa.');
      let caf: ReturnType<typeof leerCaf>;
      try {
        caf = leerCaf(Buffer.from(base64, 'base64'));
      } catch (error) {
        throw new ErrorConexion(400, `El archivo no es un CAF válido: ${(error as Error).message}`);
      }
      const tipo = caf.tipo as TipoCaf;
      if (!TIPOS_CAF.includes(tipo)) throw new ErrorConexion(400, `El CAF es del tipo ${caf.tipo}; la red usa factura (33), guía (52) y nota de crédito (61).`);
      if (caf.rutEmisor !== c.rutEmisor) throw new ErrorConexion(400, `El CAF es de la empresa ${caf.rutEmisor}, no de ${c.rutEmisor}.`);
      const avisos: string[] = [];
      const vence = primerDiaVencido(caf);
      if (vence !== null && hoy() >= vence) throw new ErrorConexion(400, `El CAF de ${NOMBRE[tipo]} venció el ${vence}. Pide uno nuevo en el SII.`);
      if (vence !== null && Date.parse(vence) - Date.parse(hoy()) < 30 * 86_400_000) avisos.push(`El CAF de ${NOMBRE[tipo]} vence el ${vence}.`);
      if (vence === null && Date.parse(hoy()) - Date.parse(caf.fechaAutorizacion) > SEIS_MESES_MS) {
        avisos.push(`El CAF de ${NOMBRE[tipo]} se autorizó hace más de 6 meses (${caf.fechaAutorizacion}); puede tener folios usados.`);
      }
      const previo = c.cafs[tipo];
      const mismoRango = previo && previo.desde === caf.folioDesde && previo.hasta === caf.folioHasta;
      const guardado: CafGuardado = {
        cifrado: cifrar(k, base64), desde: caf.folioDesde, hasta: caf.folioHasta, fa: caf.fechaAutorizacion,
        ...(mismoRango && previo.primerLibre !== undefined ? { primerLibre: previo.primerLibre } : {}),
      };
      c.cafs[tipo] = guardado;
      await guardar(c);
      log.info(`[conexion-sii] CAF tipo ${tipo} guardado (folios ${caf.folioDesde} a ${caf.folioHasta}, FA ${caf.fechaAutorizacion})`);
      // Lo ya conocido no se vuelve a preguntar: ni lo que la red tomó ni lo que una búsqueda anterior dio por usado.
      const desde = Math.max(caf.folioDesde, guardado.primerLibre ?? 0, (await ultimoUsado(tipo)) + 1);
      if (desde > caf.folioHasta) avisos.push(`El CAF de ${NOMBRE[tipo]} ya no tiene folios libres.`);
      else buscar(tipo, cert, c.rutEmisor, guardado, desde);
      return { estado: await estado(), avisos };
    },

    async fijarFolio(tipoEntrada, folioEntrada) {
      const tipo = Number(tipoEntrada) as TipoCaf;
      const folio = Number(folioEntrada);
      const c = await leer();
      const caf = c.cafs[tipo];
      if (!caf) throw new ErrorConexion(404, `No hay CAF de ${NOMBRE[tipo] ?? `tipo ${tipo}`}.`);
      const minimo = Math.max(caf.desde, caf.primerLibre ?? 0);
      if (!Number.isInteger(folio) || folio < minimo || folio > caf.hasta) {
        throw new ErrorConexion(400, `El folio debe estar entre ${minimo} y ${caf.hasta}: nunca se vuelve a un folio anterior.`);
      }
      busquedas.delete(tipo);
      caf.primerLibre = folio;
      await guardar(c);
      log.info(`[conexion-sii] tipo ${tipo}: primer folio fijado a mano en ${folio}`);
      return estado();
    },

    async desconectar() {
      busquedas.clear();
      await almacen.borrar();
      version++;
      log.info('[conexion-sii] conexión borrada');
      return estado();
    },

    async entorno(base) {
      const c = await almacen.leer();
      if (!c || !listo(c)) return null;
      const { pfx, clave } = certificadoDe(c);
      const k = llave();
      const e = c.empresa!;
      const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(base).filter(([nombre]) => !DEL_EMISOR.test(nombre)));
      Object.assign(env, {
        SII_PFX_BASE64: pfx.toString('base64'),
        SII_PFX_CLAVE: clave,
        SII_RUT_EMISOR: c.rutEmisor,
        SII_FCH_RESOL: c.resolucion!.fecha,
        SII_EMISOR_RAZON_SOCIAL: e.razonSocial,
        SII_EMISOR_GIRO: e.giro,
        SII_EMISOR_ACTECO: String(e.acteco),
        SII_EMISOR_DIRECCION: e.direccion,
        SII_EMISOR_COMUNA: e.comuna,
        ...(e.ciudad ? { SII_EMISOR_CIUDAD: e.ciudad } : {}),
      });
      for (const tipo of TIPOS_CAF) {
        const caf = c.cafs[tipo];
        // Un CAF cuyo primer folio libre aún no se conoce no se usa: podría repetir un folio ya recibido.
        if (!caf || caf.primerLibre === undefined) continue;
        env[`SII_CAF_${tipo}_BASE64`] = descifrar(k, caf.cifrado);
        env[`SII_FOLIO_DESDE_${tipo}`] = String(caf.primerLibre);
      }
      // Sin comprador configurado, la empresa conectada se factura a sí misma (válido en certificación).
      if (!env.SII_RUT_RECEPTOR) {
        Object.assign(env, {
          SII_RUT_RECEPTOR: c.rutEmisor,
          SII_RECEPTOR_RAZON_SOCIAL: e.razonSocial,
          SII_RECEPTOR_GIRO: e.giro.slice(0, 40),
          SII_RECEPTOR_DIRECCION: e.direccion,
          SII_RECEPTOR_COMUNA: e.comuna,
        });
      }
      return env;
    },

    version: () => version,

    async esperarBusquedas() {
      await Promise.all([...busquedas.values()].map(b => b.promesa));
    },
  };
}
