import type { Licitacion, LicitacionVista, ProductoCompra, ProductoCompraVista, SiguienteTramo, Tramo } from './tipos.ts';

// Precio por volumen de la compra conjunta, producto por producto de la canasta: mientras más unidades
// de un producto junta el grupo, más barato ese producto para todos.

type ConPrecio = { tramos: Tramo[]; precioSolo: number };

/** Unidades de toda la canasta (suma de los carritos). */
export const totalUnidades = (l: Pick<Licitacion, 'participantes'>) => l.participantes.reduce((s, p) => s + p.cantidad, 0);

/** Unidades de un producto de la canasta (suma de ese ítem en los carritos). */
export const unidadesDe = (l: Pick<Licitacion, 'participantes'>, productoId: string) =>
  l.participantes.reduce((s, p) => s + p.items.filter(i => i.productoId === productoId).reduce((t, i) => t + i.cantidad, 0), 0);

/** Precio unitario del tramo alcanzado por `total`; sin unidades, el precio de comprar solo. */
export function precioPorVolumen(p: ConPrecio, total: number): number {
  let precio = p.precioSolo;
  for (const t of [...p.tramos].sort((a, b) => a.desde - b.desde)) if (total >= t.desde) precio = t.precioUnitario;
  return precio;
}

export function siguienteTramo(p: Pick<ConPrecio, 'tramos'>, total: number): SiguienteTramo | null {
  const t = [...p.tramos].sort((a, b) => a.desde - b.desde).find(x => x.desde > total);
  return t ? { desde: t.desde, precioUnitario: t.precioUnitario, faltan: t.desde - total } : null;
}

/** El producto de la canasta, o el primero si no se dice cuál (compatibilidad con un solo producto). */
export function productoDe(l: Pick<Licitacion, 'productos'>, productoId?: string): ProductoCompra | undefined {
  return productoId === undefined ? l.productos[0] : l.productos.find(p => p.id === productoId);
}

/**
 * Lo que paga el grupo hoy por un producto (por defecto el primero): el tramo alcanzado o, si es menor, la
 * última oferta del proveedor de la compra conjunta por ese producto. Nunca sobre el precio del tramo.
 */
export function precioVigente(l: Pick<Licitacion, 'productos' | 'participantes' | 'proveedorId'>, productoId?: string): number {
  const p = productoDe(l, productoId);
  if (!p) return 0;
  const unidades = unidadesDe(l, p.id);
  const tramo = precioPorVolumen(p, unidades);
  const propia = l.proveedorId ? p.ofertas.find(o => o.proveedorId === l.proveedorId) : undefined;
  return propia && unidades > 0 ? Math.min(tramo, propia.precioUnitario) : tramo;
}

/** Precio vigente de cada producto de la canasta, por id. */
export const preciosVigentes = (l: Licitacion) => new Map(l.productos.map(p => [p.id, precioVigente(l, p.id)]));

function vistaProducto(l: Licitacion, p: ProductoCompra): ProductoCompraVista {
  const total = unidadesDe(l, p.id);
  return { ...structuredClone(p), totalUnidades: total, precioActual: precioVigente(l, p.id), siguienteTramo: siguienteTramo(p, total) };
}

/** La licitación con sus datos derivados, como la ven pantallas y agente. Los campos de un solo producto reflejan `productos[0]`. */
export function vistaLicitacion(l: Licitacion): LicitacionVista {
  const productos = l.productos.map(p => vistaProducto(l, p));
  const primero = productos[0];
  return {
    ...structuredClone(l),
    ...(primero ? {
      producto: primero.nombre, unidad: primero.unidad, unidadPlural: primero.unidadPlural, precioSolo: primero.precioSolo,
      tramos: structuredClone(primero.tramos), ofertas: structuredClone(primero.ofertas),
    } : {}),
    productos,
    totalNegocios: l.participantes.filter(p => p.cantidad > 0).length,
    totalUnidades: totalUnidades(l),
    montoTotal: productos.reduce((s, p) => s + p.totalUnidades * p.precioActual, 0),
    ahorroTotal: productos.reduce((s, p) => s + p.totalUnidades * (p.precioSolo - p.precioActual), 0),
    precioActual: primero?.precioActual ?? l.precioSolo,
    siguienteTramo: primero?.siguienteTramo ?? null,
  };
}
