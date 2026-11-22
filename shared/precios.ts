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

/** Máximo de tramos que un proveedor puede fijar para un producto. */
export const MAX_TRAMOS = 8;

/** Quien fija los tramos de un producto: quien lo creó o, en la canasta de la compra, su proveedor fijo. */
export const duenoDeTramos = (p: { proveedorId?: string }, l: { proveedorId?: string }): string | undefined => p.proveedorId ?? l.proveedorId;

/**
 * Por qué unos tramos nuevos no sirven, o null si sirven: de 1 a MAX_TRAMOS, "desde" enteros distintos (el primero
 * desde 1) y precios enteros positivos que no suben con el volumen. Con `vigente`, el precio que ya tiene el grupo con sus
 * unidades no puede subir: quien ya se sumó nunca paga más por un cambio de tramos.
 */
export function errorDeTramos(tramos: readonly Tramo[], vigente?: { unidades: number; precio: number }): string | null {
  if (tramos.length === 0 || tramos.length > MAX_TRAMOS) return `Fija entre 1 y ${MAX_TRAMOS} tramos`;
  if (!tramos.every(t => Number.isInteger(t.desde) && t.desde >= 1)) return 'Cada tramo parte desde 1 o más unidades enteras';
  if (!tramos.every(t => Number.isInteger(t.precioUnitario) && t.precioUnitario > 0)) return 'Cada precio debe ser un entero positivo, en pesos';
  const orden = ordenarTramos(tramos);
  if (orden[0].desde !== 1) return 'El primer tramo parte desde 1 unidad: es el precio de comprar solo';
  for (let i = 1; i < orden.length; i++) {
    if (orden[i].desde === orden[i - 1].desde) return `Hay dos tramos desde ${orden[i].desde}`;
    if (orden[i].precioUnitario > orden[i - 1].precioUnitario) return 'Un tramo de más volumen no puede costar más que uno menor';
  }
  if (vigente && vigente.unidades > 0) {
    const nuevo = tramoAlcanzado(orden, vigente.unidades)?.precioUnitario;
    if (nuevo !== undefined && nuevo > vigente.precio) return 'El precio que ya alcanzó el grupo no puede subir';
  }
  return null;
}

/** Descuento de cada tramo automático sobre el precio de un producto creado por un proveedor. */
const TRAMOS_AUTOMATICOS: readonly [desde: number, factor: number][] = [[1, 1], [10, 0.95], [25, 0.9], [50, 0.85]];

/** Un precio redondeado a $10, como se publican los tramos automáticos. */
const aDiez = (precio: number): number => Math.round(precio / 10) * 10;
/** Un precio redondeado a la centena, como se muestran los precios sacados del historial. */
export const aCentena = (precio: number): number => Math.round(precio / 100) * 100;

/** Tramos de un producto nuevo desde su precio: 5 % menos desde 10 unidades, 10 % desde 25 y 15 % desde 50 ($10). */
export const tramosAutomaticos = (precio: number): Tramo[] =>
  TRAMOS_AUTOMATICOS.map(([desde, factor]) => ({ desde, precioUnitario: aDiez(precio * factor) }));

/** Baja mínima entre un tramo sugerido y el anterior: lo que es menos se toma como ruido del historial. */
const BAJA_MINIMA = 0.03;
const MAXIMO_TRAMOS = 5;

const mediana = (xs: readonly number[]): number => {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/**
 * Tramos sugeridos desde el historial de ventas de un producto: el precio que de verdad cobró el proveedor según
 * cuánto le compraron. Se toma la mediana del precio para cada cantidad vendida y, de menor a mayor cantidad, se
 * abre un tramo cada vez que esa mediana baja al menos un 3 % del tramo anterior. El primero parte en 1 unidad.
 * Con más de cinco quiebres se quedan las bajas más grandes. Sin ninguna baja queda un solo tramo. Precios a la centena.
 */
export function tramosSugeridos(ventas: readonly { cantidad: number; precioUnitario: number }[]): Tramo[] {
  const porCantidad = new Map<number, number[]>();
  for (const v of ventas) {
    if (!(v.cantidad > 0 && v.precioUnitario > 0)) continue;
    const q = Math.max(1, Math.round(v.cantidad));
    porCantidad.set(q, [...(porCantidad.get(q) ?? []), v.precioUnitario]);
  }
  const grupos = [...porCantidad].sort((a, b) => a[0] - b[0]).map(([desde, precios]) => ({ desde, precioUnitario: aCentena(mediana(precios)) }));
  if (grupos.length === 0) return [];
  const tramos: Tramo[] = [{ desde: 1, precioUnitario: grupos[0].precioUnitario }];
  for (const g of grupos.slice(1)) {
    if (g.precioUnitario <= tramos.at(-1)!.precioUnitario * (1 - BAJA_MINIMA)) tramos.push(g);
  }
  // Sobran quiebres: sale el de la baja más chica respecto del anterior, y la escalera sigue bajando.
  const baja = (i: number) => tramos[i - 1].precioUnitario - tramos[i].precioUnitario;
  while (tramos.length > MAXIMO_TRAMOS) {
    let menor = 1;
    for (let i = 2; i < tramos.length; i++) if (baja(i) < baja(menor)) menor = i;
    tramos.splice(menor, 1);
  }
  return tramos;
}

/** Una oferta con su precio base y, si los trae, sus tramos por cantidad (la lista de precios del proveedor). */
export type OfertaConTramos = { precioUnitario: number; tramos?: readonly Tramo[] };

/** Lo que cobra una oferta por unidad cuando el grupo junta `unidades`: su tramo alcanzado o, sin tramos, su precio. */
export const precioDeOferta = (o: OfertaConTramos, unidades: number): number =>
  o.tramos?.length ? precioPorVolumen({ tramos: o.tramos, precioSolo: o.precioUnitario }, unidades) : o.precioUnitario;

/** La oferta más barata para `unidades` (la que hoy ganaría), o undefined si no hay ofertas. */
export function mejorOferta<O extends OfertaConTramos>(ofertas: readonly O[] | undefined, unidades: number): O | undefined {
  return [...(ofertas ?? [])].sort((a, b) => precioDeOferta(a, unidades) - precioDeOferta(b, unidades))[0];
}

type ConOfertas = ConPrecio & {
  ofertas?: readonly ({ proveedorId: string } & OfertaConTramos)[];
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
    return propia ? Math.min(tramo, precioDeOferta(propia, unidades)) : tramo;
  }
  const ofertas = (p.ofertas ?? []).map(o => precioDeOferta(o, unidades));
  if (ofertas.length === 0) return tramo;
  return Math.min(...ofertas, p.proveedorId ? tramo : Infinity);
}

type Linea = { cantidad: number; precioUnitario: number };

/** Monto neto de unas líneas: cantidad por precio unitario. */
export const neto = (items: readonly Linea[]): number => items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0);

/** Tasa de IVA en Chile, en %. */
export const TASA_IVA = 19;
/** IVA de un neto, redondeado como en el DTE. */
export const ivaDe = (montoNeto: number): number => Math.round((montoNeto * TASA_IVA) / 100);

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
