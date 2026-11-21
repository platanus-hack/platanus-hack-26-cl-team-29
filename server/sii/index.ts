// API pública del módulo SII (solo ambiente de CERTIFICACIÓN). Fuera de server/sii/ solo se importa este archivo.
import { Autenticador } from './autenticacion.ts';
import { leerCaf, type Caf } from './caf.ts';
import { abrirCertificado } from './certificado.ts';
import { armarDte, datosImpresos, emisiones, type EntradaDte } from './dte.ts';
import { subirSobre } from './envio.ts';
import { estadoDocumento, estadoEnvio } from './estado.ts';
import { crearSiiFalso } from './falso.ts';
import { listarEventos, registrarAccion } from './reclamo.ts';
import { armarSobre } from './sobre.ts';
import { crearHttp, type Http } from './soap.ts';
import type {
  AccionReceptor,
  ConsultaDocumento,
  DocumentoRecibido,
  Emisor,
  EntradaFactura,
  EntradaGuia,
  EntradaNotaCredito,
  EstadoDocumento,
  EstadoEnvio,
  EventosDocumento,
  Log,
  RespuestaReclamo,
  ResultadoEmision,
  ResultadoLote,
} from './tipos.ts';

export type * from './tipos.ts';
export { ErrorSii } from './soap.ts';
export { abrirCertificado, type Certificado } from './certificado.ts';
export { leerCaf, primerDiaVencido, type Caf } from './caf.ts';
export { limpiarLatin1 } from './texto.ts';
export { crearSiiFalso as crearSiiEnMemoria } from './falso.ts';
export { generarPdf, nombreDelTipo, opcionesTimbre } from './pdf.ts';
export type { Http } from './soap.ts';

/**
 * Solo QueryEstDte con un certificado dado, sin emisor ni CAF: sirve para buscar el primer folio libre de un CAF
 * antes de tener todo lo necesario para emitir. Usa la misma cola de 1 solicitud por segundo del proceso.
 */
export function crearConsultaDocumentos(
  certificado: { readonly pfx: Buffer; readonly clave: string },
  rutEmisor: string,
  http: Http = crearHttp(),
): (consulta: ConsultaDocumento) => Promise<EstadoDocumento> {
  const autenticador = new Autenticador(http, abrirCertificado(certificado.pfx, certificado.clave));
  return consulta => estadoDocumento(http, autenticador, rutEmisor, consulta);
}

export interface Sii {
  /** `certificacion` habla con maullin y ws2; `falso` responde en memoria, sin credenciales. */
  readonly modo: 'certificacion' | 'falso';
  readonly rutEmisor: string;
  /** Factura electrónica (33). */
  emitirFactura(entrada: EntradaFactura): Promise<ResultadoEmision>;
  /**
   * Varias facturas (33) en UN sobre: una sola subida. El resultado del envío vale para todas; el veredicto de
   * cada una sale de `estadoEnvio` (por tipo) o de `estadoDocumento` (por folio). Los folios los pone quien llama.
   */
  emitirFacturas(entradas: readonly EntradaFactura[]): Promise<ResultadoLote>;
  /** Guía de despacho (52). */
  emitirGuia(entrada: EntradaGuia): Promise<ResultadoEmision>;
  /** Nota de crédito (61) que corrige montos de una factura 33. */
  emitirNotaCredito(entrada: EntradaNotaCredito): Promise<ResultadoEmision>;
  estadoEnvio(trackId: string): Promise<EstadoEnvio>;
  /** Estado de un documento emitido por `rutEmisor`. Es la consulta obligada tras un envío `incierto`. */
  estadoDocumento(consulta: ConsultaDocumento): Promise<EstadoDocumento>;
  /** Acción del receptor sobre un documento recibido (solo 33, 34 y 43, dentro de 8 días desde su recepción). */
  registrarAccionReceptor(documento: DocumentoRecibido, accion: AccionReceptor): Promise<RespuestaReclamo>;
  eventosDocumento(documento: DocumentoRecibido): Promise<EventosDocumento>;
}

export interface SiiOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: Log;
  /** Para tests: reemplaza el transporte HTTP. */
  readonly http?: Http;
}

const OBLIGATORIAS = [
  'SII_PFX_CLAVE', 'SII_RUT_EMISOR', 'SII_FCH_RESOL',
  'SII_EMISOR_RAZON_SOCIAL', 'SII_EMISOR_GIRO', 'SII_EMISOR_ACTECO', 'SII_EMISOR_DIRECCION', 'SII_EMISOR_COMUNA',
] as const;

/** Lo que el SII de certificación necesita para emitir: certificado, emisor, resolución y CAF. */
export interface ConfigSii {
  readonly certificado: { readonly pfx: Buffer; readonly clave: string };
  readonly emisor: Emisor;
  /** Fecha de la resolución, `AAAA-MM-DD`. */
  readonly fchResol: string;
  /** XML de los CAF por tipo: un tipo puede tener varios rangos, cada uno con su CAF. */
  readonly cafs: Readonly<Partial<Record<number, readonly Buffer[]>>>;
  readonly oficinaSii?: string;
}

