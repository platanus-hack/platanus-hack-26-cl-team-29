// Transporte hacia el SII: sobres SOAP armados a mano, una cola de 1 solicitud por segundo y lectura de respuestas.

/** Hosts de CERTIFICACIÓN. Este módulo no habla con producción. */
export const URLS = {
  semilla: 'https://maullin.sii.cl/DTEWS/CrSeed.jws',
  token: 'https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws',
  subida: 'https://maullin.sii.cl/cgi_dte/UPL/DTEUpload',
  estadoEnvio: 'https://maullin.sii.cl/DTEWS/QueryEstUp.jws',
  estadoDocumento: 'https://maullin.sii.cl/DTEWS/QueryEstDte.jws',
  reclamo: 'https://ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice',
} as const;

/** El User-Agent con que el SII recibe hoy los servicios SOAP y la subida. */
export const USER_AGENT = 'Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)';

export const CABECERAS_SOAP = { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' } as const;

/** Error de negocio o de forma del SII. `respuesta` trae el cuerpo completo, sin recortar. */
export class ErrorSii extends Error {
  readonly respuesta: string;
  constructor(mensaje: string, respuesta: string) {
    super(mensaje);
    this.name = 'ErrorSii';
    this.respuesta = respuesta;
  }
}

/** Sobre SOAP 1.1. Solo el WS de reclamos lleva `<soapenv:Header/>` y su propio espacio de nombres. */
export function sobreSoap(cuerpo: string, opciones: { readonly espacios?: string; readonly cabecera?: boolean } = {}): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"` +
    `${opciones.espacios ?? ''}>\n  ${opciones.cabecera ? '<soapenv:Header/>\n  ' : ''}<soapenv:Body>${cuerpo}</soapenv:Body>\n</soapenv:Envelope>`
  );
}

/**
 * Las respuestas SOAP del SII traen otro XML escapado dentro (`&lt;SII:RESPUESTA&gt;`). Se desescapa todo una vez y
 * se leen las etiquetas por nombre, con o sin prefijo.
 */
export function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

const patron = (nombre: string): RegExp =>
  new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`, 'g');

export const todas = (texto: string, nombre: string): string[] =>
  [...texto.matchAll(patron(nombre))].map(m => (m[1] ?? '').trim());

export const etiqueta = (texto: string, nombre: string): string | null => todas(texto, nombre)[0] ?? null;

export interface RespuestaHttp {
  readonly status: number;
  readonly cuerpo: string;
}

export interface SolicitudHttp {
  readonly url: string;
  readonly cabeceras: Readonly<Record<string, string>>;
  readonly cuerpo: string | Uint8Array;
  /** Cómo se decodifica la respuesta: la subida responde en Latin-1. */
  readonly codificacion?: 'utf8' | 'latin1';
}

/** Un POST al SII. Un corte de red o un timeout se propaga como excepción: quien llama decide si es ambiguo. */
export type Http = (solicitud: SolicitudHttp) => Promise<RespuestaHttp>;

/**
 * Cola en serie: cada solicitud espera a que termine la anterior y a que pase `intervaloMs` desde que empezó.
 * El SII recomienda como máximo 1 solicitud por segundo y su WAF bloquea a quien lo excede.
 */
export class ColaSii {
  readonly #intervaloMs: number;
  #ultimoInicio = 0;
  #cola: Promise<unknown> = Promise.resolve();

  constructor(intervaloMs: number) {
    this.#intervaloMs = intervaloMs;
  }

  turno<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.#cola.then(async () => {
      const espera = this.#ultimoInicio + this.#intervaloMs - Date.now();
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      this.#ultimoInicio = Date.now();
      return tarea();
    });
    this.#cola = resultado.catch(() => undefined);
    return resultado;
  }
}

/** Una sola cola por proceso, compartida por todas las instancias. */
const COLA_DEL_PROCESO = new ColaSii(1000);
const TIMEOUT_MS = 60_000;

export function crearHttp(opciones: { readonly fetch?: typeof fetch; readonly cola?: ColaSii } = {}): Http {
  const hacerFetch = opciones.fetch ?? fetch;
  const cola = opciones.cola ?? COLA_DEL_PROCESO;
  return solicitud =>
    cola.turno(async () => {
      const respuesta = await hacerFetch(solicitud.url, {
        method: 'POST',
        headers: { ...solicitud.cabeceras },
        body: typeof solicitud.cuerpo === 'string' ? solicitud.cuerpo : new Uint8Array(solicitud.cuerpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const bytes = Buffer.from(await respuesta.arrayBuffer());
      return { status: respuesta.status, cuerpo: bytes.toString(solicitud.codificacion ?? 'utf8') };
    });
}
