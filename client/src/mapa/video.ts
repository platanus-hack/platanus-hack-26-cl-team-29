// /red-3d#video: la red crece con proveedores conocidos de Santiago, guionada y determinista, solo para el video
// del pitch. No lee la BD: los negocios son locales reales del catálogo (client/public/video-locales.json) y las
// marcas son una simulación ilustrativa (la pantalla lo dice). Lógica pura, sin MapLibre ni deck.gl.

import { dinero, nota } from '../../../shared/formato.ts';
import { camaraEn, distanciaKm, type Camara } from './crece.ts';
import { MUT, type Punto } from './geo.ts';

/** `izquierda`: la etiqueta va a la izquierda del punto (los del poniente), para que no choquen con las del centro. */
export interface ProveedorVideo { id: string; nombre: string; logo?: string; punto: Punto; nota: number; izquierda?: boolean }

// ponytail: coordenadas aproximadas (plantas o centros de distribución plausibles), puestas a mano.
export const PROVEEDORES: ProveedorVideo[] = [
  { id: 'ccu', nombre: 'CCU', logo: '/video-logos/ccu.svg', punto: [-70.738, -33.37], nota: 4.6, izquierda: true },
  { id: 'coca', nombre: 'Coca-Cola', logo: '/video-logos/coca-cola.svg', punto: [-70.712, -33.412], nota: 4.5, izquierda: true },
  { id: 'vega', nombre: 'La Vega Central', punto: [-70.6496, -33.4296], nota: 4.7 },
  { id: 'agrosuper', nombre: 'Agrosuper', logo: '/video-logos/agrosuper.png', punto: [-70.69, -33.535], nota: 4.4 },
  { id: 'soprole', nombre: 'Soprole', logo: '/video-logos/soprole.png', punto: [-70.625, -33.36], nota: 4.6 },
  { id: 'colun', nombre: 'Colún', punto: [-70.78, -33.445], nota: 4.8, izquierda: true },
  { id: 'carozzi', nombre: 'Carozzi', logo: '/video-logos/carozzi.png', punto: [-70.705, -33.625], nota: 4.5 },
  { id: 'nestle', nombre: 'Nestlé', logo: '/video-logos/nestle.svg', punto: [-70.585, -33.485], nota: 4.6 },
  { id: 'watts', nombre: "Watt's", punto: [-70.745, -33.49], nota: 4.3, izquierda: true },
  { id: 'ideal', nombre: 'Ideal', punto: [-70.6, -33.545], nota: 4.4 },
];

export const MAX_NEGOCIOS = 2000;
/** El primer negocio aparece solo; desde PRIMERO_SOLO la red crece exponencial hasta FIN_CRECER. */
const APARECE_PRIMERO = 600;
const PRIMERO_SOLO = 3000;
export const FIN_CRECER = 21_000;
/** La cámara llega al plano final aquí y se queda quieta. */
export const FIN_CAMARA = 23_000;

/** [lng, lat, tipo]: locales del catálogo ordenados por distancia al MUT. */
export type LocalVideo = [lng: number, lat: number, tipo: string];
export interface NegocioVideo { punto: Punto; tipo: string; aparece: number; proveedor: number }

/** Cuándo aparece el negocio número i: el primero solo, después 2.000^k (exponencial). */
export function aparicionVideo(i: number, total = MAX_NEGOCIOS): number {
  if (i === 0) return APARECE_PRIMERO;
  return PRIMERO_SOLO + ((FIN_CRECER - PRIMERO_SOLO) * Math.log(i + 1)) / Math.log(total);
}

/** Cuántos negocios hay en `t` (inversa de aparicionVideo). */
export function negociosEn(t: number, total = MAX_NEGOCIOS): number {
  if (t < APARECE_PRIMERO) return 0;
  if (t < PRIMERO_SOLO) return 1;
  return Math.min(total, Math.floor(1e-6 + Math.exp(Math.min(1, (t - PRIMERO_SOLO) / (FIN_CRECER - PRIMERO_SOLO)) * Math.log(total))));
}

