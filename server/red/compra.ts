import type { Licitacion, LicitacionVista, SiguienteTramo } from './tipos.ts';

// Precio por volumen de la compra conjunta: mientras más unidades junta el grupo, más barato para todos.

export const totalUnidades = (l: Pick<Licitacion, 'participantes'>) => l.participantes.reduce((s, p) => s + p.cantidad, 0);

/** Precio unitario del tramo alcanzado por `total`; sin unidades, el precio de comprar solo. */
export function precioPorVolumen(l: Pick<Licitacion, 'tramos' | 'precioSolo'>, total: number): number {
  let precio = l.precioSolo;
  for (const t of [...l.tramos].sort((a, b) => a.desde - b.desde)) if (total >= t.desde) precio = t.precioUnitario;
  return precio;
}

export function siguienteTramo(l: Pick<Licitacion, 'tramos'>, total: number): SiguienteTramo | null {
  const t = [...l.tramos].sort((a, b) => a.desde - b.desde).find(x => x.desde > total);
  return t ? { desde: t.desde, precioUnitario: t.precioUnitario, faltan: t.desde - total } : null;
}

/** La licitación con sus datos derivados, como la ven pantallas y agente. */
export function vistaLicitacion(l: Licitacion): LicitacionVista {
  const total = totalUnidades(l);
  return { ...structuredClone(l), totalUnidades: total, precioActual: precioPorVolumen(l, total), siguienteTramo: siguienteTramo(l, total) };
}
