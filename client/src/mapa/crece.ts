// "La red crece" en /red-3d: quién aparece, cuándo, con qué proveedores y desde dónde mira la cámara.
// Lógica pura (sin MapLibre ni deck.gl) para probarla con node:test. Todo depende solo de los datos y del
// tiempo transcurrido: la misma red da siempre la misma secuencia, cuadro a cuadro, para grabar el video.

import type { EstadoRed } from '../red/tipos.ts';
import { MUT, ubicar, type Punto } from './geo.ts';

export interface NodoHistoria {
  id: string;
  punto: Punto;
  /** Milisegundos desde el inicio de la secuencia en que aparece. */
  aparece: number;
  proveedores: string[];
  /** true si es un local real del catálogo que todavía no está en la red (la secuencia lo usa para ilustrar). */
  ilustrativo: boolean;
}

/** Los tres momentos del guion: 1 negocio ve sus compras, 10 ven precios de la zona, 80 dan nota y zona a cada proveedor. */
export const HITOS = [1, 10, 80] as const;
/** Cuándo empieza cada hito y cuándo aparece su último negocio, en ms. */
const TRAMOS: Array<[desde: number, hasta: number]> = [[600, 600], [2000, 7000], [8000, 14000]];
/** Al terminar, la cámara se aleja y quedan los locales de Chile. Después sigue en vivo. */
export const DURACION_HISTORIA = 18_000;
export const INICIO_LOCALES = 15_000;
/** Cada negocio se une a sus dos proveedores más cercanos si la red todavía no tiene compras suyas. */
const PROVEEDORES_POR_NEGOCIO = 2;

export function distanciaKm(a: Punto, b: Punto): number {
  return Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111.19;
}

/** Cuándo aparece el negocio número `i` (desde 0): repartidos parejo dentro del tramo de su hito. */
export function aparicion(i: number): number {
  let previo = 0;
  for (let h = 0; h < HITOS.length; h++) {
    if (i < HITOS[h]) {
      const [desde, hasta] = TRAMOS[h];
      const cuantos = HITOS[h] - previo;
      return cuantos <= 1 ? desde : desde + ((i - previo) / (cuantos - 1)) * (hasta - desde);
    }
    previo = HITOS[h];
  }
  return TRAMOS.at(-1)![1];
}

/** Pares comprador → proveedor que ya existen en la red: órdenes y participantes de cada compra conjunta. */
export function relaciones(estado: EstadoRed): Array<[compradorId: string, proveedorId: string]> {
  const ids = new Set(estado.negocios.map(n => n.id));
  const pares = new Map<string, [string, string]>();
  const sumar = (c: string | undefined, p: string | undefined) => {
    if (c && p && ids.has(c) && ids.has(p)) pares.set(`${c}>${p}`, [c, p]);
  };
  for (const o of estado.ordenes) sumar(o.compradorId, o.proveedorId);
  for (const l of estado.licitaciones) {
    const proveedorId = l.ganadora?.proveedorId ?? l.proveedorId;
    for (const p of l.participantes) if (p.cantidad > 0) sumar(p.negocioId, proveedorId);
  }
  return [...pares.values()];
}

function cercanos(punto: Punto, proveedores: Array<{ id: string; punto: Punto }>): string[] {
  return [...proveedores]
    .sort((a, b) => distanciaKm(punto, a.punto) - distanciaKm(punto, b.punto))
    .slice(0, PROVEEDORES_POR_NEGOCIO)
    .map(p => p.id);
}

/** Separación mínima entre negocios de la secuencia: crece con cada uno para que la red se abra hacia afuera. */
const separacionKm = (cuantos: number) => 0.3 + 0.025 * cuantos;

/**
 * Los negocios de la secuencia, del MUT hacia afuera: primero los compradores de la red (con sus proveedores
 * reales si ya compraron) y después, hasta completar `max`, locales reales del catálogo, separados entre sí.
 */
