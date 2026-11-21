// Geografía de la red: dónde va cada negocio en el mapa y qué se dibuja.
// Lógica pura (sin MapLibre) para poder probarla con node:test.

import type { CambioNota } from '../red/derivar.ts';
import type { EstadoRed, EventoRed, Negocio } from '../red/tipos.ts';

export type Punto = [lng: number, lat: number];

/** Centro del mapa: el MUT (Mercado Urbano Tobalaba). Coordenada aproximada. */
export const MUT: Punto = [-70.601, -33.4178];
export const RADIO_KM = 30;

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

/** Cuánto se separan los negocios de una misma comuna, en grados (cerca de 1 km). */
const DISPERSION = 0.012;

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

function centroDe(comuna: string): Punto {
  const c = sinTildes(comuna);
  // "Ñuñoa y alrededores" también es Ñuñoa. Una comuna desconocida cae junto al MUT.
  const clave = Object.keys(COMUNAS).find(k => c.startsWith(k));
  return clave ? COMUNAS[clave] : MUT;
}

/** Dos números estables entre -1 y 1 a partir del id: el mismo negocio cae siempre en el mismo punto. */
function ruido(id: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = (h >>> 0) % 2001;
  const b = (Math.imul(h, 2654435761) >>> 0) % 2001;
  return [a / 1000 - 1, b / 1000 - 1];
}

export function ubicar(negocio: Pick<Negocio, 'id' | 'comuna'>): Punto {
  const [lng, lat] = centroDe(negocio.comuna);
  const [a, b] = ruido(negocio.id);
  return [lng + a * DISPERSION, lat + b * DISPERSION];
}

const KM_POR_GRADO = 111.19;

/** Anillo cerrado de `km` de radio alrededor de `centro`. */
export function circulo(centro: Punto, km: number, pasos = 120): Punto[] {
  const dLat = km / KM_POR_GRADO;
  const dLng = dLat / Math.cos((centro[1] * Math.PI) / 180);
  return Array.from({ length: pasos + 1 }, (_, i) => {
    const t = (i / pasos) * 2 * Math.PI;
    return [centro[0] + dLng * Math.cos(t), centro[1] + dLat * Math.sin(t)] as Punto;
  });
}

type Puntos = GeoJSON.FeatureCollection<GeoJSON.Point>;
type Lineas = GeoJSON.FeatureCollection<GeoJSON.LineString>;

/** Lo que se dibuja: un punto por negocio y una línea por orden (la más reciente va destacada). */
export function capas(estado: EstadoRed, cambios: CambioNota[]): { negocios: Puntos; lineas: Lineas } {
  const donde = new Map(estado.negocios.map(n => [n.id, ubicar(n)]));
  const ultima = estado.ordenes.reduce<string | undefined>(
    (id, o) => (id === undefined || o.creadaEn > estado.ordenes.find(x => x.id === id)!.creadaEn ? o.id : id),
    undefined,
  );
  return {
    negocios: {
      type: 'FeatureCollection',
      features: estado.negocios.map(n => {
        const cambio = cambios.find(c => c.proveedorId === n.id);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: donde.get(n.id)! },
          properties: { id: n.id, rol: n.rol, cambio: cambio ? (cambio.nota < cambio.anterior ? 'baja' : 'sube') : '' },
        };
      }),
    },
    lineas: {
      type: 'FeatureCollection',
      features: estado.ordenes.flatMap(o => {
        const desde = donde.get(o.proveedorId);
        const hasta = donde.get(o.compradorId);
        if (!desde || !hasta) return [];
        const reclamada = o.estado === 'reclamada';
        return [{
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: [desde, hasta] },
          properties: { tipo: reclamada ? 'reclamo' : o.id === ultima ? 'actual' : 'normal' },
        }];
      }),
    },
  };
}

export type ClasePulso = 'pedido' | 'venta' | 'reclamo' | 'baja' | 'sube' | 'nuevo';

const objeto = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
const texto = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);

/** En qué negocio late el mapa cuando llega un evento. Lee `datos` con cuidado: si falta algo, no late. */
export function pulsoDeEvento(e: EventoRed, estado: EstadoRed): { negocioId: string; clase: ClasePulso } | undefined {
  const orden = objeto(e.datos.orden);
  const con = (negocioId: string | undefined, clase: ClasePulso) => (negocioId ? { negocioId, clase } : undefined);
  switch (e.tipo) {
    case 'orden.creada':
      return con(texto(orden.compradorId), 'pedido');
    case 'documento.emitido': {
      const doc = objeto(e.datos.documento);
      if (doc.tipo !== 33) return undefined;
      return con(estado.ordenes.find(o => o.id === doc.ordenId)?.compradorId, 'venta');
    }
    case 'reclamo.registrado':
      return con(texto(orden.compradorId), 'reclamo');
    case 'nota.cambiada': {
      const baja = typeof e.datos.nota === 'number' && typeof e.datos.anterior === 'number' && e.datos.nota < e.datos.anterior;
      return con(texto(e.datos.proveedorId), baja ? 'baja' : 'sube');
    }
    case 'licitacion.participante':
      return con(texto(objeto(e.datos.participante).negocioId), 'nuevo');
    default:
      return undefined;
  }
}
