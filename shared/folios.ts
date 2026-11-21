// Política de reposición de folios: cuántos folios libres mantener por tipo y qué hacer cuando faltan. Pura: no
// toca el SII ni el reloj; la reposición (server/conexion-sii/reposicion.ts) le entrega lo que sabe y ejecuta lo que decide.
//
// Reglas del SII que la sostienen (detalle en docs/decisiones, reposición automática de folios):
// - Orden de remedios: usar lo que hay, REOBTENER rangos ya autorizados sin usar (no gasta cupo) y solo después
//   PEDIR folios nuevos. Anular no existe en esta app: es irreversible y pesa seis meses contra el cupo.
// - Folios timbrados y sin usar son lo que hace que el SII racione o bloquee el timbraje: nunca se pide más de lo
//   que falta para el mínimo, ni por adelantado "por si acaso", y nunca más que el tope que publica el SII (MAX_AUTOR).
// - Un rechazo del timbraje se respeta: no se vuelve a intentar antes de que termine la espera (enfriamiento).
import type { TipoDocumento } from './documentos.ts';

export interface PoliticaTipo {
  /** Folios libres que se mantienen siempre, aunque no haya demanda a la vista. */
  piso: number;
  /** Folios de holgura sobre la demanda esperada. */
  margen: number;
  /** Solo se repone si el tipo ya tiene un CAF (la empresa lo usa); si no, no se le piden folios al SII. */
  soloConCaf: boolean;
}

/** Factura: al menos max(10, demanda + 5). Guía y nota de crédito: 5, y solo si ya tienen CAF. */
export const POLITICA_FOLIOS: Readonly<Record<TipoDocumento, PoliticaTipo>> = {
  33: { piso: 10, margen: 5, soloConCaf: false },
  52: { piso: 5, margen: 0, soloConCaf: true },
  61: { piso: 5, margen: 0, soloConCaf: true },
};

/** Folios libres que el tipo debe tener para cubrir `demanda` documentos más su holgura. */
export const minimoDeFolios = (tipo: TipoDocumento, demanda: number): number =>
  Math.max(POLITICA_FOLIOS[tipo].piso, Math.max(0, demanda) + POLITICA_FOLIOS[tipo].margen);

/**
 * Demanda con que "Traer más folios" llama a la reposición: lo que falta para el mínimo o, si ya está cubierto, un
 * lote del tamaño del piso (10 facturas, 5 guías o notas). Nunca un pedido grande "por si acaso".
 */
export const demandaManual = (tipo: TipoDocumento, libres: number): number =>
  libres + POLITICA_FOLIOS[tipo].piso - POLITICA_FOLIOS[tipo].margen;

export interface Situacion {
  tipo: TipoDocumento;
  /** Folios libres hoy en los CAF guardados. */
  libres: number;
  /** Documentos que se esperan emitir pronto (por ejemplo, compradores de una compra conjunta por facturar). */
  demanda: number;
  tieneCaf: boolean;
  /** Instante (epoch ms) hasta el que no se toca el SII tras un rechazo; null sin espera. */
  esperaHasta: number | null;
  ahora: number;
  /**
   * Quedan rangos reobtenibles sin revisar. null: aún no se sabe (hay que listarlos). false: ya se revisaron todos
   * y ninguno tiene folios libres, recién entonces se piden folios nuevos.
   */
  quedanReobtenibles: boolean | null;
  /** `MAX_AUTOR` leído del SII en esta corrida; null si no se ha leído o el SII no raciona el tipo. */
  tope: number | null;
}

export type DecisionFolios =
  | { accion: 'nada'; motivo: 'suficiente' | 'sin_caf'; minimo: number }
  | { accion: 'esperar'; hasta: number; minimo: number }
  | { accion: 'reobtener'; faltan: number; minimo: number }
  | { accion: 'pedir'; cantidad: number; minimo: number }
  /** El SII publica un tope de 0 folios: no hay nada que pedir. */
  | { accion: 'sin_cupo'; minimo: number };

export function decidirReposicion(s: Situacion): DecisionFolios {
  const minimo = minimoDeFolios(s.tipo, s.demanda);
  if (POLITICA_FOLIOS[s.tipo].soloConCaf && !s.tieneCaf) return { accion: 'nada', motivo: 'sin_caf', minimo };
  const faltan = minimo - s.libres;
  if (faltan <= 0) return { accion: 'nada', motivo: 'suficiente', minimo };
  if (s.esperaHasta !== null && s.esperaHasta > s.ahora) return { accion: 'esperar', hasta: s.esperaHasta, minimo };
  if (s.quedanReobtenibles !== false) return { accion: 'reobtener', faltan, minimo };
  if (s.tope !== null && s.tope < 1) return { accion: 'sin_cupo', minimo };
  return { accion: 'pedir', cantidad: s.tope === null ? faltan : Math.min(faltan, s.tope), minimo };
}

/** Clase del fallo: un rechazo del SII (con texto) espera más que una falla pasajera (red, página inesperada). */
export type ClaseFallo = 'rechazo' | 'transitorio';

const MINUTO_MS = 60_000;
const ESPERA_BASE_MIN: Record<ClaseFallo, number> = { rechazo: 60, transitorio: 15 };
const ESPERA_TOPE_MIN = 24 * 60;

/**
 * Espera tras el fallo número `intentos` (1 = el primero): base × 2^(n-1), con tope de un día. Insistir antes solo
 * gasta sesiones del SII y puede agravar el bloqueo del timbraje.
 */
export function esperaTrasFallo(clase: ClaseFallo, intentos: number): number {
  const n = Math.min(Math.max(1, Math.floor(intentos)), 20);
  return Math.min(ESPERA_BASE_MIN[clase] * 2 ** (n - 1), ESPERA_TOPE_MIN) * MINUTO_MS;
}
