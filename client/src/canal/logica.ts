// Lógica pura del canal web: precio por tramos, ciclo de un pedido, montos y el paso de confirmación.
// Sin React ni red, para poder probarla con node:test.

import type { Documento } from '../red/tipos.ts';
import { siguienteTramo, totalOrden, tramoAlcanzado } from '../../../shared/precios.ts';
import type { ConfigRed, LicitacionCanal, OrdenCanal, Tramo } from './tipos.ts';

const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** El mensaje de un error para mostrarlo tal cual, o `siFalla` si no trae uno. */
export const mensajeDeError = (e: unknown, siFalla = 'No pudimos completarlo. Inténtalo de nuevo.'): string =>
  (e instanceof Error ? e.message : siFalla);

/** Acepta los tramos aunque vengan con otros nombres de campo (`minimo`, `precio`). */
export function normalizarTramos(raw: unknown): Tramo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(t => {
      const o = (t ?? {}) as Record<string, unknown>;
      const desde = numero(o.desde) ?? numero(o.minimo) ?? numero(o.unidades) ?? numero(o.cantidad);
      const precioUnitario = numero(o.precioUnitario) ?? numero(o.precio);
      return desde !== undefined && precioUnitario !== undefined ? { desde, precioUnitario } : undefined;
    })
    .filter((t): t is Tramo => !!t)
    .sort((a, b) => a.desde - b.desde);
}

/** Unidades del producto de la compra conjunta: `productos[0]` si viene la canasta; si no, la suma de los participantes. */
export const unidadesDe = (lic: LicitacionCanal) =>
  numero(lic.productos?.[0]?.totalUnidades) ?? lic.participantes.reduce((s, p) => s + p.cantidad, 0);

export interface PrecioGrupo {
  unidades: number;
  precio?: number;
  precioSolo?: number;
  /** Próximo tramo: cuántas unidades faltan y a qué precio baja. */
  siguiente?: { faltan: number; precio: number };
}

/** Precio actual de la compra conjunta según las unidades del grupo. Sin tramos, usa la mejor oferta. */
export function precioDelGrupo(lic: LicitacionCanal): PrecioGrupo {
  const unidades = unidadesDe(lic);
  const p0 = lic.productos?.[0];
  const tramos = normalizarTramos(p0?.tramos ?? lic.tramos);
  if (tramos.length) {
    const actual = tramoAlcanzado(tramos, unidades) ?? tramos[0]!;
    const prox = siguienteTramo(tramos, unidades, actual.precioUnitario);
    return {
      unidades,
      precio: numero(p0?.precioActual) ?? numero(lic.precioActual) ?? actual.precioUnitario,
      precioSolo: p0?.precioSolo ?? lic.precioSolo ?? tramos[0].precioUnitario,
      ...(prox ? { siguiente: { faltan: prox.faltan, precio: prox.precioUnitario } } : {}),
    };
  }
  const ofertas = lic.ofertas.map(o => o.precioUnitario);
  const precio = lic.ganadora?.precioUnitario ?? (ofertas.length ? Math.min(...ofertas) : undefined);
  return { unidades, precio, precioSolo: lic.precioSolo };
}

/** Órdenes nacidas del cierre de la compra conjunta: por `ordenIds` de la licitación o `licitacionId` de la orden. */
export function ordenesDeLaCompra(lic: LicitacionCanal, ordenes: readonly OrdenCanal[]): OrdenCanal[] {
  const ids = new Set(lic.ordenIds ?? []);
  return ordenes.filter(o => o.licitacionId === lic.id || ids.has(o.id));
}

const SIN_FACTURAR = new Set<OrdenCanal['estado']>(['enviada', 'confirmada']);

/** Cerrada y con todas sus órdenes ya facturadas en el SII. */
export function estaFacturada(lic: LicitacionCanal, ordenes: readonly OrdenCanal[]): boolean {
  if (lic.estado === 'facturada' || lic.facturadaEn) return true;
  const deLaCompra = ordenesDeLaCompra(lic, ordenes);
  return lic.estado === 'cerrada' && deLaCompra.length > 0 && deLaCompra.every(o => !SIN_FACTURAR.has(o.estado));
}

