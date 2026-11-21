// Consulta pública STC del SII ("Situación Tributaria de Terceros", www2.sii.cl): nombre, inicio de actividades,
// giros y timbrajes por RUT. Sin certificado, sin sesión y sin ambiente.
//
// Reglas (verificadas el 2026-10-26 y el 2026-11-16):
// - No entrega dirección, comuna, tamaño ni ventas: solo nombre, giros y timbrajes.
// - Es una lectura: se repite ante 5xx o corte de red; nunca ante una respuesta 200 inesperada.
// - `registrado: false` o `captchaInvalido: true` no tienen captura y salen como error con el texto literal del SII.
// - Un RUT sin inicio de actividades responde `registrado: true`, nombre "**" y sin giros: lo distingue
//   `inicioActividades: false`.
import { partirRut } from '../../shared/rut.ts';
import { USER_AGENT } from './http.ts';

export const URL_STC = 'https://www2.sii.cl/app/stc/recurso/v1/consulta/getConsultaData/';
export const ORIGEN_STC = 'https://www2.sii.cl';
export const REFERER_STC = 'https://www2.sii.cl/stc/noauthz/consulta';

/** Giro de un contribuyente en la consulta pública: código, descripción, si es afecto a IVA y fecha de inicio. */
export interface GiroNegocio {
  codigo: string;
  descripcion: string;
  afectoIva: boolean;
  fechaInicio: string;
}

/** Timbraje (folios autorizados) de un tipo de documento, con su último folio del año. */
export interface TimbrajeConsultaPublica {
  /** Código del documento sin ceros iniciales ("0033" llega, 33 sale). */
  tipoDocumento: number;
  descripcion: string;
  anio: string;
  /** Último folio autorizado en el año; el SII lo entrega con espacios a la izquierda. */
  folioFinal: number | null;
}

/** Datos de un contribuyente en la consulta pública del SII. */
export interface ConsultaPublicaContribuyente {
  nombre: string;
  fechaConsulta: string;
  inicioActividades: boolean;
  fechaInicioActividades: string | null;
  giros: GiroNegocio[];
  timbrajes: TimbrajeConsultaPublica[];
}

/** La STC no entregó una respuesta legible. `mensajeSii` lleva el cuerpo literal (sin truncar) para diagnosticar. */
export class ErrorStc extends Error {
  readonly estado: number | null;
  readonly mensajeSii: string | null;
  /** El SII respondió que el RUT no está registrado (`registrado: false`). */
  readonly noRegistrado: boolean;
  constructor(mensaje: string, o: { estado?: number | null; mensajeSii?: string | null; noRegistrado?: boolean } = {}) {
    super(mensaje);
    this.name = 'ErrorStc';
    this.estado = o.estado ?? null;
    this.mensajeSii = o.mensajeSii ?? null;
    this.noRegistrado = o.noRegistrado ?? false;
  }
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Lee la respuesta de `getConsultaData`. Solo se leen los campos vistos en la captura de un contribuyente registrado.
 * Lanza `ErrorStc` con el cuerpo literal si el estado no es 200, no es JSON, no está registrado o el captcha falló.
 */
export function leerConsultaPublicaContribuyente(estado: number, cuerpo: string): ConsultaPublicaContribuyente {
  let json: Record<string, unknown> | null;
  try {
    json = objeto(JSON.parse(cuerpo));
  } catch {
    json = null;
  }
  const fallar = (detalle: string, noRegistrado = false) =>
    new ErrorStc(`Consulta pública STC: ${detalle} (HTTP ${estado})`, { estado, mensajeSii: cuerpo, noRegistrado });
  if (estado !== 200 || json === null) throw fallar('respuesta inesperada');
  if (json.registrado === false) throw fallar('RUT no registrado', true);
  if (json.registrado !== true || json.captchaInvalido !== false) throw fallar('respuesta inesperada');

  const giros: GiroNegocio[] = [];
  for (const g of Array.isArray(json.girosNegocio) ? json.girosNegocio : []) {
    const o = objeto(g);
    if (!o || typeof o.codigo !== 'string' || typeof o.descripcion !== 'string' || typeof o.fechaInicio !== 'string') throw fallar('giros ilegibles');
    giros.push({ codigo: o.codigo, descripcion: o.descripcion, afectoIva: o.indicadorAfectoIva === 'S', fechaInicio: o.fechaInicio });
  }

  const timbrajes: TimbrajeConsultaPublica[] = [];
  for (const t of Array.isArray(json.timbrajes) ? json.timbrajes : []) {
    const o = objeto(t);
    if (!o || typeof o.codigo !== 'string' || typeof o.descripcion !== 'string' || typeof o.fechaTimbraje !== 'string') throw fallar('timbrajes ilegibles');
    const folio = typeof o.folioFinal === 'string' && o.folioFinal.trim() !== '' ? Number(o.folioFinal) : null;
    timbrajes.push({
      tipoDocumento: Number(o.codigo),
      descripcion: o.descripcion.trim(),
      anio: o.fechaTimbraje,
      folioFinal: folio === null || Number.isNaN(folio) ? null : folio,
    });
  }

  if (typeof json.nombre !== 'string' || typeof json.fechaConsulta !== 'string' || typeof json.inicioActividades !== 'boolean') throw fallar('respuesta inesperada');
  return {
    nombre: json.nombre,
    fechaConsulta: json.fechaConsulta,
    inicioActividades: json.inicioActividades,
    fechaInicioActividades: typeof json.fechaInicioActividades === 'string' ? json.fechaInicioActividades : null,
    giros,
    timbrajes,
  };
}

export interface OpcionesStc {
  fetch?: typeof fetch;
  /** Tope de cada intento. Por defecto 30 s. */
  tiempoMaxMs?: number;
  /** Intentos ante 5xx o corte de red. Por defecto 3. */
  intentos?: number;
  esperar?: (ms: number) => Promise<void>;
}

const esperarMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Consulta pública STC por RUT ("12345678-5"). Lanza si el RUT no es válido, `ErrorStc` si el SII no entrega una
 * respuesta legible (con `noRegistrado` si dice que el RUT no existe). Repite ante 5xx o corte de red.
 */
export async function consultarContribuyentePublico(rut: string, o: OpcionesStc = {}): Promise<ConsultaPublicaContribuyente> {
  const [cuerpoRut, dv] = partirRut(rut);
  const { fetch: f = fetch, tiempoMaxMs = 30_000, intentos = 3, esperar = esperarMs } = o;
  const cuerpo = JSON.stringify({ rut: cuerpoRut, dv, reAction: 'consultaSTC', reToken: ' ' });
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    if (i > 0) await esperar(1000 * 2 ** (i - 1));
    let respuesta: Response;
    try {
      respuesta = await f(URL_STC, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
          accept: 'application/json',
          origin: ORIGEN_STC,
          referer: REFERER_STC,
        },
        body: cuerpo,
        signal: AbortSignal.timeout(tiempoMaxMs),
      });
    } catch (error) {
      ultimo = new ErrorStc(`Consulta pública STC: no se pudo conectar (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const texto = await respuesta.text();
    if (respuesta.status >= 500) {
      ultimo = new ErrorStc(`Consulta pública STC: el SII respondió ${respuesta.status}`, { estado: respuesta.status, mensajeSii: texto });
      continue;
    }
    return leerConsultaPublicaContribuyente(respuesta.status, texto);
  }
  throw ultimo;
}
