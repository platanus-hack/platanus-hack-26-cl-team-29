// Lógica pura del carrito de la canasta: productos de la compra conjunta, precio proyectado con mis cambios,
// totales, ahorro, la pista del próximo tramo y el envío diferido (debounce) del carrito completo.
// Sin React ni red, para poder probarla con node:test.

import type { Participante, SiguienteTramo } from '../red/tipos.ts';
import { mejorOferta, siguienteTramo, tramoAlcanzado } from '../../../shared/precios.ts';
import { normalizarTramos } from './logica.ts';
import type { LicitacionCanal, Tramo } from './tipos.ts';

import { CANTIDAD_MAXIMA } from '../../../shared/red.ts';

export { CANTIDAD_MAXIMA };

/** productoId → cantidad. Solo cantidades mayores que cero. */
export type Carrito = Record<string, number>;

export interface ItemCarrito {
  productoId: string;
  cantidad: number;
}

/** Un producto de la canasta, con los derivados del backend (o calculados si faltan). */
export interface ProductoCanasta {
  id: string;
  nombre: string;
  unidad: string;
  unidadPlural: string;
  precioSolo: number;
  tramos: Tramo[];
  /** Unidades de este producto en todo el grupo, incluidas las mías ya guardadas. */
  totalUnidades: number;
  /** Pedido mínimo (MOQ) del proveedor que hoy gana: si el grupo no llega, puede cancelar. */
  minimo?: number;
  precioActual: number;
  siguienteTramo: SiguienteTramo | null;
  /** Unidades que quedan si el stock de los proveedores es el límite. */
  quedan?: number;
  /** El stock del mejor no alcanza: cuántas cubre él (el resto, el siguiente; todos pagan `precioActual`). */
  cubreElMejor?: number;
}

const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Precio del tramo con `unidades`; antes del primero, el del primero. */
const precioDelTramo = (tramos: Tramo[], unidades: number) => (tramoAlcanzado(tramos, unidades) ?? tramos[0]!).precioUnitario;

/** Ítems de un participante: los de la canasta o, si es de antes, uno del primer producto. */
export function itemsDe(p: Participante, primerProducto: string): ItemCarrito[] {
  return p.items ?? (p.cantidad > 0 ? [{ productoId: primerProducto, cantidad: p.cantidad }] : []);
}

/** Productos de la canasta. Una licitación de un solo producto se lee como una canasta de uno. */
export function productosDe(lic: LicitacionCanal): ProductoCanasta[] {
  const crudos = lic.productos?.length
    ? lic.productos
    : [{
      id: 'producto', nombre: lic.producto, unidad: lic.unidad ?? 'unidad', unidadPlural: lic.unidadPlural ?? 'unidades',
      precioSolo: lic.precioSolo ?? 0, tramos: lic.tramos ?? [], totalUnidades: undefined, precioActual: lic.precioActual, siguienteTramo: lic.siguienteTramo,
    }];
  const primero = crudos[0].id;
  return crudos.map(p => {
    const total = numero(p.totalUnidades) ?? lic.participantes.reduce(
      (s, x) => s + itemsDe(x, primero).filter(i => i.productoId === p.id).reduce((a, i) => a + i.cantidad, 0), 0);
    // Una compra que inició un comprador no trae tramos propios: se ven los de la oferta que hoy gana.
    const propios = normalizarTramos(p.tramos);
    const gana = propios.length ? undefined : mejorOferta('ofertas' in p ? p.ofertas : undefined, total);
    // Una oferta sin tramos es un solo precio desde 1: si no, la compra se veía "esperando ofertas" con ofertas.
    const tramosDeGana = normalizarTramos(gana?.tramos);
    const tramos = propios.length ? propios : tramosDeGana.length || !gana ? tramosDeGana : [{ desde: 1, precioUnitario: gana.precioUnitario }];
    const precioTramo = tramos.length ? precioDelTramo(tramos, total) : undefined;
    const precioActual = numero(p.precioActual) ?? precioTramo ?? p.precioSolo;
    const precioSolo = numero(p.precioSolo) || tramos[0]?.precioUnitario || precioActual;
    return {
      id: p.id, nombre: p.nombre, unidad: p.unidad || 'unidad', unidadPlural: p.unidadPlural || 'unidades', precioSolo, tramos,
      totalUnidades: total, precioActual, ...(gana?.minimo ? { minimo: gana.minimo } : {}),
      ...('quedan' in p && numero(p.quedan) !== undefined ? { quedan: numero(p.quedan) } : {}),
      ...('cubreElMejor' in p && numero(p.cubreElMejor) !== undefined ? { cubreElMejor: numero(p.cubreElMejor) } : {}),
      // Solo cuenta un tramo que de verdad baja el precio (con 0 unidades, el primero cuesta lo mismo que comprar solo).
      siguienteTramo: p.siguienteTramo && p.siguienteTramo.precioUnitario < precioActual ? p.siguienteTramo : siguienteTramo(tramos, total, precioActual),
    };
  });
}

