/// <reference types="vite/client" />
// Arranque de MapLibre común a /mapa y /red-3d: estilo "positron" de OpenFreeMap teñido con los tokens de Bando
// (crema y neutros cálidos en claro, carbón en oscuro), créditos plegados abajo a la izquierda y, si el estilo no carga
// (sala sin internet), un fondo liso donde la red se dibuja igual.

import { useEffect, type RefObject } from 'react';
import { AttributionControl, Map as MapaLibre, setWorkerUrl, type MapOptions, type StyleSpecification } from 'maplibre-gl';
// MapLibre 6 busca su worker junto a su propio archivo; al compilar con Vite ese archivo cambia de nombre.
// Vite copia el worker a dist/assets y nos da su URL.
import urlDelWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTema } from '../marca/tema.ts';

setWorkerUrl(urlDelWorker);

const ESTILO = 'https://tiles.openfreemap.org/styles/positron';
/** Un mapa fuera de `.bando-ui` (interfaz anterior) sigue con el estilo oscuro. */
const ESTILO_ANTERIOR = 'https://tiles.openfreemap.org/styles/dark';
/** Sin internet no hay calles: queda un fondo liso (lo tiñe `teñirMapa`) y los negocios se dibujan igual. */
const SIN_CALLES: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'fondo', type: 'background', paint: {} }],
};

/**
 * Los colores de los mapas, leídos de los tokens de marca (tokens.css) del elemento donde vive el mapa: dentro de
 * `.bando-ui` cambian solos con el modo claro u oscuro. Es la única tabla de colores de /mapa y /red-3d.
 */
const TOKENS = {
  // Base del mapa
  tierra: '--color-secondary',
  parque: '--color-muted',
  agua: '--color-border',
  calle: '--color-background',
  edificio: '--bando-crema',
  rotulo: '--color-faint-fg',
  // La red
  miel: '--bando-miel',
  miel600: '--bando-miel-600',
  oliva: '--bando-oliva',
  olivaTexto: '--bando-oliva-texto',
  sii: '--color-sii',
  error: '--color-destructive',
  fondo: '--color-background',
} as const;
export type Paleta = Record<keyof typeof TOKENS, string>;

export function paleta(el: Element): Paleta {
  const estilo = getComputedStyle(el);
  return Object.fromEntries(Object.entries(TOKENS).map(([k, token]) => [k, estilo.getPropertyValue(token).trim()])) as Paleta;
}

/** Qué color de la paleta lleva cada capa del estilo positron (y la de edificios 3D), según su tipo y su nombre. */
function colorDeCapa(tipo: string, id: string, p: Paleta): Record<string, string> {
  const es = (...partes: string[]) => partes.some(x => id.includes(x));
  switch (tipo) {
    case 'background': return { 'background-color': p.tierra };
    case 'fill-extrusion': return { 'fill-extrusion-color': p.edificio };
    case 'fill':
      if (es('water')) return { 'fill-color': p.agua };
      if (es('building')) return { 'fill-color': p.edificio, 'fill-outline-color': p.agua };
      if (es('road', 'aeroway')) return { 'fill-color': p.calle };
      return { 'fill-color': es('park', 'wood') ? p.parque : p.tierra };
    case 'line':
      if (es('water')) return { 'line-color': p.agua };
      if (es('boundary')) return { 'line-color': p.rotulo };
      if (es('casing', 'subtle') || id === 'railway' || id.endsWith('transit') || id.endsWith('service')) return { 'line-color': p.agua };
      return { 'line-color': p.calle };
    case 'symbol': return { 'text-color': p.rotulo, 'text-halo-color': p.tierra };
    default: return {};
  }
}

type PropiedadDePintura = Parameters<MapaLibre['setPaintProperty']>[1];
/** Pone varias propiedades de pintura de una capa (colores de la paleta o expresiones con ellos). */
export function pintar(m: MapaLibre, capa: string, pintura: Record<string, unknown>) {
  for (const [propiedad, valor] of Object.entries(pintura)) m.setPaintProperty(capa, propiedad as PropiedadDePintura, valor as never);
}

const deMarca = (el: Element) => !!el.closest('.bando-ui');

/** Pinta la base del mapa con la paleta del modo actual. Corre al cargar el estilo y cada vez que cambia el modo. */
export function teñirMapa(m: MapaLibre) {
  if (!deMarca(m.getContainer())) return;
  const p = paleta(m.getContainer());
  // Solo la base (OpenMapTiles y el fondo): las capas de la red tienen sus propios colores.
  for (const capa of m.getStyle()?.layers ?? []) {
    if (capa.type !== 'background' && !('source' in capa && capa.source === 'openmaptiles')) continue;
    pintar(m, capa.id, colorDeCapa(capa.type, capa.id, p));
    // Los escudos de las rutas ("70", "77") solo ensucian el mapa de la red.
    if (capa.id.includes('shield')) m.setLayoutProperty(capa.id, 'visibility', 'none');
  }
}

/**
 * Crea el mapa en `contenedor`. `alCargarEstilo` corre cada vez que hay estilo nuevo (el de calles o el
 * fondo liso): ahí se agregan las capas propias, porque cambiar de estilo las borra.
 */
export function crearMapa(contenedor: HTMLElement, opciones: Omit<MapOptions, 'container' | 'style'>, alCargarEstilo: (m: MapaLibre) => void): MapaLibre {
  const m = new MapaLibre({ ...opciones, container: contenedor, style: deMarca(contenedor) ? ESTILO : ESTILO_ANTERIOR, attributionControl: false });
  m.addControl(new AttributionControl({ compact: true }), 'bottom-left');
  // Plegados en el botón (i): el crédito de OpenStreetMap queda siempre a la vista en la leyenda.
  m.once('load', () => contenedor.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
  let conEstilo = false;
  m.on('style.load', () => {
    conEstilo = true;
    alCargarEstilo(m);
    teñirMapa(m);
  });
  // Si el estilo no carga, se cambia una sola vez al fondo liso.
  m.on('error', () => {
    if (conEstilo) return;
    conEstilo = true;
    m.setStyle(SIN_CALLES);
  });
  return m;
}

/** Vuelve a teñir el mapa cuando cambia el modo claro u oscuro; `alCambiar` repinta lo que va encima (deck.gl). */
export function useMapaConTema(mapa: RefObject<MapaLibre | null>, alCambiar?: () => void) {
  const [tema] = useTema();
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    try {
      teñirMapa(m);
    } catch {
      // El estilo todavía no carga: lo tiñe `crearMapa` al cargar.
    }
    alCambiar?.();
  }, [tema]);
}

/** Edificios en 3D (capa `building` de OpenMapTiles), del color que les da `teñirMapa`: la toma inicial parte a nivel de calle entre ellos. */
export function ponerEdificios(m: MapaLibre) {
  if (!m.getSource('openmaptiles') || m.getLayer('edificios-3d')) return;
  m.addLayer({
    id: 'edificios-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
    paint: {
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, 0.9],
    },
  });
}

/** Elemento HTML para un marcador del mapa. */
export function crear(clase: string, html = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = clase;
  el.innerHTML = html;
  return el;
}
