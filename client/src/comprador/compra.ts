// Lo que muestra la compra en grupo del comprador (DESIGN.md, Paper C2 y C3), sin React: la escalera de tramos,
// el frasco que se llena y quiénes van, para poder probarlo con node:test.

import { dinero } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { ordenarTramos, tramoAlcanzado, type SiguienteTramo, type Tramo } from '../../../shared/precios.ts';

/** `superado`: un tramo más caro que ya se pasó. `lejano`: más allá del siguiente. */
export type EstadoPeldano = 'lejano' | 'siguiente' | 'actual' | 'superado';

export interface Peldano {
  desde: number;
  /** Última unidad del tramo; null en el último (sin tope). */
  hasta: number | null;
  precio: number;
  estado: EstadoPeldano;
}

/** Los tramos de más volumen (más barato) a menos, marcando el vigente y el siguiente. */
export function escalera(tramos: readonly Tramo[], unidades: number): Peldano[] {
  const t = ordenarTramos(tramos);
  const alcanzado = tramoAlcanzado(t, unidades);
  const actual = alcanzado ? t.indexOf(alcanzado) : -1;
  const estado = (i: number): EstadoPeldano =>
    i === actual ? 'actual' : i === actual + 1 ? 'siguiente' : i < actual ? 'superado' : 'lejano';
  return t
    .map((x, i) => ({ desde: x.desde, hasta: t[i + 1] ? t[i + 1].desde - 1 : null, precio: x.precioUnitario, estado: estado(i) }))
    .reverse();
}

interface Unidades {
  unidad: string;
  unidadPlural: string;
}

/** "50 cajas o más", "20 a 34 cajas", "1 caja". */
export function rango(p: Pick<Peldano, 'desde' | 'hasta'>, u: Unidades): string {
  if (p.hasta === null) return `${contar(p.desde, u.unidad, u.unidadPlural)} o más`;
  if (p.hasta === p.desde) return contar(p.desde, u.unidad, u.unidadPlural);
  return `${p.desde} a ${contar(p.hasta, u.unidad, u.unidadPlural)}`;
}

export interface Frasco {
  /** Hasta dónde se mide: el siguiente tramo o, si ya no hay, el último. */
  meta: number;
  /** 0 a 1. */
  llenado: number;
  /** Alturas (0 a 1) donde empieza cada tramo bajo la meta. */
  marcas: number[];
}

/** El frasco de miel de la compra: se llena hacia el siguiente tramo. */
export function frasco(tramos: readonly Tramo[], unidades: number, siguiente: SiguienteTramo | null): Frasco {
  const ultimo = ordenarTramos(tramos).at(-1)?.desde ?? 0;
  const meta = Math.max(1, siguiente?.desde ?? Math.max(ultimo, unidades));
  const marcas = ordenarTramos(tramos).map(t => t.desde / meta).filter(f => f > 0.05 && f < 1);
  return { meta, llenado: Math.min(1, unidades / meta), marcas };
}

/** "Si llegan a 50 cajas, pagas $162.000." Vacío si ya no hay un tramo más barato. */
export function siLlegan(siguiente: SiguienteTramo | null, cantidad: number, u: Unidades): string {
  if (!siguiente || cantidad < 1) return '';
  return `Si llegan a ${contar(siguiente.desde, u.unidad, u.unidadPlural)}, pagas ${dinero(cantidad * siguiente.precioUnitario)}.`;
}

/**
 * Cuántos locales van y de qué comunas, sin nombres (DESIGN.md: nunca el nombre de otro comprador).
 * "11 locales de Providencia y Ñuñoa", "1 local de Ñuñoa", "3 locales".
 */
export function localesDelGrupo(
  participantes: readonly { negocioId?: string; cantidad: number }[],
  negocios: readonly { id: string; comuna?: string }[],
): string {
  const van = participantes.filter(p => p.cantidad > 0);
  if (!van.length) return '';
  const porComuna = new Map<string, number>();
  for (const p of van) {
    const comuna = negocios.find(n => n.id === p.negocioId)?.comuna?.trim();
    if (comuna) porComuna.set(comuna, (porComuna.get(comuna) ?? 0) + 1);
  }
  const comunas = [...porComuna].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([c]) => c);
  const cuantos = contar(van.length, 'local', 'locales');
  return comunas.length ? `${cuantos} de ${comunas.join(' y ')}` : cuantos;
}
