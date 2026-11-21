// Portada de /app después de entrar: una búsqueda sobre toda la app y "¿Qué vas a hacer hoy?" con dos caminos,
// comprar o vender. Los proveedores se buscan en el servidor (red + Mercado Público); lo demás, en lo que ya está cargado.

import { useMemo, useState } from 'react';
import { contar } from '../../../shared/texto.ts';
import { puedeVender } from '../../../shared/red.ts';
import { enlaceWhatsapp } from '../../../shared/telefono.ts';
import { estaAbierta, licitacionVigente } from '../canal/logica.ts';
import { productosDe } from '../canal/carrito.ts';
import type { ConfigRed, FotoRed, YoComprador } from '../canal/tipos.ts';
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

export function Inicio({ foto, yo, config, secciones, evento }: {
  foto: FotoRed; yo: YoComprador; config: ConfigRed | null; secciones: readonly { id: string; titulo: string }[]; evento: number;
}) {
  const ahora = useAhora();
  const [q, setQ] = useState('');
  const lic = licitacionVigente(foto.licitaciones);
  const abierta = lic && estaAbierta(lic, ahora) ? lic : null;
  const productos = useMemo(() => (abierta ? productosDe(abierta) : []), [abierta]);

  const buscando = q.trim().length >= LARGO_MINIMO;
  const locales = buscarEnApp(q, { productos, ordenes: yo.ordenes, documentos: yo.documentos, negocios: foto.negocios, secciones });
  const { datos } = useJson<{ resultados: ProveedorEncontrado[] }>(buscando ? `/api/proveedores?${new URLSearchParams({ q: q.trim() })}` : null, evento);
  const proveedores = buscando ? (datos?.resultados ?? []).slice(0, MAXIMO_PROVEEDORES) : [];
  const resultados = [
    ...locales,
    ...proveedores.map(p => ({ tipo: 'proveedor' as const, titulo: p.nombre, detalle: [p.comuna, p.region].filter(Boolean).join(', '), href: `/proveedores?p=${encodeURIComponent(p.clave)}` })),
  ];

  const vende = puedeVender(yo.negocio);
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
            <a className="bm-camino" href="#compra">
              <img className="ilustracion" src={ICONO_FLUJO.comprarEnGrupo} alt="" />
              <span className="bm-camino-titulo">Comprar</span>
              <span className="bm-camino-texto">
                {abierta
                  ? `${contar(productos.length, 'producto')} en compra en grupo · cierra en ${cuentaRegresiva(Date.parse(abierta.cierraEn) - ahora)}`
                  : 'Pide a un proveedor o súmate a la próxima compra en grupo.'}
              </span>
            </a>
            <a className="bm-camino" href={vende ? '/proveedor' : quieroVender || '/proveedor'} {...(!vende && quieroVender ? { target: '_blank', rel: 'noreferrer' } : {})}>
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