export function historia(estado: EstadoRed, locales: Array<{ id: string; lat: number; lng: number }>, max: number = HITOS.at(-1)!): NodoHistoria[] {
  const proveedores = estado.negocios.filter(n => n.rol === 'proveedor').map(p => ({ id: p.id, punto: ubicar(p) }));
  if (!proveedores.length) return [];
  const pares = relaciones(estado);
  const desdeMut = <T extends { punto: Punto }>(xs: T[]) =>
    xs.map(x => ({ x, d: distanciaKm(x.punto, MUT) })).sort((a, b) => a.d - b.d).map(({ x }) => x);

  const elegidos: Array<Omit<NodoHistoria, 'aparece'>> = desdeMut(
    estado.negocios.filter(n => n.rol === 'comprador').map(n => ({ id: n.id, punto: ubicar(n) })),
  ).slice(0, max).map(n => {
    const suyos = pares.filter(([c]) => c === n.id).map(([, p]) => p);
    return { ...n, proveedores: suyos.length ? suyos : cercanos(n.punto, proveedores), ilustrativo: false };
  });

  for (const l of desdeMut(locales.map(l => ({ id: `local-${l.id}`, punto: [l.lng, l.lat] as Punto })))) {
    if (elegidos.length >= max) break;
    const minimo = separacionKm(elegidos.length);
    if (elegidos.every(e => distanciaKm(e.punto, l.punto) >= minimo)) {
      elegidos.push({ ...l, proveedores: cercanos(l.punto, proveedores), ilustrativo: true });
    }
  }
  return elegidos.map((n, i) => ({ ...n, aparece: aparicion(i) }));
}

/** Lo que dice la pantalla en cada momento de la secuencia. null = terminó y manda la red en vivo. */
export function capitulo(t: number, vistos: number, totalLocales: number): { cifra: number; texto: string } | null {
  if (t >= DURACION_HISTORIA) return null;
  if (t >= INICIO_LOCALES && totalLocales > 0) return { cifra: totalLocales, texto: 'locales en Chile pueden sumarse' };
  if (t < TRAMOS[1][0]) return { cifra: vistos, texto: 'negocio en la red: ve solo sus compras' };
  if (t < TRAMOS[2][0]) return { cifra: vistos, texto: 'negocios: ya ven los precios de la zona' };
  return { cifra: vistos, texto: 'negocios: cada proveedor tiene nota y zona' };
}

export interface Camara {
  center: Punto;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Tomas del recorrido: de cerca sobre el primer negocio, hacia afuera hasta ver Santiago entero. */
function tomas(foco: Punto): Array<Camara & { t: number }> {
  return [
    { t: 0, center: foco, zoom: 14.4, pitch: 62, bearing: -35 },
    { t: 2000, center: foco, zoom: 14, pitch: 60, bearing: -28 },
    { t: 8000, center: MUT, zoom: 12.5, pitch: 56, bearing: -8 },
    { t: INICIO_LOCALES, center: MUT, zoom: 11.2, pitch: 52, bearing: 14 },
    { t: DURACION_HISTORIA, center: [-70.63, -33.45], zoom: 10.3, pitch: 48, bearing: 24 },
  ];
}
/** Después de la secuencia la cámara gira despacio, en grados por segundo. */
const GIRO_POR_SEGUNDO = 2.5;

const suave = (x: number) => x * x * (3 - 2 * x);
const mezclar = (a: number, b: number, k: number) => a + (b - a) * k;

/** Cámara del modo recorrido en el instante `t` (ms). Determinista: el mismo `t` da siempre el mismo cuadro. */
export function camara(t: number, foco: Punto = MUT): Camara {
  const ts = tomas(foco);
  const ultima = ts.at(-1)!;
  if (t >= ultima.t) return { center: ultima.center, zoom: ultima.zoom, pitch: ultima.pitch, bearing: ultima.bearing + ((t - ultima.t) / 1000) * GIRO_POR_SEGUNDO };
  const i = Math.max(0, ts.findIndex(x => x.t > t) - 1);
  const [a, b] = [ts[i], ts[i + 1]];
  const k = suave(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
  return {
    center: [mezclar(a.center[0], b.center[0], k), mezclar(a.center[1], b.center[1], k)],
    zoom: mezclar(a.zoom, b.zoom, k),
    pitch: mezclar(a.pitch, b.pitch, k),
    bearing: mezclar(a.bearing, b.bearing, k),
  };
}
