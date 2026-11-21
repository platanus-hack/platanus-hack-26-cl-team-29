// Crédito Bando: Bando le paga al proveedor al instante y el comprador le paga a Bando a 30, 45 o 60 días con su
// tarjeta inscrita. El cupo y el plazo suben con cada pago a tiempo y bajan con los atrasos.
// Decisión: docs/decisiones/20261121-2018-credito-bando.md

export interface NivelCredito {
  nivel: number;
  nombre: string;
  /** Deuda máxima vigente, en pesos con IVA. */
  cupo: number;
  plazoDias: number;
  /** Puntos de confianza desde los que se alcanza (un pago a tiempo suma 1, un atraso resta 3). */
  desde: number;
}

export const NIVELES_CREDITO: readonly NivelCredito[] = [
  { nivel: 1, nombre: 'Nuevo', cupo: 500_000, plazoDias: 30, desde: 0 },
  { nivel: 2, nombre: 'Confiable', cupo: 1_000_000, plazoDias: 45, desde: 3 },
  { nivel: 3, nombre: 'Socio', cupo: 3_000_000, plazoDias: 60, desde: 8 },
];

export interface HistorialCredito {
  pagadosATiempo: number;
  atrasados: number;
}

export interface LineaCredito extends NivelCredito {
  puntos: number;
  /** El próximo nivel y cuántos pagos a tiempo le faltan; null en el último. */
  siguiente: { nombre: string; cupo: number; plazoDias: number; faltan: number } | null;
}

export const puntosDeConfianza = (h: HistorialCredito): number => Math.max(0, h.pagadosATiempo - 3 * h.atrasados);

export function lineaDeCredito(h: HistorialCredito): LineaCredito {
  const puntos = puntosDeConfianza(h);
  const i = NIVELES_CREDITO.findLastIndex(n => puntos >= n.desde);
  const actual = NIVELES_CREDITO[i]!;
  const prox = NIVELES_CREDITO[i + 1];
  return { ...actual, puntos, siguiente: prox ? { nombre: prox.nombre, cupo: prox.cupo, plazoDias: prox.plazoDias, faltan: prox.desde - puntos } : null };
}

/** Día de vencimiento (`AAAA-MM-DD`) a `plazoDias` desde `desde`. */
export const vencimiento = (desde: string, plazoDias: number): string =>
  new Date(Date.parse(desde) + plazoDias * 86_400_000).toISOString().slice(0, 10);
