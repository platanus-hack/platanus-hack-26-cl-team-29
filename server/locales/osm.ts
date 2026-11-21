// Catálogo de locales de Chile desde OpenStreetMap: cómo se lee el extracto, en qué celdas se recorre y qué
// muestra se toma de cada una. Lógica pura, sin red. Datos © OpenStreetMap (ODbL): la atribución va en el mapa.

import { distanciaKm } from '../../shared/ubicacion.ts';

export type Punto = [lng: number, lat: number];

/** Centro del recorrido: el MUT (Mercado Urbano Tobalaba). Coordenada aproximada. */
export const MUT: Punto = [-70.601, -33.4178];

/** Lo que compra y vende la red: dónde se cocina, se vende comida o se surte a otros negocios. */
const TIPOS: Record<string, string> = {
  restaurant: 'restaurante', cafe: 'café', fast_food: 'comida rápida', bar: 'bar', pub: 'bar', ice_cream: 'heladería',
  convenience: 'almacén', supermarket: 'supermercado', bakery: 'panadería', butcher: 'carnicería', greengrocer: 'verdulería',
  deli: 'rotisería', alcohol: 'botillería', beverages: 'botillería', wholesale: 'mayorista',
};

/** Filtro de `osmium tags-filter` que deja solo esos tipos (lo usa el importador). */
export const FILTRO_OSMIUM = [
  'nwr/amenity=restaurant,cafe,fast_food,bar,pub,ice_cream',
  'nwr/shop=convenience,supermarket,bakery,butcher,greengrocer,deli,alcohol,beverages,wholesale',
];

export interface Local {
  /** Id de OpenStreetMap, por ejemplo "node/123". */
  id: string;
  nombre: string;
  tipo: string;
  lat: number;
  lng: number;
  direccion?: string;
  comuna?: string;
  web?: string;
  distanciaKm: number;
  /** Cuándo lo mostró el explorador; vacío en el catálogo. */
  encontradoEn: string;
}

/** `reparto`: pocos locales repartidos por todo Chile. `acumulando`: todos, de adentro hacia afuera. */
export type Fase = 'reparto' | 'acumulando';

/** Una celda del recorrido. `i` es su orden: primero el reparto, después de adentro hacia afuera. */
export interface Celda {
  i: number;
  sur: number;
  oeste: number;
  norte: number;
  este: number;
  distanciaKm: number;
  fase: Fase;
  /** Máximo de locales que se toman de esta celda. */
  limite: number;
}

const KM_POR_GRADO = 111.19;

export { distanciaKm };

/** Arma un local desde las etiquetas de OpenStreetMap. Sin nombre, posición o tipo conocido, no sirve. */
export function localDesdeTags(id: string, lng: number, lat: number, t: Record<string, string | undefined>): Local | null {
  const tipo = TIPOS[t.shop ?? ''] ?? TIPOS[t.amenity ?? ''];
  const nombre = t.name?.trim();
  if (!tipo || !nombre || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const local: Local = {
    id,
    nombre,
    tipo,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    distanciaKm: Number(distanciaKm(MUT, [lng, lat]).toFixed(1)),
    encontradoEn: '',
  };
  const calle = t['addr:street'];
  if (calle) local.direccion = t['addr:housenumber'] ? `${calle} ${t['addr:housenumber']}` : calle;
  const comuna = t['addr:city'] ?? t['addr:suburb'];
  if (comuna) local.comuna = comuna;
  const web = t.website ?? t['contact:website'];
  if (web) local.web = web;
  // No se guardan teléfonos: el repo es público y algunos son números personales.
  return local;
}

/** Centro aproximado de un polígono: el promedio de su anillo exterior. */
function centro(geometria: { type: string; coordinates: unknown }): Punto | null {
  if (geometria.type === 'Point') return geometria.coordinates as Punto;
  const anillo = geometria.type === 'Polygon' ? (geometria.coordinates as Punto[][])[0]
    : geometria.type === 'MultiPolygon' ? (geometria.coordinates as Punto[][][])[0]?.[0] : undefined;
  if (!anillo?.length) return null;
  const suma = anillo.reduce<Punto>((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
  return [suma[0] / anillo.length, suma[1] / anillo.length];
}

/** Lee la salida de `osmium export -f geojsonseq -a type,id`: un Feature por línea. */
export function leerGeojsonseq(texto: string): Local[] {
  const vistos = new Set<string>();
  return texto.split('\n').flatMap(linea => {
    const limpia = linea.replace(/^\x1e/, '').trim();
    if (!limpia) return [];
    const f = JSON.parse(limpia) as { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, string> };
    const p = f.properties ?? {};
    const punto = f.geometry && centro(f.geometry);
    const id = `${p['@type']}/${p['@id']}`;
    if (!punto || vistos.has(id)) return [];
    const local = localDesdeTags(id, punto[0], punto[1], p);
    if (!local) return [];
    vistos.add(id);
    return [local];
  });
}

/** Número estable a partir del id: la misma celda da siempre la misma muestra. */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Elige `limite` locales repartidos por la celda, en un orden que parece al azar pero es siempre el mismo. */
export function muestrear(locales: Local[], limite: number): Local[] {
  return [...locales].sort((a, b) => hash(a.id) - hash(b.id)).slice(0, limite);
}

/** Celdas de `ladoKm` que tienen al menos un local, de la más cercana al MUT a la más lejana. */
function celdasConLocales(catalogo: Local[], ladoKm: number, fase: Fase, limite: number): Omit<Celda, 'i'>[] {
  const dLat = ladoKm / KM_POR_GRADO;
  const dLng = dLat / Math.cos(MUT[1] * (Math.PI / 180));
  const claves = new Set(catalogo.map(l => `${Math.floor((l.lng - MUT[0]) / dLng + 0.5)},${Math.floor((l.lat - MUT[1]) / dLat + 0.5)}`));
  return [...claves].map(clave => {
    const [col, fila] = clave.split(',').map(Number);
    const lng = MUT[0] + col * dLng;
    const lat = MUT[1] + fila * dLat;
    return { sur: lat - dLat / 2, norte: lat + dLat / 2, oeste: lng - dLng / 2, este: lng + dLng / 2, distanciaKm: distanciaKm(MUT, [lng, lat]), fase, limite };
  }).sort((a, b) => a.distanciaKm - b.distanciaKm);
}

/**
 * El recorrido: primero una muestra repartida por todo Chile (celdas grandes, pocos locales cada una), así el mapa
 * tiene puntos en todas partes pronto; después todas las celdas chicas desde el MUT hacia afuera, con todos sus locales.
 */
export function recorrido(catalogo: Local[], o: { reparto: { ladoKm: number; porCelda: number }; acumulando: { ladoKm: number } }): Celda[] {
  const reparto = celdasConLocales(catalogo, o.reparto.ladoKm, 'reparto', o.reparto.porCelda);
  const acumulando = celdasConLocales(catalogo, o.acumulando.ladoKm, 'acumulando', Number.MAX_SAFE_INTEGER);
  return [...reparto, ...acumulando].map((c, i) => ({ ...c, i }));
}

/** Los locales de una celda (su muestra), marcados con la hora en que se encontraron. */
export function buscarEnCatalogo(catalogo: Local[]): (c: Celda) => Promise<Local[]> {
  return async c => {
    const dentro = catalogo.filter(l => l.lat >= c.sur && l.lat < c.norte && l.lng >= c.oeste && l.lng < c.este);
    const ahora = new Date().toISOString();
    return muestrear(dentro, c.limite).map(l => ({ ...l, encontradoEn: ahora }));
  };
}
