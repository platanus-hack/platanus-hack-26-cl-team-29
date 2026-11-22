import {
  ofertasQueCompiten, precioAjustado, precioDeOferta, precioDelProducto, precioDelReparto, precioPorVolumen, repartirPorStock, siguienteTramo,
  totalesDeCanasta, unidadesDe, unidadesDisponibles,
} from '../../shared/precios.ts';
import type { Ganadora, Licitacion, LicitacionVista, Oferta, ProductoCompra, ProductoCompraVista } from './tipos.ts';

// La compra conjunta vista producto por producto de la canasta. Los tramos y el precio de cada producto
// se calculan en shared/precios.ts, igual que en las pantallas.

/** Unidades de toda la canasta (suma de los carritos). */
export const totalUnidades = (l: Pick<Licitacion, 'participantes'>) => l.participantes.reduce((s, p) => s + p.cantidad, 0);

/** El producto de la canasta, o el primero si no se dice cuál (compatibilidad con un solo producto). */
export function productoDe(l: Pick<Licitacion, 'productos'>, productoId?: string): ProductoCompra | undefined {
  return productoId === undefined ? l.productos[0] : l.productos.find(p => p.id === productoId);
}

/** Lo que el precio necesita saber de la red: la nota de cada proveedor (ordena las ofertas) y la hora. */
export interface ContextoPrecio {
  notaDe(proveedorId: string): number;
  ahora(): string;
}

/**
 * Ofertas de un producto, de la mejor a la peor por precio ajustado: las ofertas que compiten y el tramo alcanzado de
 * quien creó el producto (lo que pide por ese volumen). Una por proveedor, la más barata, cada una con su stock.
 */
export function candidatasDe(l: Pick<Licitacion, 'participantes'>, p: ProductoCompra, ctx: ContextoPrecio): Ganadora[] {
  const unidades = unidadesDe(l, p.id);
  const porProveedor = new Map<string, Oferta>();
  const tramoDelCreador: Oferta[] = p.proveedorId && !p.creadorPendienteSii
    ? [{ proveedorId: p.proveedorId, productoId: p.id, precioUnitario: precioPorVolumen(p, unidades), plazoDias: 1, en: ctx.ahora(), ...(p.stock !== undefined ? { stock: p.stock } : {}) }]
    : [];
  // Cada oferta al precio de su tramo para el volumen que juntó el grupo.
  for (const o of [...ofertasQueCompiten(p.ofertas).map(x => ({ ...x, precioUnitario: precioDeOferta(x, unidades) })), ...tramoDelCreador]) {
    const actual = porProveedor.get(o.proveedorId);
    if (!actual || o.precioUnitario < actual.precioUnitario) porProveedor.set(o.proveedorId, o);
  }
  return [...porProveedor.values()]
    .map(o => {
      const nota = ctx.notaDe(o.proveedorId);
      return { ...o, nota, precioAjustado: precioAjustado(o, nota) };
    })
    .sort((a, b) => a.precioAjustado - b.precioAjustado);
}

/** Cómo se reparte hoy el pedido del grupo de un producto entre los proveedores, dentro de su stock. */
export const repartoDelGrupo = (l: Pick<Licitacion, 'participantes'>, p: ProductoCompra, ctx: ContextoPrecio) =>
  repartirPorStock(candidatasDe(l, p, ctx), unidadesDe(l, p.id));

/**
 * Lo que paga el grupo hoy por un producto (por defecto el primero), y lo que se factura al cerrar.
 * - Con proveedor fijo: el tramo alcanzado o, si es menor, la última oferta de ese proveedor.
 * - Sin él: el reparto del cierre (mejor precio ajustado primero, dentro del stock de cada uno) y el precio de la
 *   parte más cara que hace falta (`precioDelReparto`). Sin unidades ni ofertas, el tramo queda como referencia.
 */
export function precioVigente(l: Pick<Licitacion, 'productos' | 'participantes' | 'proveedorId'>, productoId: string | undefined, ctx: ContextoPrecio): number {
  const p = productoDe(l, productoId);
  if (!p) return 0;
  const unidades = unidadesDe(l, p.id);
  if (l.proveedorId || unidades <= 0) return precioDelProducto(p, unidades, l.proveedorId);
  const { partes } = repartoDelGrupo(l, p, ctx);
  return precioDelReparto(partes) ?? precioDelProducto(p, unidades);
}

/** Precio vigente de cada producto de la canasta, por id. */
export const preciosVigentes = (l: Licitacion, ctx: ContextoPrecio) => new Map(l.productos.map(p => [p.id, precioVigente(l, p.id, ctx)]));

export function vistaProducto(l: Licitacion, p: ProductoCompra, ctx: ContextoPrecio): ProductoCompraVista {
  const total = unidadesDe(l, p.id);
  const disponibles = l.proveedorId ? undefined : unidadesDisponibles(p);
  const reparto = l.proveedorId || total <= 0 ? undefined : repartoDelGrupo(l, p, ctx);
  const cubreElMejor = reparto && reparto.partes.length > 1 ? reparto.partes[0]!.cantidad : undefined;
  return {
    ...structuredClone(p), totalUnidades: total, precioActual: precioVigente(l, p.id, ctx), siguienteTramo: siguienteTramo(p.tramos, total),
    ...(disponibles !== undefined ? { quedan: Math.max(0, disponibles - total) } : {}),
    ...(cubreElMejor !== undefined ? { cubreElMejor } : {}),
  };
}

/** La licitación con sus datos derivados, como la ven pantallas y agente. Los campos de un solo producto reflejan `productos[0]`. */
export function vistaLicitacion(l: Licitacion, ctx: ContextoPrecio): LicitacionVista {
  const productos = l.productos.map(p => vistaProducto(l, p, ctx));
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
