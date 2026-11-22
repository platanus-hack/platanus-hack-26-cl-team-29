// La búsqueda de la portada (/app y /proveedor) sobre lo que ya está en pantalla: productos de la compra en grupo, mis pedidos,
// mis facturas y las secciones. Los proveedores se buscan aparte en el servidor (GET /api/proveedores?q=).
// Sin React, para probarla con node:test.

import { sinTildes } from '../../../shared/texto.ts';

export type TipoResultado = 'compra' | 'pedido' | 'factura' | 'seccion';

export interface Resultado {
  tipo: TipoResultado;
  titulo: string;
  detalle: string;
  /** Adónde lleva: un hash de /app (`#compra/rollos`) o una ruta. */
  href: string;
}

export interface FuentesBusqueda {
  /** Lo que está en una compra en grupo abierta (puede haber varias). */
  productos: readonly { id: string; nombre: string; licitacionId: string }[];
  ordenes: readonly { id: string; proveedorId: string; compradorId: string; items: readonly { producto: string }[] }[];
  documentos: readonly { tipo: number; folio: number | null; ordenId: string }[];
  negocios: readonly { id: string; nombre: string }[];
  secciones: readonly { id: string; titulo: string }[];
  /** Quién es la contraparte de mis pedidos: el proveedor si compro (por defecto), el comprador si vendo. */
  contraparte?: 'proveedorId' | 'compradorId';
  /** Dónde vive la compra en grupo: `#compra` en /app, `/app#compra` desde el panel del proveedor. */
  rutaCompra?: string;
}

const NOMBRE_DOCUMENTO: Record<number, string> = { 33: 'Factura', 52: 'Guía de despacho', 61: 'Nota de crédito' };
/** Lo mínimo para buscar: con menos, todo coincide. */
export const LARGO_MINIMO = 2;
const MAXIMO_POR_TIPO = 5;

/** Todas las palabras tienen que aparecer, sin importar tildes ni mayúsculas. */
function coincide(q: string, ...textos: string[]): boolean {
  const donde = sinTildes(textos.join(' '));
  return sinTildes(q).split(/\s+/).filter(Boolean).every(p => donde.includes(p));
}

export function buscarEnApp(q: string, f: FuentesBusqueda): Resultado[] {
  if (q.trim().length < LARGO_MINIMO) return [];
  const lado = f.contraparte ?? 'proveedorId';
  const otro = (o: FuentesBusqueda['ordenes'][number] | undefined) => f.negocios.find(n => n.id === o?.[lado])?.nombre ?? (lado === 'proveedorId' ? 'Proveedor' : 'Negocio');
  const limite = <T,>(xs: T[]) => xs.slice(0, MAXIMO_POR_TIPO);

  const compras = f.productos.filter(p => coincide(q, p.nombre))
    .map(p => ({ tipo: 'compra' as const, titulo: p.nombre, detalle: 'Compra en grupo abierta', href: `${f.rutaCompra ?? '#compra'}/${encodeURIComponent(p.licitacionId)}/${encodeURIComponent(p.id)}` }));
  // Pedidos solo donde hay una sección que los muestre (el panel del proveedor).
  const conPedidos = f.secciones.some(s => s.id === 'pedidos');
  const pedidos = f.ordenes.filter(o => conPedidos && coincide(q, otro(o), ...o.items.map(i => i.producto)))
    .map(o => ({ tipo: 'pedido' as const, titulo: o.items.map(i => i.producto).join(', ') || 'Pedido', detalle: otro(o), href: '#pedidos' }));
  const facturas = f.documentos.filter(d => d.folio !== null && NOMBRE_DOCUMENTO[d.tipo] && coincide(q, `${NOMBRE_DOCUMENTO[d.tipo]} ${d.folio}`))
    .map(d => ({ tipo: 'factura' as const, titulo: `${NOMBRE_DOCUMENTO[d.tipo]} folio ${d.folio}`, detalle: otro(f.ordenes.find(o => o.id === d.ordenId)), href: '#facturas' }));
  const secciones = f.secciones.filter(s => coincide(q, s.titulo))
    .map(s => ({ tipo: 'seccion' as const, titulo: s.titulo, detalle: 'Ir a la sección', href: `#${s.id}` }));

  return [...limite(compras), ...limite(pedidos), ...limite(facturas), ...limite(secciones)];
}