/** Un número estable entre 0 y 1 a partir de i y una semilla (mezcla tipo murmur, sin correlación entre semillas). */
function azar(i: number, semilla = 0): number {
  let h = Math.imul((i + 1) ^ Math.imul(semilla + 1, 0x9e3779b9), 2654435761);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Los negocios del video: del MUT hacia afuera, uno por celda de ~400 m para que cubran Santiago entero.
 * Cada uno compra a su proveedor más cercano (60 %) o a uno al azar estable, para que todos tengan zona.
 */
export function negociosVideo(locales: LocalVideo[], max = MAX_NEGOCIOS, celda = 0.004): NegocioVideo[] {
  const ocupadas = new Set<string>();
  const elegidos: LocalVideo[] = [];
  for (const l of locales) {
    if (elegidos.length >= max) break;
    const clave = `${Math.floor(l[0] / celda)},${Math.floor(l[1] / celda)}`;
    if (ocupadas.has(clave)) continue;
    ocupadas.add(clave);
    elegidos.push(l);
  }
  return elegidos.map(([lng, lat, tipo], i) => {
    const punto: Punto = [lng, lat];
    const cercano = PROVEEDORES.map((p, j) => [j, distanciaKm(punto, p.punto)] as const).sort((a, b) => a[1] - b[1])[0][0];
    const proveedor = i === 0 ? 0 : azar(i) < 0.6 ? cercano : Math.floor(azar(i, 1) * PROVEEDORES.length);
    return { punto, tipo, aparece: aparicionVideo(i, elegidos.length), proveedor };
  });
}

/** Solo algunos negocios dejan estela al llegar: así se ven ~20 a la vez aunque lleguen cientos por segundo. */
export const dejaEstela = (i: number) => i < 30 || i % Math.max(1, Math.floor(i / 25)) === 0;

/** El texto de la cifra grande según cuántos negocios hay. */
export function capituloVideo(n: number): string {
  if (n <= 1) return 'negocio en la red: ve solo sus compras';
  if (n < 100) return 'negocios en la red: cada uno ve sus compras';
  if (n < 1000) return 'negocios: ya ven los precios de la zona';
  return 'negocios: cada proveedor tiene nota y zona';
}

export type ClaseVideo = 'nuevo' | 'pedido' | 'venta' | 'reclamo';
export interface PasoVideo { t: number; clase: ClaseVideo; texto: string; proveedor: number; /** negocio donde pasa (índice). */ negocio: number }

const nombre = (id: string) => PROVEEDORES.findIndex(p => p.id === id);
const pedido = (t: number, id: string, monto: number): PasoVideo => ({ t, clase: 'pedido', proveedor: nombre(id), negocio: -1, texto: `Pedido a ${PROVEEDORES[nombre(id)].nombre} · ${dinero(monto)}` });
const factura = (t: number, id: string): PasoVideo => ({ t, clase: 'venta', proveedor: nombre(id), negocio: -1, texto: `Factura de ${PROVEEDORES[nombre(id)].nombre} en el SII` });
const opina = (t: number, id: string): PasoVideo => {
  const p = PROVEEDORES[nombre(id)];
  return { t, clase: 'reclamo', proveedor: nombre(id), negocio: -1, texto: `¿Llegó bien? ${p.nombre === 'La Vega Central' ? 'La Vega' : p.nombre} ${nota(p.nota)}` };
};
const suma = (t: number): PasoVideo => ({ t, clase: 'nuevo', proveedor: -1, negocio: -1, texto: 'Se sumó a la red' });

/**
 * Las tarjetas del video, separadas para que nunca haya más de tres. El negocio de cada una es uno que ya está
 * en el mapa en ese momento (la mitad de los que hay, para que quede dentro de la toma); el primero es el del inicio.
 */
export function guionVideo(): PasoVideo[] {
  const pasos = [
    suma(800), pedido(2000, 'ccu', 184_500), factura(3800, 'ccu'),
    pedido(5800, 'coca', 96_300), opina(7600, 'vega'), factura(9300, 'coca'),
    suma(11_000), pedido(12_600, 'soprole', 212_800), opina(14_300, 'colun'),
    pedido(16_000, 'carozzi', 1_245_000), factura(17_700, 'agrosuper'), suma(19_300),
  ];
  return pasos.map(p => ({ ...p, negocio: p.t < PRIMERO_SOLO + 1500 ? 0 : Math.floor(negociosEn(p.t) * 0.45) }));
}

/** Tomas: a nivel de calle junto al primer negocio (al lado del MUT) y se eleva hasta ver Santiago entero. */
export function camaraVideo(t: number, foco: Punto = MUT): Camara {
  return camaraEn([
    { t: 0, center: foco, zoom: 17, pitch: 78, bearing: -28 },
    { t: 3000, center: foco, zoom: 16.2, pitch: 75, bearing: -18 },
    { t: 8000, center: MUT, zoom: 14, pitch: 66, bearing: -6 },
    { t: 14_000, center: [-70.63, -33.43], zoom: 12.2, pitch: 56, bearing: 6 },
    { t: 19_000, center: [-70.66, -33.465], zoom: 11.1, pitch: 48, bearing: 14 },
    { t: FIN_CAMARA, center: [-70.668, -33.47], zoom: 10.7, pitch: 44, bearing: 18 },
  ], t, 0);
}