export function estaAbierta(lic: LicitacionCanal, ahora: number): boolean {
  return lic.estado === 'abierta' && Date.parse(lic.cierraEn) > ahora;
}

/** La compra conjunta que importa: la abierta o, si no hay, la más reciente. */
export function licitacionVigente(lics: readonly LicitacionCanal[]): LicitacionCanal | undefined {
  return lics.find(l => l.estado === 'abierta') ?? lics.at(-1);
}

// ---------- Unidades ----------

export interface Unidad {
  singular: string;
  plural: string;
}

/** Unidad del producto: la de la config si es el producto de la compra conjunta; si no, "unidad". */
export function unidadPara(producto: string, config: ConfigRed | null): Unidad {
  const deLaCanasta = config?.productos?.find(p => p.nombre === producto);
  if (deLaCanasta) return { singular: deLaCanasta.unidad, plural: deLaCanasta.unidadPlural };
  if (config && producto === config.producto) return { singular: config.unidad, plural: config.unidadPlural };
  return { singular: 'unidad', plural: 'unidades' };
}

// ---------- Pedidos ----------


/** Monto de la nota de crédito: lo que faltó por su precio. Si ya se emitió, el monto del documento. */
export function montoNotaCredito(orden: OrdenCanal, documentos: readonly Documento[]): number {
  const nc = documentos.find(d => d.ordenId === orden.id && d.tipo === 61);
  if (nc?.monto !== undefined) return nc.monto;
  const item = orden.items.find(i => i.producto === orden.reclamo?.producto) ?? orden.items[0];
  return (orden.reclamo?.faltante ?? 0) * (item?.precioUnitario ?? 0);
}

// ---------- Paso de confirmación ----------

/**
 * Toda acción con efecto legal pasa por aquí: primero se pregunta en la página, y solo con el "sí"
 * se envía al backend con `confirmado: true`. Nunca se usa confirm() del navegador.
 */
export type Confirmacion<A> =
  | { fase: 'nada' }
  | { fase: 'preguntando'; accion: A }
  | { fase: 'enviando'; accion: A }
  | { fase: 'error'; accion: A; mensaje: string };

export type EventoConfirmacion<A> =
  | { tipo: 'pedir'; accion: A }
  | { tipo: 'cancelar' }
  | { tipo: 'confirmar' }
  | { tipo: 'listo' }
  | { tipo: 'fallo'; mensaje: string };

export const SIN_CONFIRMACION = { fase: 'nada' } as const;

export function confirmacion<A>(estado: Confirmacion<A>, e: EventoConfirmacion<A>): Confirmacion<A> {
  const enviando = estado.fase === 'enviando';
  switch (e.tipo) {
    case 'pedir':
      return enviando ? estado : { fase: 'preguntando', accion: e.accion };
    case 'cancelar':
      return enviando ? estado : { fase: 'nada' };
    case 'confirmar':
      return estado.fase === 'preguntando' || estado.fase === 'error' ? { fase: 'enviando', accion: estado.accion } : estado;
    case 'listo':
      return enviando ? { fase: 'nada' } : estado;
    case 'fallo':
      return enviando ? { fase: 'error', accion: estado.accion, mensaje: e.mensaje } : estado;
  }
}

// ---------- Proveedor ----------

/**
 * Lo que emite "Facturar todo en el SII": una factura por cada orden de la compra conjunta que falta facturar.
 * Antes de cerrar (sin órdenes todavía), se estima con los participantes al precio del grupo.
 */
export function resumenFacturacion(lic: LicitacionCanal, ordenes: readonly OrdenCanal[]): { facturas: number; total: number } {
  const porFacturar = ordenesDeLaCompra(lic, ordenes).filter(o => SIN_FACTURAR.has(o.estado));
  if (porFacturar.length) return { facturas: porFacturar.length, total: porFacturar.reduce((s, o) => s + totalOrden(o), 0) };
  const { unidades, precio } = precioDelGrupo(lic);
  return { facturas: lic.participantes.length, total: unidades * (precio ?? 0) };
}
