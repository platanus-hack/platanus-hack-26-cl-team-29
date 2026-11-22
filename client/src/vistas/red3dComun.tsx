// Piezas que comparten /red-3d y su modo video: colores de deck.gl, anclar HTML al mapa y la leyenda.

import { useRef, type RefObject } from 'react';
import type { Map as MapaLibre } from 'maplibre-gl';
import { paleta, useMapaConTema, type Paleta } from '../mapa/base.ts';

export type Color = [number, number, number, number];
const rgb = (hex: string): Color => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255) as Color;
export const conAlfa = (c: Color, a: number): Color => [c[0], c[1], c[2], Math.round(255 * Math.min(1, Math.max(0, a)))];

/** La paleta de mapa/base.ts (tokens de marca) en RGB para deck.gl. */
export type ColoresDeck = Record<keyof Paleta, Color>;
const coloresDeck = (el: Element): ColoresDeck => Object.fromEntries(Object.entries(paleta(el)).map(([k, hex]) => [k, rgb(hex)])) as ColoresDeck;

/**
 * Colores de deck.gl del modo actual, leídos del contenedor del mapa. Cuando cambia el modo claro u oscuro se vuelve a
 * teñir la base del mapa y se leen de nuevo. Devuelve una función para llamarla en cada cuadro (null sin mapa).
 */
export function useColoresDeck(mapa: RefObject<MapaLibre | null>): () => ColoresDeck | null {
  const leidos = useRef<ColoresDeck | null>(null);
  useMapaConTema(mapa, () => { leidos.current = null; });
  return () => (leidos.current ??= mapa.current && coloresDeck(mapa.current.getContainer()));
}

/** Mueve cada hijo de `contenedor` a su punto del mapa (data-lng/data-lat) y devuelve dónde quedó cada uno. */
export function anclarAlMapa(m: MapaLibre, contenedor: HTMLElement | null): { el: HTMLElement; x: number; y: number }[] {
  return (Array.from(contenedor?.children ?? []) as HTMLElement[]).map(el => {
    const p = m.project([Number(el.dataset.lng), Number(el.dataset.lat)]);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    return { el, x: p.x, y: p.y };
  });
}

/** `mercadoPublico`: suma los proveedores de Mercado Público (no en el modo video, que es guionado). */
export function LeyendaRed3D({ mercadoPublico = false }: { mercadoPublico?: boolean }) {
  return (
    <ul className="r3d-leyenda" aria-label="Leyenda">
      <li><i className="punto negocio" /> negocio</li>
      <li><i className="punto proveedor" /> {mercadoPublico ? 'proveedor en Bando' : 'proveedor'}</li>
      {mercadoPublico && <li><i className="punto mp" /> proveedor de Mercado Público</li>}
      <li><i className="punto local" /> local real (OpenStreetMap)</li>
    </ul>
  );
}

