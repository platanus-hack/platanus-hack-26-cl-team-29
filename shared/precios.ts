// Precio de la compra conjunta: tramos por volumen (mientras más unidades junta el grupo, más barato para
// todos), la oferta del proveedor que lo deja bajo el tramo y el puntaje con que se comparan las ofertas.

/** Desde `desde` unidades del grupo, todos pagan `precioUnitario`. */
export interface Tramo {
  desde: number;
  precioUnitario: number;
}

export interface SiguienteTramo extends Tramo {
  /** Unidades que le faltan al grupo para llegar a este tramo. */
  faltan: number;
}

/** Lo que hace falta de un producto para saber su precio. */
export interface ConPrecio<S extends number | undefined = number> {
  tramos?: readonly Tramo[];
  precioSolo: S;
}

export const ordenarTramos = (tramos: readonly Tramo[] = []): Tramo[] => [...tramos].sort((a, b) => a.desde - b.desde);

/** El tramo más alto que alcanzan `unidades`, si alcanzan alguno. */
export const tramoAlcanzado = (tramos: readonly Tramo[] | undefined, unidades: number): Tramo | undefined =>
  ordenarTramos(tramos).filter(t => unidades >= t.desde).at(-1);

/** Precio unitario con `unidades` en el grupo: el del tramo alcanzado o, si ninguno, el de comprar solo. */
export function precioPorVolumen<S extends number | undefined>(p: ConPrecio<S>, unidades: number): number | S {
  return tramoAlcanzado(p.tramos, unidades)?.precioUnitario ?? p.precioSolo;
}

/** El próximo tramo desde `unidades`. Con `bajoDe`, solo uno que de verdad baje de ese precio. */
export function siguienteTramo(tramos: readonly Tramo[] | undefined, unidades: number, bajoDe = Infinity): SiguienteTramo | null {
  const t = ordenarTramos(tramos).find(x => x.desde > unidades && x.precioUnitario < bajoDe);
  return t ? { desde: t.desde, precioUnitario: t.precioUnitario, faltan: t.desde - unidades } : null;
}

/** Unidades de un producto de la canasta: la suma de ese ítem en los carritos. */
export function unidadesDe(
  l: { participantes: readonly { items?: readonly { productoId: string; cantidad: number }[] }[] }, productoId: string,
): number {
  return l.participantes.reduce((s, p) => s + (p.items ?? []).filter(i => i.productoId === productoId).reduce((t, i) => t + i.cantidad, 0), 0);
}

/** Descuento de cada tramo automático sobre el precio de un producto creado por un proveedor. */
const TRAMOS_AUTOMATICOS: readonly [desde: number, factor: number][] = [[1, 1], [10, 0.95], [25, 0.9], [50, 0.85]];

/** Tramos de un producto nuevo desde su precio: 5 % menos desde 10 unidades, 10 % desde 25 y 15 % desde 50 ($10). */
export const tramosAutomaticos = (precio: number): Tramo[] =>
  TRAMOS_AUTOMATICOS.map(([desde, factor]) => ({ desde, precioUnitario: Math.round((precio * factor) / 10) * 10 }));

type ConOfertas = ConPrecio & {
  ofertas?: readonly { proveedorId: string; precioUnitario: number }[];
  /** Quien creó el producto: sus tramos son su precio por volumen. */
  proveedorId?: string;
};

/**
 * Lo que paga el grupo hoy por un producto.
 * - Con proveedor fijo de la compra conjunta (`proveedorFijo`, la demo con ficticios): el tramo alcanzado o, si es
 *   menor, la oferta de ese proveedor. Nunca sobre el precio del tramo.
 * - Sin él: la mejor oferta de cualquier proveedor o, si es menor, el tramo de quien creó el producto (sus tramos son
 *   su oferta por volumen). Sin ofertas ni creador, el tramo queda como referencia.
 */
export function precioDelProducto(p: ConOfertas, unidades: number, proveedorFijo?: string): number {
  const tramo = precioPorVolumen(p, unidades);
  if (unidades <= 0) return tramo;
  if (proveedorFijo) {
    const propia = p.ofertas?.find(o => o.proveedorId === proveedorFijo);
    return propia ? Math.min(tramo, propia.precioUnitario) : tramo;
  }
  const ofertas = (p.ofertas ?? []).map(o => o.precioUnitario);
  if (ofertas.length === 0) return tramo;
  return Math.min(...ofertas, p.proveedorId ? tramo : Infinity);
}

type Linea = { cantidad: number; precioUnitario: number };

/** Monto neto de unas líneas: cantidad por precio unitario. */
export const neto = (items: readonly Linea[]): number => items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0);

/** Monto neto de una orden de compra. */
export const totalOrden = (orden: { items: readonly Linea[] }): number => neto(orden.items);

/** Totales de la canasta desde cada producto con sus derivados: unidades, lo que paga el grupo y lo que ahorra (neto). */
export function totalesDeCanasta(productos: readonly { totalUnidades: number; precioActual: number; precioSolo: number }[]) {
  return {
    totalUnidades: productos.reduce((s, p) => s + p.totalUnidades, 0),
    montoTotal: productos.reduce((s, p) => s + p.totalUnidades * p.precioActual, 0),
    ahorroTotal: productos.reduce((s, p) => s + p.totalUnidades * (p.precioSolo - p.precioActual), 0),
  };
}

// Puntaje de una oferta en la licitación: el precio, castigado por mala nota y por plazo largo.
//   precioAjustado = precioUnitario * (1 + 0.1 * (5 - nota)) * (1 + 0.01 * plazoDias)
// Gana el menor. Así un proveedor 0.8 puntos peor necesita ser ~8% más barato para ganar.
export function precioAjustado(oferta: { precioUnitario: number; plazoDias: number }, nota: number): number {
  return Math.round(oferta.precioUnitario * (1 + 0.1 * (5 - nota)) * (1 + 0.01 * oferta.plazoDias));
}
