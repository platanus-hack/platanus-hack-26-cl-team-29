// La búsqueda de la portada de /app sobre lo que ya está en pantalla: productos de la compra en grupo, mis pedidos,
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
  productos: readonly { id: string; nombre: string }[];
  ordenes: readonly { id: string; proveedorId: string; items: readonly { producto: string }[] }[];
  documentos: readonly { tipo: number; folio: number | null; ordenId: string }[];
  negocios: readonly { id: string; nombre: string }[];
  secciones: readonly { id: string; titulo: string }[];
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
  const proveedor = (id: string) => f.negocios.find(n => n.id === id)?.nombre ?? 'Proveedor';
  const limite = <T,>(xs: T[]) => xs.slice(0, MAXIMO_POR_TIPO);

  const compras = f.productos.filter(p => coincide(q, p.nombre))
    .map(p => ({ tipo: 'compra' as const, titulo: p.nombre, detalle: 'Compra en grupo abierta', href: `#compra/${encodeURIComponent(p.id)}` }));
  const pedidos = f.ordenes.filter(o => coincide(q, proveedor(o.proveedorId), ...o.items.map(i => i.producto)))
    .map(o => ({ tipo: 'pedido' as const, titulo: o.items.map(i => i.producto).join(', ') || 'Pedido', detalle: proveedor(o.proveedorId), href: '#pedidos' }));
  const facturas = f.documentos.filter(d => d.folio !== null && NOMBRE_DOCUMENTO[d.tipo] && coincide(q, `${NOMBRE_DOCUMENTO[d.tipo]} ${d.folio}`))
    .map(d => ({ tipo: 'factura' as const, titulo: `${NOMBRE_DOCUMENTO[d.tipo]} folio ${d.folio}`, detalle: proveedor(f.ordenes.find(o => o.id === d.ordenId)?.proveedorId ?? ''), href: '#facturas' }));
  const secciones = f.secciones.filter(s => coincide(q, s.titulo))
    .map(s => ({ tipo: 'seccion' as const, titulo: s.titulo, detalle: 'Ir a la sección', href: `#${s.id}` }));

  return [...limite(compras), ...limite(pedidos), ...limite(facturas), ...limite(secciones)];
}
