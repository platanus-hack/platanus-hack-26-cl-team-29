// La portada después de entrar, igual en /app y en /proveedor: una búsqueda sobre toda la app y "¿Qué vas a hacer
// hoy?" con dos caminos, comprar (/app) o vender (/proveedor). `desde` dice en cuál de los dos está, para que cada
// camino lleve a su sección sin recargar si ya está ahí. Los proveedores se buscan en el servidor (red + Mercado
// Público); lo demás, en lo que ya está cargado.

import { useState } from 'react';
import { contar } from '../../../shared/texto.ts';
import { puedeVender } from '../../../shared/red.ts';
import { enlaceWhatsapp } from '../../../shared/telefono.ts';
import { estaAbierta } from '../canal/logica.ts';
import { productosDe } from '../canal/carrito.ts';
import type { ConfigRed, FotoRed, OrdenCanal } from '../canal/tipos.ts';
import type { Documento, Negocio } from '../red/tipos.ts';
import { ICONO_FLUJO } from '../marca/recursos.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import { useJson } from '../red/useJson.ts';
import { buscarEnApp, LARGO_MINIMO, type Resultado } from './busqueda.ts';

interface ProveedorEncontrado { clave: string; nombre: string; comuna: string; region: string }

const ETIQUETA: Record<Resultado['tipo'] | 'proveedor', string> = {
  compra: 'Compra en grupo', pedido: 'Pedido', factura: 'Documento', seccion: 'Sección', proveedor: 'Proveedor',
};
const MAXIMO_PROVEEDORES = 5;

/** Adónde lleva cada camino y cómo se busca, según desde qué lado se abre la portada. */
const LADOS = {
  comprar: { comprar: '#compra', vender: '/proveedor#ventas', contraparte: 'proveedorId' },
  vender: { comprar: '/app#compra', vender: '#ventas', contraparte: 'compradorId' },
} as const;

export function Inicio({ foto, negocio, ordenes, documentos, config, secciones, evento, desde }: {
  foto: FotoRed; negocio: Negocio; ordenes: readonly OrdenCanal[]; documentos: readonly Documento[]; config: ConfigRed | null;
  secciones: readonly { id: string; titulo: string }[]; evento: number; desde: keyof typeof LADOS;
}) {
  const lado = LADOS[desde];
  const ahora = useAhora();
  const [q, setQ] = useState('');
  // Puede haber varias abiertas: la portada busca en todas y muestra la que cierra primero.
  const abiertas = foto.licitaciones.filter(l => estaAbierta(l, ahora)).sort((a, b) => Date.parse(a.cierraEn) - Date.parse(b.cierraEn));
  const abierta = abiertas[0];
  const productos = abiertas.flatMap(l => productosDe(l).map(p => ({ ...p, licitacionId: l.id })));

  const buscando = q.trim().length >= LARGO_MINIMO;
  const locales = buscarEnApp(q, { productos, ordenes, documentos, negocios: foto.negocios, secciones, contraparte: lado.contraparte, rutaCompra: lado.comprar });
  const { datos } = useJson<{ resultados: ProveedorEncontrado[] }>(buscando ? `/api/proveedores?${new URLSearchParams({ q: q.trim() })}` : null, evento);
  const proveedores = buscando ? (datos?.resultados ?? []).slice(0, MAXIMO_PROVEEDORES) : [];
  const resultados = [
    ...locales,
    ...proveedores.map(p => ({ tipo: 'proveedor' as const, titulo: p.nombre, detalle: [p.comuna, p.region].filter(Boolean).join(', '), href: `/proveedores?p=${encodeURIComponent(p.clave)}` })),
  ];

  const vende = puedeVender(negocio);
  const quieroVender = enlaceWhatsapp(config?.whatsappNumero, 'Quiero vender en Bando');

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
      ) : (
        <section className="bm-hoy">
          <h1>¿Qué vas a hacer hoy?</h1>
          <div className="bm-caminos">
            <a className="bm-camino" href={lado.comprar}>
              <img className="ilustracion" src={ICONO_FLUJO.comprarEnGrupo} alt="" />
              <span className="bm-camino-titulo">Comprar</span>
              <span className="bm-camino-texto">
                {abierta
                  ? `${contar(productos.length, 'producto')} en compra en grupo · la próxima cierra en ${cuentaRegresiva(Date.parse(abierta.cierraEn) - ahora)}`
                  : 'Inicia una compra en grupo o pide a un proveedor.'}
              </span>
            </a>
            <a className="bm-camino" href={vende ? lado.vender : quieroVender || lado.vender} {...(!vende && quieroVender ? { target: '_blank', rel: 'noreferrer' } : {})}>
              <img className="ilustracion" src={ICONO_FLUJO.comoVende} alt="" />
              <span className="bm-camino-titulo">Vender</span>
              <span className="bm-camino-texto">
                {vende ? 'Recibe pedidos, pon tus precios por volumen y factura en el SII.' : 'Regístrate como proveedor por WhatsApp y empieza a recibir pedidos.'}
              </span>
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
