// Ficha de la empresa en la app nueva del SII de certificación ("Actualizar datos de empresa y usuarios (Nuevo)",
// `www2c.sii.cl/sii-muyd-inter/`), SOLO LECTURA. Reemplaza a `ad_empresa1` y `ad_empresa2` de maullin, que responden 302
// a la página 404 del SII. La API es JSON en `/app/sii-muyd/ct/<rut>-<DV>/...` y se usa como la usa la SPA:
// - Secuencia: GET de la SPA (como navegación, fija sus cookies), GET `/app/session/status`, GET
//   `esUsuarioAdministrador` y recién ahí la lectura. Sin `session/status` antes, la API ha respondido 401.
// - Cabeceras de una llamada XHR, `X-SII-SESSION-USER-AUTH-TYPE: CT` (aunque el login sea con certificado) y
//   `X-SII-SESSION-USER-ID` con el RUT del titular.
// - Nunca se llama `existEmpresa` (pide la verificación en dos pasos y no hace falta) ni `actualizarEmpresa` (escribe).
// Los rechazos de la API (401, 428, 403) los reconoce `rechazo.ts`. Detalle en docs/hallazgos.
import { normalizarRut } from '../../shared/rut.ts';
import { ErrorPortal } from './errores.ts';
import type { RespuestaHttp } from './http.ts';
import type { SesionPortal } from './portal.ts';

/**
 * Resolución de la empresa, la que va en la carátula del sobre. Es POR AMBIENTE: en certificación el número es 0 y la
 * fecha es la de la postulación; mezclarla con otra da `RCT` (CRT-3-19 "Fecha/Numero Resolucion Invalido"). Nunca se usa
 * un valor por defecto.
 */
export interface Resolucion {
  /** `AAAA-MM-DD`. */
  fecha: string;
  numero: number;
  fechaAutorizacion: string | null;
  razonSocial: string | null;
}

const ORIGEN = 'https://www2c.sii.cl';
const SPA_MANTENEDOR = `${ORIGEN}/sii-muyd-inter/`;
const API = `${ORIGEN}/app/sii-muyd/ct`;
const ESTADO_SESION = `${ORIGEN}/app/session/status`;

/** Llamadas a la API de la app para una empresa, ya abierta la app con la sesión. */
interface Mantenedor {
  obtener(accion: 'obtenerEmpresa' | 'obtenerContribuyente'): Promise<RespuestaHttp>;
}

function json(r: RespuestaHttp, paso: string): Record<string, unknown> {
  try {
    const valor: unknown = JSON.parse(r.cuerpo);
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) return valor as Record<string, unknown>;
  } catch { /* abajo */ }
  throw new ErrorPortal('RESPUESTA_INESPERADA', `La app del SII no respondió JSON en ${paso} (HTTP ${r.estado}).`, { paso, mensajeSii: r.cuerpo.slice(0, 2000) });
}

/** Abre la app con la sesión del portal. Falla con el estado y el cuerpo literal del SII si un paso no responde 200. */
async function abrirMantenedor(sesion: SesionPortal, rutEmpresa: string): Promise<Mantenedor> {
  const empresa = normalizarRut(rutEmpresa);
  const cabeceras: [string, string][] = [
    ['X-SII-SESSION-USER-AUTH-TYPE', 'CT'],
    ['X-SII-SESSION-USER-ID', normalizarRut(sesion.rutTitular)],
  ];
  const xhr = async (paso: string, url: string) => {
    const r = await sesion.pedir({ paso, metodo: 'GET', url, modo: 'xhr', referer: SPA_MANTENEDOR, cabeceras });
    if (r.estado !== 200) {
      throw new ErrorPortal('RESPUESTA_INESPERADA', `La app del SII respondió HTTP ${r.estado} en ${paso}.`, { paso, mensajeSii: r.cuerpo.trim() || r.ubicacion });
    }
    return r;
  };
  const spa = await sesion.pedir({ paso: 'sii-muyd-inter', metodo: 'GET', url: SPA_MANTENEDOR });
  if (spa.estado !== 200) {
    throw new ErrorPortal('RESPUESTA_INESPERADA', `El SII no abrió la app de datos de la empresa (HTTP ${spa.estado}).`, { paso: 'sii-muyd-inter', mensajeSii: spa.ubicacion });
  }
  await xhr('session_status', ESTADO_SESION);
  await xhr('esUsuarioAdministrador', `${API}/${empresa}/esUsuarioAdministrador`);
  return { obtener: accion => xhr(accion, `${API}/${empresa}/${accion}`) };
}

/** `aaaa-mm-dd` tal cual (la API ya la entrega así); otra forma es null: la resolución no se inventa. */
const fechaIso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);

/**
 * Lee la resolución de `obtenerEmpresa` (`fechaResolucion`, `resolucion`, `fechaAutorizacion`) y la razón social de
 * `obtenerContribuyente` (`razonSocial`, o nombres y apellidos de una persona natural, como la arma la SPA).
 */
export function leerResolucion(empresa: RespuestaHttp, contribuyente: RespuestaHttp | null): Resolucion {
  const e = json(empresa, 'obtenerEmpresa');
  const fecha = fechaIso(e.fechaResolucion);
  const numero = String(e.resolucion ?? '').trim();
  if (!fecha || !/^\d+$/.test(numero)) {
    throw new ErrorPortal('RESPUESTA_INESPERADA', 'La app del SII no entregó la fecha y el número de resolución de la empresa.', { paso: 'obtenerEmpresa', mensajeSii: empresa.cuerpo.slice(0, 2000) });
  }
  let razonSocial: string | null = null;
  if (contribuyente) {
    const c = json(contribuyente, 'obtenerContribuyente');
    const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    razonSocial = texto(c.razonSocial) || [c.nombres, c.apellidoPaterno, c.apellidoMaterno].map(texto).filter(Boolean).join(' ') || null;
  }
  return { fecha, numero: Number(numero), fechaAutorizacion: fechaIso(e.fechaAutorizacion), razonSocial };
}

/**
 * Resolución de certificación desde la app nueva. La razón social es de apoyo: si `obtenerContribuyente` no la entrega,
 * la resolución igual sirve (una sesión vencida o la verificación en dos pasos sí cortan).
 */
export async function consultarResolucion(sesion: SesionPortal, rutEmpresa: string): Promise<Resolucion> {
  const app = await abrirMantenedor(sesion, rutEmpresa);
  const empresa = await app.obtener('obtenerEmpresa');
  const contribuyente = await app.obtener('obtenerContribuyente').catch((error: unknown) => {
    if (error instanceof ErrorPortal && error.codigo === 'RESPUESTA_INESPERADA') return null;
    throw error;
  });
  return leerResolucion(empresa, contribuyente);
}
