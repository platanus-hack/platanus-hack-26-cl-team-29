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

/**
 * Lo que paga el grupo hoy por un producto: el tramo alcanzado o, si es menor, la oferta del proveedor de la
 * compra conjunta (`proveedorId`) por ese producto. Nunca sobre el precio del tramo.
 */
export function precioDelProducto(
  p: ConPrecio & { ofertas?: readonly { proveedorId: string; precioUnitario: number }[] }, unidades: number, proveedorId?: string,
): number {
  const tramo = precioPorVolumen(p, unidades);
  const propia = proveedorId ? p.ofertas?.find(o => o.proveedorId === proveedorId) : undefined;
  return propia && unidades > 0 ? Math.min(tramo, propia.precioUnitario) : tramo;
}

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
