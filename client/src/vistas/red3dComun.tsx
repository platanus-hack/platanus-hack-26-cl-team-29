// Piezas que comparten /red-3d y su modo video: colores de deck.gl, anclar HTML al mapa y la leyenda.

import type { Map as MapaLibre } from 'maplibre-gl';
import { AMARILLO, AZUL_LOCAL, MAGENTA, VERDE } from '../mapa/base.ts';

export type Color = [number, number, number, number];
const rgb = (hex: string): Color => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255) as Color;
export const [C_VERDE, C_AMARILLO, C_MAGENTA, C_LOCAL, C_BLANCO] = [VERDE, AMARILLO, MAGENTA, AZUL_LOCAL, '#ffffff'].map(rgb);
export const conAlfa = (c: Color, a: number): Color => [c[0], c[1], c[2], Math.round(255 * Math.min(1, Math.max(0, a)))];

/** Mueve cada hijo de `contenedor` a su punto del mapa (data-lng/data-lat) y devuelve dónde quedó cada uno. */
export function anclarAlMapa(m: MapaLibre, contenedor: HTMLElement | null): { el: HTMLElement; x: number; y: number }[] {
  return (Array.from(contenedor?.children ?? []) as HTMLElement[]).map(el => {
    const p = m.project([Number(el.dataset.lng), Number(el.dataset.lat)]);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    return { el, x: p.x, y: p.y };
  });
}

export function LeyendaRed3D() {
  return (
    <ul className="r3d-leyenda" aria-label="Leyenda">
      <li><i className="punto verde" /> negocio</li>
      <li><i className="punto amarillo" /> proveedor</li>
      <li><i className="punto local" /> local real (OpenStreetMap)</li>
    </ul>
  );
}
