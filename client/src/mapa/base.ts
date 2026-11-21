/// <reference types="vite/client" />
// Arranque de MapLibre común a /mapa y /red-3d: estilo oscuro de OpenFreeMap, créditos plegados abajo
// a la izquierda y, si el estilo no carga (sala sin internet), un fondo liso donde la red se dibuja igual.

import { AttributionControl, Map as MapaLibre, setWorkerUrl, type MapOptions, type StyleSpecification } from 'maplibre-gl';
// MapLibre 6 busca su worker junto a su propio archivo; al compilar con Vite ese archivo cambia de nombre.
// Vite copia el worker a dist/assets y nos da su URL.
import urlDelWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(urlDelWorker);

const ESTILO = 'https://tiles.openfreemap.org/styles/dark';
/** Sin internet no hay calles: queda un fondo liso y los negocios se dibujan igual. */
const SIN_CALLES: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': '#0b0b0b' } }],
};

export const AMARILLO = '#f2ff00';
export const VERDE = '#08ff00';
export const MAGENTA = '#ff1ab3';
export const AZUL_LOCAL = '#9adfff';

/**
 * Crea el mapa en `contenedor`. `alCargarEstilo` corre cada vez que hay estilo nuevo (el de calles o el
 * fondo liso): ahí se agregan las capas propias, porque cambiar de estilo las borra.
 */
export function crearMapa(contenedor: HTMLElement, opciones: Omit<MapOptions, 'container' | 'style'>, alCargarEstilo: (m: MapaLibre) => void): MapaLibre {
  const m = new MapaLibre({ ...opciones, container: contenedor, style: ESTILO, attributionControl: false });
  m.addControl(new AttributionControl({ compact: true }), 'bottom-left');
  // Plegados en el botón (i): el crédito de OpenStreetMap queda siempre a la vista en la leyenda.
  m.once('load', () => contenedor.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
  let conEstilo = false;
  m.on('style.load', () => {
    conEstilo = true;
    alCargarEstilo(m);
  });
  // Si el estilo no carga, se cambia una sola vez al fondo liso.
  m.on('error', () => {
    if (conEstilo) return;
    conEstilo = true;
    m.setStyle(SIN_CALLES);
  });
  return m;
}

/** Elemento HTML para un marcador del mapa. */
export function crear(clase: string, html = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = clase;
  el.innerHTML = html;
  return el;
}
