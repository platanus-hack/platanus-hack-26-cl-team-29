import { precioDelProducto, siguienteTramo, totalesDeCanasta, unidadesDe, unidadesDisponibles } from '../../shared/precios.ts';
import type { Licitacion, LicitacionVista, ProductoCompra, ProductoCompraVista } from './tipos.ts';

// La compra conjunta vista producto por producto de la canasta. Los tramos y el precio de cada producto
// se calculan en shared/precios.ts, igual que en las pantallas.

/** Unidades de toda la canasta (suma de los carritos). */
export const totalUnidades = (l: Pick<Licitacion, 'participantes'>) => l.participantes.reduce((s, p) => s + p.cantidad, 0);

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
  return p ? precioDelProducto(p, unidadesDe(l, p.id), l.proveedorId) : 0;
}

/** Precio vigente de cada producto de la canasta, por id. */
export const preciosVigentes = (l: Licitacion) => new Map(l.productos.map(p => [p.id, precioVigente(l, p.id)]));

export function vistaProducto(l: Licitacion, p: ProductoCompra): ProductoCompraVista {
  const total = unidadesDe(l, p.id);
  const disponibles = l.proveedorId ? undefined : unidadesDisponibles(p);
  return {
    ...structuredClone(p), totalUnidades: total, precioActual: precioVigente(l, p.id), siguienteTramo: siguienteTramo(p.tramos, total),
    ...(disponibles !== undefined ? { quedan: Math.max(0, disponibles - total) } : {}),
  };
}

/** La licitación con sus datos derivados, como la ven pantallas y agente. Los campos de un solo producto reflejan `productos[0]`. */
export function vistaLicitacion(l: Licitacion): LicitacionVista {
  const productos = l.productos.map(p => vistaProducto(l, p));
  const primero = productos[0];
  const { montoTotal, ahorroTotal } = totalesDeCanasta(productos);
  return {
    ...structuredClone(l),
    ...(primero ? {
      producto: primero.nombre, unidad: primero.unidad, unidadPlural: primero.unidadPlural, precioSolo: primero.precioSolo,
      tramos: structuredClone(primero.tramos), ofertas: structuredClone(primero.ofertas),
    } : {}),
    productos,
    totalNegocios: l.participantes.filter(p => p.cantidad > 0).length,
    totalUnidades: totalUnidades(l),
    montoTotal,
    ahorroTotal,
    precioActual: primero?.precioActual ?? l.precioSolo,
    siguienteTramo: primero?.siguienteTramo ?? null,
  };
}