/**
 * Con `SII_PFX_BASE64` habla con el SII de certificación; sin él, usa la implementación falsa en memoria. Las variables
 * SII_* son solo para los scripts locales (scripts/, con un .env propio): el servidor emite con la conexión del panel
 * (`crearSiiConectado`).
 */
export function crearSii(options: SiiOptions = {}): Sii {
  const env = options.env ?? process.env;
  const log = options.log ?? console;
  if (!env.SII_PFX_BASE64) {
    log.warn('[sii] sin SII_PFX_BASE64: se usa la implementación falsa (nada llega al SII)');
    return crearSiiFalso(env.SII_RUT_EMISOR);
  }
  const faltan = OBLIGATORIAS.filter(nombre => !env[nombre]);
  if (faltan.length > 0) throw new Error(`[sii] faltan variables de entorno: ${faltan.join(', ')}`);
  const cafs: Record<number, Buffer[]> = {};
  for (const tipo of [33, 52, 61]) {
    const base64 = env[`SII_CAF_${tipo}_BASE64`];
    if (base64) cafs[tipo] = [Buffer.from(base64, 'base64')];
  }
  return crearSiiConectado({
    certificado: { pfx: Buffer.from(env.SII_PFX_BASE64, 'base64'), clave: env.SII_PFX_CLAVE ?? '' },
    emisor: {
      rut: env.SII_RUT_EMISOR ?? '',
      razonSocial: env.SII_EMISOR_RAZON_SOCIAL ?? '',
      giro: env.SII_EMISOR_GIRO ?? '',
      acteco: Number(env.SII_EMISOR_ACTECO),
      direccion: env.SII_EMISOR_DIRECCION ?? '',
      comuna: env.SII_EMISOR_COMUNA ?? '',
      ...(env.SII_EMISOR_CIUDAD ? { ciudad: env.SII_EMISOR_CIUDAD } : {}),
    },
    fchResol: env.SII_FCH_RESOL ?? '',
    cafs,
    ...(env.SII_OFICINA ? { oficinaSii: env.SII_OFICINA } : {}),
  }, options.http);
}

/** SII de certificación con una configuración dada (la conexión del panel del proveedor). */
export function crearSiiConectado(config: ConfigSii, http: Http = crearHttp()): Sii {
  const certificado = abrirCertificado(config.certificado.pfx, config.certificado.clave);
  const autenticador = new Autenticador(http, certificado);
  const { emisor } = config;
  const cafs = new Map<number, Caf[]>();
  /** El CAF del tipo cuyo rango contiene el folio: cada folio se timbra con la llave de su propio rango. */
  const caf = (tipo: number, folio: number): Caf => {
    let delTipo = cafs.get(tipo);
    if (!delTipo) {
      delTipo = (config.cafs[tipo] ?? []).map(xml => leerCaf(xml));
      cafs.set(tipo, delTipo);
    }
    if (delTipo.length === 0) throw new Error(`[sii] no hay CAF para emitir el tipo ${tipo}`);
    return delTipo.find(c => folio >= c.folioDesde && folio <= c.folioHasta) ?? delTipo[0]!;
  };

  /** Arma, firma y sube un sobre con los documentos dados. Una sola subida, nunca se reintenta. */
  async function emitirLote(entradas: readonly Omit<EntradaDte, 'emisor'>[]): Promise<ResultadoLote> {
    const ahora = new Date();
    const dtes = entradas.map(entrada => armarDte({ ...entrada, emisor }, caf(entrada.tipo, entrada.folio), certificado, ahora));
    const sobreXml = armarSobre({
      rutEmisor: emisor.rut,
      fchResol: config.fchResol,
      documentos: dtes.map((dte, i) => ({ tipo: entradas[i]!.tipo, xml: dte.xml })),
      certificado,
      ahora,
    });
    const envio = await subirSobre(http, autenticador, { sobreXml, rutEmisor: emisor.rut, rutEnvia: certificado.rut });
    const resolucion = { numero: 0, fecha: config.fchResol };
    const oficinaSii = config.oficinaSii;
    const documentos = dtes.map((dte, i) => ({
      ...dte.documento,
      impreso: datosImpresos({ ...entradas[i]!, emisor }, { ted: dte.ted, resolucion, simulado: false, oficinaSii }),
    }));
    return { documentos, envio, sobreXml };
  }

  return {
    modo: 'certificacion',
    rutEmisor: emisor.rut,
    ...emisiones(emitirLote),
    estadoEnvio: trackId => estadoEnvio(http, autenticador, emisor.rut, trackId),
    estadoDocumento: consulta => estadoDocumento(http, autenticador, emisor.rut, consulta),
    registrarAccionReceptor: (documento, accion) => registrarAccion(http, autenticador, documento, accion),
    eventosDocumento: documento => listarEventos(http, autenticador, documento),
  };
}
