// Dónde va cada negocio o proveedor en los mapas, sin dirección: el centro de su comuna o, si solo se sabe la región,
// un punto aproximado de esa región. Siempre estable: la misma clave cae en el mismo punto.
import { sinTildes } from './texto.ts';

export type Punto = [lng: number, lat: number];

/** Centro de los mapas: el MUT (Mercado Urbano Tobalaba). Coordenada aproximada. */
export const MUT: Punto = [-70.601, -33.4178];

// ponytail: centros aproximados por comuna, puestos a mano. La red solo sabe la comuna de cada negocio;
// cuando el contrato traiga dirección o coordenadas, se ubica con eso y esta tabla sobra.
const COMUNAS: Record<string, Punto> = {
  santiago: [-70.66, -33.45], providencia: [-70.615, -33.43], 'las condes': [-70.56, -33.41], vitacura: [-70.575, -33.385],
  'lo barnechea': [-70.52, -33.35], nunoa: [-70.6, -33.456], 'la reina': [-70.54, -33.447], macul: [-70.6, -33.49],
  penalolen: [-70.54, -33.485], 'la florida': [-70.58, -33.53], 'puente alto': [-70.575, -33.61], 'san joaquin': [-70.63, -33.495],
  'san miguel': [-70.65, -33.497], 'la cisterna': [-70.66, -33.53], 'san ramon': [-70.64, -33.54], 'la granja': [-70.625, -33.535],
  'el bosque': [-70.675, -33.565], 'san bernardo': [-70.7, -33.59], 'la pintana': [-70.63, -33.585], 'lo espejo': [-70.69, -33.52],
  'pedro aguirre cerda': [-70.675, -33.49], cerrillos: [-70.71, -33.5], maipu: [-70.76, -33.51], 'estacion central': [-70.7, -33.46],
  'lo prado': [-70.725, -33.445], pudahuel: [-70.76, -33.44], 'cerro navia': [-70.74, -33.425], 'quinta normal': [-70.7, -33.43],
  renca: [-70.72, -33.405], quilicura: [-70.73, -33.36], conchali: [-70.675, -33.385], independencia: [-70.665, -33.415],
  recoleta: [-70.64, -33.4], huechuraba: [-70.64, -33.37],
};

// Capital de cada región (aproximada), buscada por una palabra del nombre que usa Mercado Público.
// Todas están en la costa o al oeste de lo poblado: la dispersión va solo hacia el este para no caer al mar.
const REGIONES: Array<[palabra: string, capital: Punto]> = [
  ['arica', [-70.3, -18.48]], ['tarapaca', [-70.14, -20.22]], ['antofagasta', [-70.4, -23.65]], ['atacama', [-70.33, -27.37]],
  ['coquimbo', [-71.25, -29.91]], ['valparaiso', [-71.6, -33.04]], ['higgins', [-70.74, -34.17]], ['maule', [-71.66, -35.43]],
  ['nuble', [-72.1, -36.61]], ['biobio', [-73.05, -36.83]], ['araucania', [-72.6, -38.74]], ['rios', [-73.24, -39.82]],
  ['lagos', [-72.94, -41.45]], ['aysen', [-72.07, -45.57]], ['magallanes', [-71.05, -53.15]],
];

const KM_POR_GRADO = 111.19;

/** Distancia aproximada en km entre dos puntos cercanos (escala de ciudad o región). */
export function distanciaKm(a: Punto, b: Punto): number {
  const dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot(dx, a[1] - b[1]) * KM_POR_GRADO;
}

/** Cuánto se separan los negocios de una misma comuna, en grados (cerca de 1 km). */
const DISPERSION_COMUNA = 0.012;
/** Proveedores de la Región Metropolitana sin comuna: repartidos entre las comunas, un poco más sueltos (~2 km). */
const DISPERSION_SANTIAGO = 0.02;
/** Proveedores de otras regiones sin comuna: hasta ~10 km de la capital regional. */
const DISPERSION_REGION = 0.1;

/** Centro de la comuna, o null si no está en la tabla. "Ñuñoa y alrededores" también es Ñuñoa. */
export function centroDeComuna(comuna: string): Punto | null {
  const c = sinTildes(comuna).trim();
  const clave = c && Object.keys(COMUNAS).find(k => c.startsWith(k));
  return clave ? COMUNAS[clave]! : null;
}

/** Dos números estables entre -1 y 1 a partir de la clave: el mismo negocio cae siempre en el mismo punto. */
function ruido(clave: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < clave.length; i++) h = Math.imul(h ^ clave.charCodeAt(i), 16777619);
  const a = (h >>> 0) % 2001;
  const b = (Math.imul(h, 2654435761) >>> 0) % 2001;
  return [a / 1000 - 1, b / 1000 - 1];
}

const cerca = ([lng, lat]: Punto, clave: string, grados: number): Punto => {
  const [a, b] = ruido(clave);
  return [lng + a * grados, lat + b * grados];
};

/** Un negocio de la red en su comuna; una comuna desconocida cae junto al MUT. */
export const ubicarEnComuna = (clave: string, comuna: string): Punto => cerca(centroDeComuna(comuna) ?? MUT, clave, DISPERSION_COMUNA);

export type TipoUbicacion = 'comuna' | 'region';

/**
 * Un proveedor sin dirección: el centro de su comuna si se conoce; si no, un punto aproximado de su región
 * (en Santiago, alguna de sus comunas). null si no se sabe ni la comuna ni la región: no se inventa.
 */
export function ubicarProveedor(p: { clave: string; comuna: string; region: string }): { punto: Punto; ubicacion: TipoUbicacion } | null {
  if (centroDeComuna(p.comuna)) return { punto: ubicarEnComuna(p.clave, p.comuna), ubicacion: 'comuna' };
  const region = sinTildes(p.region);
  if (!region) return null;
  if (region.includes('metropolitana')) {
    const comunas = Object.values(COMUNAS);
    const [a] = ruido(`${p.clave}#comuna`);
    const comuna = comunas[Math.floor(((a + 1) / 2) * (comunas.length - 1))]!;
    return { punto: cerca(comuna, p.clave, DISPERSION_SANTIAGO), ubicacion: 'region' };
  }
  const capital = REGIONES.find(([palabra]) => region.includes(palabra))?.[1];
  if (!capital) return null;
  const [a, b] = ruido(p.clave);
  return { punto: [capital[0] + ((a + 1) / 2) * DISPERSION_REGION, capital[1] + (b * DISPERSION_REGION) / 2], ubicacion: 'region' };
}

/** Un proveedor en los mapas, como lo entrega GET /api/proveedores/mapa: lo mínimo para dibujarlo y abrir su ficha. */
export interface ProveedorMapa {
  /** RUT o id de la red: abre /proveedores?p=<clave>. */
  clave: string;
  nombre: string;
  categoria: string | null;
  region: string;
  comuna: string;
  /** Organismos públicos distintos que le compraron (contados, nunca nombrados). */
  organismos: number;
  enBando: boolean;
  nota: number | null;
  punto: Punto;
  /** 'comuna': centro de su comuna. 'region': solo se sabe la región, el punto es aproximado. */
  ubicacion: TipoUbicacion;
}