/** Lo que el grupo ya tiene guardado de este negocio (según la foto). */
export function carritoEnLaFoto(lic: LicitacionCanal, negocioId: string | undefined): Carrito | null {
  const p = negocioId ? lic.participantes.find(x => x.negocioId === negocioId) : undefined;
  if (!p) return null;
  return desdeItems(itemsDe(p, productosDe(lic)[0]?.id ?? 'producto'));
}

// ---------- El carrito ----------

export const limitar = (n: number) => Math.min(CANTIDAD_MAXIMA, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/** Fija la cantidad de un producto (no suma). 0 lo quita. */
export function fijar(c: Carrito, productoId: string, cantidad: number): Carrito {
  const { [productoId]: _, ...resto } = c;
  const n = limitar(cantidad);
  return n > 0 ? { ...resto, [productoId]: n } : resto;
}

export function desdeItems(items: readonly ItemCarrito[]): Carrito {
  return items.reduce<Carrito>((c, i) => fijar(c, i.productoId, i.cantidad), {});
}

/** Ítems para `PUT /yo/carrito`, en el orden de la canasta. */
export function aItems(c: Carrito, orden: readonly string[] = []): ItemCarrito[] {
  const ids = [...orden.filter(id => c[id]), ...Object.keys(c).filter(id => !orden.includes(id))];
  return ids.map(productoId => ({ productoId, cantidad: c[productoId] }));
}

// ---------- Precio con mis cambios ----------

export interface VistaProducto {
  precio: number;
  /** Unidades del grupo contando mis cambios sin guardar. */
  unidades: number;
  siguiente: SiguienteTramo | null;
}

/**
 * Precio que verá el grupo si se guarda mi cambio: `delta` = mi cantidad nueva menos la ya guardada.
 * Respeta una oferta del proveedor que dejó el precio bajo el tramo.
 */
export function proyectar(p: ProductoCanasta, delta: number): VistaProducto {
  if (delta === 0 || !p.tramos.length) return { precio: p.precioActual, unidades: p.totalUnidades, siguiente: p.siguienteTramo };
  const unidades = Math.max(0, p.totalUnidades + delta);
  const tramoAntes = precioDelTramo(p.tramos, p.totalUnidades);
  const oferta = p.precioActual < tramoAntes ? p.precioActual : Infinity;
  // Si el stock del que gana ya no alcanza (`cubreElMejor`), sumar unidades no baja el precio del grupo: lo cubre el
  // siguiente, así que el precio de hoy es el piso (el backend lo recalcula al guardar).
  const piso = p.cubreElMejor !== undefined ? p.precioActual : 0;
  const precio = Math.max(Math.min(precioDelTramo(p.tramos, unidades), oferta), piso);
  return { precio, unidades, siguiente: siguienteTramo(p.tramos, unidades, precio) };
}

/** "Una caja", "Un rollo": el género sale del plural de la unidad (cajas, unidades). */
export function una(p: Pick<ProductoCanasta, 'unidad' | 'unidadPlural'>): string {
  return `${/(as|des)$/i.test(p.unidadPlural) ? 'Una' : 'Un'} ${p.unidad}`;
}

// ---------- El grupo en vivo ----------

export interface ResumenGrupo {
  negocios: number;
  unidades: number;
  ahorro: number;
}

/** Cuántos negocios con algo en el carrito, cuántas unidades y cuánto ahorra el grupo en una compra. */
export function resumenGrupo(lic: LicitacionCanal): ResumenGrupo {
  const productos = productosDe(lic);
  return {
    negocios: lic.participantes.filter(p => p.cantidad > 0).length,
    unidades: productos.reduce((s, p) => s + p.totalUnidades, 0),
    ahorro: lic.ahorroTotal ?? productos.reduce((s, p) => s + p.totalUnidades * Math.max(0, p.precioSolo - p.precioActual), 0),
  };
}
