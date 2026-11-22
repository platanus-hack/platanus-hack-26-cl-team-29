// La portada después de entrar, en /app y en /proveedor: una búsqueda sobre toda la app y, mientras no se busca, lo
// de cada lado (`children`: InicioComprador o InicioProveedor, Paper "C2" y "P2"). `desde` dice en cuál de los dos
// está, para que los resultados lleven a su sección. Los proveedores se buscan en el servidor (red + Mercado
// Público); lo demás, en lo que ya está cargado.

import { useState, type ReactNode } from 'react';
import { estaAbierta } from '../canal/logica.ts';
import { productosDe } from '../canal/carrito.ts';
import type { ConfigRed, FotoRed, OrdenCanal } from '../canal/tipos.ts';
import type { Documento, Negocio } from '../red/tipos.ts';
import { useAhora } from '../red/useRed.ts';
import { useJson } from '../red/useJson.ts';
import { buscarEnApp, LARGO_MINIMO, type Resultado } from './busqueda.ts';

interface ProveedorEncontrado { clave: string; nombre: string; comuna: string; region: string }

const ETIQUETA: Record<Resultado['tipo'] | 'proveedor', string> = {
  compra: 'Compra en grupo', pedido: 'Pedido', factura: 'Documento', seccion: 'Sección', proveedor: 'Proveedor',
};
const MAXIMO_PROVEEDORES = 5;

/** Adónde llevan las compras encontradas y quién es la contraparte de un pedido, según el lado de la portada. */
const LADOS = {
  comprar: { comprar: '#compra', contraparte: 'proveedorId' },
  vender: { comprar: '/app#compra', contraparte: 'compradorId' },
} as const;

export function Inicio({ foto, ordenes, documentos, secciones, evento, desde, children }: {
  foto: FotoRed; ordenes: readonly OrdenCanal[]; documentos: readonly Documento[];
  secciones: readonly { id: string; titulo: string }[]; evento: number; desde: keyof typeof LADOS;
  /** Lo de su lado, mientras no se busca. */
  children: ReactNode;
}) {
  const lado = LADOS[desde];
  const ahora = useAhora();
  const [q, setQ] = useState('');
  // Puede haber varias abiertas: la portada busca en todas y muestra la que cierra primero.
  const abiertas = foto.licitaciones.filter(l => estaAbierta(l, ahora)).sort((a, b) => Date.parse(a.cierraEn) - Date.parse(b.cierraEn));
  const productos = abiertas.flatMap(l => productosDe(l).map(p => ({ ...p, licitacionId: l.id })));

  const buscando = q.trim().length >= LARGO_MINIMO;
  const locales = buscarEnApp(q, { productos, ordenes, documentos, negocios: foto.negocios, secciones, contraparte: lado.contraparte, rutaCompra: lado.comprar });
  const { datos } = useJson<{ resultados: ProveedorEncontrado[] }>(buscando ? `/api/proveedores?${new URLSearchParams({ q: q.trim() })}` : null, evento);
  const proveedores = buscando ? (datos?.resultados ?? []).slice(0, MAXIMO_PROVEEDORES) : [];
  const resultados = [
    ...locales,
    ...proveedores.map(p => ({ tipo: 'proveedor' as const, titulo: p.nombre, detalle: [p.comuna, p.region].filter(Boolean).join(', '), href: `/app#proveedores/${encodeURIComponent(p.clave)}` })),
  ];


  return (
    <div className="bm-inicio">
      <div className="bm-busqueda">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} enterKeyHint="search" aria-label="Buscar en Bando"
          placeholder="Producto, proveedor o factura" />
      </div>

      {buscando ? (
        <section className="bm-resultados" aria-live="polite">
          {resultados.length ? (
            <ul>
              {resultados.map(r => (
                <li key={`${r.tipo}-${r.href}-${r.titulo}`}>
                  <a href={r.href}>
                    <span className="bm-resultado-tipo">{ETIQUETA[r.tipo]}</span>
                    <strong>{r.titulo}</strong>
                    {r.detalle && <span className="bm-resultado-detalle">{r.detalle}</span>}
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="bm-vacio-texto">No encontramos «{q.trim()}». Prueba con el nombre de un producto o de un proveedor.</p>}
        </section>
      ) : children}
    </div>
  );
}
