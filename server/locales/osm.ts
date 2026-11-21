// Locales desde OpenStreetMap (Overpass API): qué se busca, en qué celdas y cómo se lee la respuesta.
// Lógica pura salvo `buscarEnOsm`, para probarla sin red. Datos © OpenStreetMap (ODbL): la atribución va en el mapa.

export type Punto = [lng: number, lat: number];

/** Centro de la exploración: el MUT (Mercado Urbano Tobalaba). Coordenada aproximada. */
export const MUT: Punto = [-70.601, -33.4178];

/** Lo que compra y vende la red: dónde se cocina, se vende comida o se surte a otros negocios. */
const TIPOS: Record<string, string> = {
  restaurant: 'restaurante', cafe: 'café', fast_food: 'comida rápida', bar: 'bar', pub: 'bar', ice_cream: 'heladería',
  convenience: 'almacén', supermarket: 'supermercado', bakery: 'panadería', butcher: 'carnicería', greengrocer: 'verdulería',
  deli: 'rotisería', alcohol: 'botillería', beverages: 'botillería', wholesale: 'mayorista',
};
const AMENITY = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream'];
const SHOP = ['convenience', 'supermarket', 'bakery', 'butcher', 'greengrocer', 'deli', 'alcohol', 'beverages', 'wholesale'];

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
  encontradoEn: string;
}

/** Un cuadrado del recorrido. `i` es su orden: primero la muestra repartida, después de adentro hacia afuera. */
export interface Celda {
  i: number;
  sur: number;
  oeste: number;
  norte: number;
  este: number;
  distanciaKm: number;
  fase: Fase;
  /** Máximo de locales que se traen de esta celda: siempre es una muestra, nunca el catastro completo. */
  limite: number;
}

/** `reparto`: pocos locales repartidos por toda la zona. `acumulando`: más muestra, de adentro hacia afuera. */
export type Fase = 'reparto' | 'acumulando';

const KM_POR_GRADO = 111.19;

export function distanciaKm(a: Punto, b: Punto): number {
  const dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot(dx, a[1] - b[1]) * KM_POR_GRADO;
}

/**
 * Cuadrícula de `ladoKm` que cubre `radioKm` alrededor de `centro`, ordenada de adentro hacia afuera.
 * `cajaKm` es lo que se busca en cada celda, centrado en ella: menor que `ladoKm` deja huecos a propósito (muestra liviana).
 */
export function celdas(centro: Punto, radioKm: number, ladoKm: number, fase: Fase, limite: number, cajaKm = ladoKm): Celda[] {
  const dLat = ladoKm / KM_POR_GRADO;
  const dLng = dLat / Math.cos(centro[1] * (Math.PI / 180));
  const mLat = cajaKm / KM_POR_GRADO / 2;
  const mLng = mLat / Math.cos(centro[1] * (Math.PI / 180));
  const n = Math.ceil(radioKm / ladoKm);
  const lista: Omit<Celda, 'i'>[] = [];
  for (let fila = -n; fila <= n; fila++) {
    for (let col = -n; col <= n; col++) {
      const lng = centro[0] + col * dLng;
      const lat = centro[1] + fila * dLat;
      const distancia = distanciaKm(centro, [lng, lat]);
      if (distancia - ladoKm * Math.SQRT1_2 > radioKm) continue; // ni una esquina toca el círculo
      lista.push({ sur: lat - mLat, norte: lat + mLat, oeste: lng - mLng, este: lng + mLng, distanciaKm: distancia, fase, limite });
    }
  }
  return lista.sort((a, b) => a.distanciaKm - b.distanciaKm).map((c, i) => ({ ...c, i }));
}

/**
 * El recorrido es siempre una muestra. Primero se reparte por toda la zona (un punto de búsqueda cada pocos km),
 * así el mapa tiene puntos en todas partes pronto; después se acumula más muestra en celdas chicas, del centro hacia afuera.
 */
export function recorrido(
  centro: Punto,
  radioKm: number,
  o: { reparto: { ladoKm: number; cajaKm: number; porCelda: number }; acumulando: { ladoKm: number; porCelda: number } },
): Celda[] {
  const reparto = celdas(centro, radioKm, o.reparto.ladoKm, 'reparto', o.reparto.porCelda, o.reparto.cajaKm);
  const acumulando = celdas(centro, radioKm, o.acumulando.ladoKm, 'acumulando', o.acumulando.porCelda);
  return [...reparto, ...acumulando].map((c, i) => ({ ...c, i }));
}

/** Consulta Overpass para una celda: nodos, vías y relaciones con nombre (las vías traen su centro). */
export function consulta(c: Celda): string {
  const caja = `${c.sur.toFixed(5)},${c.oeste.toFixed(5)},${c.norte.toFixed(5)},${c.este.toFixed(5)}`;
  return `[out:json][timeout:180];(nwr["amenity"~"^(${AMENITY.join('|')})$"]["name"](${caja});nwr["shop"~"^(${SHOP.join('|')})$"]["name"](${caja}););out center tags;`;
}

interface Elemento {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Lee la respuesta de Overpass. Descarta lo que no tiene nombre, posición o un tipo conocido. */
export function leerElementos(respuesta: unknown, ahora: string): Local[] {
  const elementos = (respuesta as { elements?: Elemento[] } | null)?.elements ?? [];
  return elementos.flatMap(e => {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const tipo = TIPOS[t.shop ?? ''] ?? TIPOS[t.amenity ?? ''];
    const nombre = t.name?.trim();
    if (lat === undefined || lng === undefined || !tipo || !nombre) return [];
    const calle = t['addr:street'];
    const local: Local = {
      id: `${e.type}/${e.id}`,
      nombre,
      tipo,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      distanciaKm: Number(distanciaKm(MUT, [lng, lat]).toFixed(2)),
      encontradoEn: ahora,
    };
    if (calle) local.direccion = t['addr:housenumber'] ? `${calle} ${t['addr:housenumber']}` : calle;
    const comuna = t['addr:city'] ?? t['addr:suburb'];
    if (comuna) local.comuna = comuna;
    const web = t.website ?? t['contact:website'];
    if (web) local.web = web;
    return [local];
  });
}

const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Número estable a partir del id: la misma celda da siempre la misma muestra. */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Elige `limite` locales repartidos por la celda. Overpass, con límite, devuelve los primeros de su índice espacial
 * (todos en una esquina); por eso se pide la celda entera y se elige aquí, en un orden que parece al azar pero es fijo.
 */
export function muestrear(locales: Local[], limite: number): Local[] {
  return [...locales].sort((a, b) => hash(a.id) - hash(b.id)).slice(0, limite);
}

/** Pide una celda a Overpass y devuelve su muestra. Lanza si responde mal (429 o 504 cuando está cargado): el explorador reintenta. */
export async function buscarEnOsm(c: Celda): Promise<Local[]> {
  const r = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'domino-red-de-compras (Platanus Hack 26)' },
    body: new URLSearchParams({ data: consulta(c) }),
    signal: AbortSignal.timeout(200_000),
  });
  if (!r.ok) throw new Error(`Overpass respondió ${r.status}`);
  return muestrear(leerElementos(await r.json(), new Date().toISOString()), c.limite);
}
