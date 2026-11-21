// "La red crece" en /red-3d: quién aparece, cuándo, con qué proveedores y desde dónde mira la cámara.
// Lógica pura (sin MapLibre ni deck.gl) para probarla con node:test. Todo depende solo de los datos y del
// tiempo transcurrido: la misma red da siempre la misma secuencia, cuadro a cuadro, para grabar el video.

import type { EstadoRed, EventoRed } from '../red/tipos.ts';
import { totalOrden } from '../../../shared/precios.ts';
import { MUT, ubicar, type ClasePulso, type Punto } from './geo.ts';

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
/** Cada local de la secuencia se une a su proveedor más cercano: un arco por negocio, para que el mapa respire. */
const PROVEEDORES_POR_NEGOCIO = 1;

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

/** Tomas del recorrido: a nivel de calle junto a los edificios del primer negocio, y se eleva hasta ver Santiago entero. */
function tomas(foco: Punto): Array<Camara & { t: number }> {
  const medio: Punto = [(foco[0] + MUT[0]) / 2, (foco[1] + MUT[1]) / 2];
  return [
    { t: 0, center: foco, zoom: 16.9, pitch: 78, bearing: -28 },
    { t: 2600, center: foco, zoom: 16.3, pitch: 75, bearing: -18 },
    { t: 6000, center: medio, zoom: 14.4, pitch: 66, bearing: -6 },
    { t: 10_000, center: MUT, zoom: 12.6, pitch: 58, bearing: 6 },
    { t: INICIO_LOCALES, center: MUT, zoom: 11.3, pitch: 52, bearing: 14 },
    { t: DURACION_HISTORIA, center: [-70.63, -33.45], zoom: 10.4, pitch: 48, bearing: 22 },
  ];
}
/** Después de la secuencia la cámara gira despacio, en grados por segundo. */
const GIRO_POR_SEGUNDO = 2.5;

const suave = (x: number) => x * x * (3 - 2 * x);
const mezclar = (a: number, b: number, k: number) => a + (b - a) * k;

/** Cámara del modo recorrido en el instante `t` (ms). Determinista: el mismo `t` da siempre el mismo cuadro. */
export function camara(t: number, foco: Punto = MUT): Camara {
  return camaraEn(tomas(foco), t, GIRO_POR_SEGUNDO);
}

/** Interpola entre tomas en el instante `t`; después de la última gira `giro` grados por segundo. */
export function camaraEn(ts: Array<Camara & { t: number }>, t: number, giro: number): Camara {
  const ultima = ts.at(-1)!;
  if (t >= ultima.t) return { center: ultima.center, zoom: ultima.zoom, pitch: ultima.pitch, bearing: ultima.bearing + ((t - ultima.t) / 1000) * giro };
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

/* ---------- Tarjetas de eventos: lo que pasa en cada nodo, pocas y efímeras ---------- */

/** Una tarjeta sobre el mapa: el evento (su texto e ícono salen de describirEventoCorto e IconoEvento) y dónde pasó. */
export interface Tarjeta { clave: string; evento: EventoRed; clase: ClasePulso; punto: Punto; inicio: number }

export const MAX_TARJETAS = 3;
export const VIDA_TARJETA = 3200;

/**
 * Suma una tarjeta a las visibles en el instante `nueva.inicio`: saca las vencidas y la que había en el mismo
 * punto, y nunca deja más de MAX_TARJETAS (sale la más vieja). "Se sumó a la red" es la menos importante:
 * solo entra si sobra lugar, nunca desplaza a otra.
 */
export function sumarTarjeta(visibles: Tarjeta[], nueva: Tarjeta): Tarjeta[] {
  const vivas = visibles.filter(t => nueva.inicio - t.inicio < VIDA_TARJETA && (t.punto[0] !== nueva.punto[0] || t.punto[1] !== nueva.punto[1]));
  if (nueva.clase === 'nuevo' && vivas.length >= MAX_TARJETAS - 1) return vivas;
  return [...vivas, nueva].slice(-MAX_TARJETAS);
}

/** Un momento del guion: el evento que se anima, en qué negocio de la secuencia y, si va o viene, con qué proveedor. */
export interface PasoGuion { t: number; nodo: number; clase: ClasePulso; evento: EventoRed; proveedorId?: string }

/**
 * Los eventos de la secuencia, deterministas y con la forma de los `red:evento` reales: el primer negocio se suma,
 * pide y su venta queda facturada en el SII; después un negocio dice que no llegó bien y la nota del proveedor
 * baja; otros se suman. Montos y notas salen de la red; si no hay, la tarjeta va sin monto.
 */
export function guion(cuento: NodoHistoria[], estado: EstadoRed): PasoGuion[] {
  const primero = cuento[0];
  if (!primero) return [];
  const en = '';
  const orden = estado.ordenes.find(o => o.compradorId === primero.id) ?? estado.ordenes.find(o => o.items.length);
  const items = orden?.items ?? [];
  const monto = estado.documentos.find(d => d.tipo === 33 && d.monto)?.monto ?? (orden ? totalOrden(orden) : undefined);
  const entra = (i: number, t: number): PasoGuion => ({
    t, nodo: i, clase: 'nuevo', evento: { tipo: 'licitacion.participante', datos: { accion: 'entra', participante: { negocioId: cuento[i].id } }, en },
  });
  const pasos: PasoGuion[] = [
    entra(0, primero.aparece + 150),
    { t: 2600, nodo: 0, clase: 'pedido', proveedorId: primero.proveedores[0], evento: { tipo: 'orden.creada', datos: { orden: { compradorId: primero.id, proveedorId: primero.proveedores[0], items } }, en } },
    { t: 4800, nodo: 0, clase: 'venta', evento: { tipo: 'documento.emitido', datos: { documento: { tipo: 33, monto } }, en } },
  ];
  const opina = cuento[6];
  const proveedorId = opina?.proveedores[0];
  const anterior = estado.notas.find(n => n.proveedorId === proveedorId)?.nota;
  if (opina && proveedorId) {
    const t = Math.max(opina.aparece + 400, 7000);
    pasos.push({ t, nodo: 6, clase: 'reclamo', proveedorId, evento: { tipo: 'reclamo.registrado', datos: { orden: { compradorId: opina.id, proveedorId } }, en } });
    if (anterior !== undefined) {
      const datos = { proveedorId, anterior, nota: Math.round((anterior - 0.4) * 10) / 10 };
      pasos.push({ t: t + 1300, nodo: 6, clase: 'baja', proveedorId, evento: { tipo: 'nota.cambiada', datos, en } });
    }
  }
  for (const [i, t] of [[18, 10_200], [40, 12_000], [65, 13_800]] as const) if (cuento[i]) pasos.push(entra(i, Math.max(t, cuento[i].aparece + 150)));
  return pasos;
}
