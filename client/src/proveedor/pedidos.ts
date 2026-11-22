// Lo que muestra el panel del proveedor (DESIGN.md, Paper "2 · Proveedor"), sin React: cómo se nombra cada estado
// de un pedido, en qué grupo cae y cuánto vendió hoy, para poder probarlo con node:test.

import { totalOrden } from '../../../shared/precios.ts';
import type { EstadoOrden } from '../../../shared/red.ts';

/** El tono de la etiqueta: miel pide acción, oliva es dinero que entró, rojo es un reclamo. */
export type TonoEstado = 'accion' | 'neutro' | 'camino' | 'listo' | 'reclamo';

export const ESTADO_PEDIDO: Record<EstadoOrden, { texto: string; tono: TonoEstado }> = {
  enviada: { texto: 'Por confirmar', tono: 'accion' },
  confirmada: { texto: 'Por facturar', tono: 'neutro' },
  facturada: { texto: 'En camino', tono: 'camino' },
  recibida: { texto: 'Recibido', tono: 'listo' },
  reclamada: { texto: 'Reclamo', tono: 'reclamo' },
  corregida: { texto: 'Corregido con nota', tono: 'neutro' },
};

/** Los cuatro grupos de la cabecera de Pedidos, en orden de urgencia. */
export const GRUPOS_PEDIDO = [
  { id: 'confirmar', titulo: 'Por confirmar', estados: ['enviada', 'confirmada'] },
  { id: 'camino', titulo: 'En camino', estados: ['facturada'] },
  { id: 'recibidos', titulo: 'Recibidos', estados: ['recibida', 'corregida'] },
  { id: 'reclamos', titulo: 'Reclamos', estados: ['reclamada'] },
] as const satisfies readonly { id: string; titulo: string; estados: readonly EstadoOrden[] }[];

export type GrupoPedido = (typeof GRUPOS_PEDIDO)[number]['id'];

interface Pedido {
  estado: EstadoOrden;
  creadaEn: string;
  items: readonly { cantidad: number; precioUnitario: number }[];
}

export function grupoDe(estado: EstadoOrden): GrupoPedido {
  return GRUPOS_PEDIDO.find(g => (g.estados as readonly EstadoOrden[]).includes(estado))!.id;
}

export function contarPorGrupo(pedidos: readonly Pedido[]): Record<GrupoPedido, number> {
  const cuenta = Object.fromEntries(GRUPOS_PEDIDO.map(g => [g.id, 0])) as Record<GrupoPedido, number>;
  for (const p of pedidos) cuenta[grupoDe(p.estado)]++;
  return cuenta;
}

const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Lo vendido hoy: los pedidos de hoy que el proveedor ya confirmó (los por confirmar todavía no son venta). */
export function ventasDeHoy(pedidos: readonly Pedido[], ahora: number): { total: number; pedidos: number } {
  const hoy = new Date(ahora);
  const vendidos = pedidos.filter(p => p.estado !== 'enviada' && mismoDia(new Date(p.creadaEn), hoy));
  return { total: vendidos.reduce((s, p) => s + totalOrden(p), 0), pedidos: vendidos.length };
}

/** El largo de cada barra de la "vista del comprador" en Precios: el más caro llena la barra y el más barato queda en un tercio. */
export function largoDeBarras(precios: readonly number[]): number[] {
  const mayor = Math.max(...precios), menor = Math.min(...precios);
  return precios.map(p => (mayor === menor ? 1 : 1 / 3 + (2 / 3) * ((p - menor) / (mayor - menor))));
}
