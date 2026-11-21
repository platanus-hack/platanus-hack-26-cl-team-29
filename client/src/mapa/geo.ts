// Geografía de la red: dónde va cada negocio en el mapa y qué se dibuja.
// Lógica pura (sin MapLibre) para poder probarla con node:test.

import type { CambioNota } from '../red/derivar.ts';
import type { EstadoRed, EventoRed, Negocio } from '../red/tipos.ts';
import type { EventoVisto } from '../red/useRed.ts';
import { ubicarEnComuna, type Punto } from '../../../shared/ubicacion.ts';

export type { Punto } from '../../../shared/ubicacion.ts';
export { MUT } from '../../../shared/ubicacion.ts';
export const RADIO_KM = 30;

export const ubicar = (negocio: Pick<Negocio, 'id' | 'comuna'>): Punto => ubicarEnComuna(negocio.id, negocio.comuna);

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

/**
 * Eventos que todavía no se animaron (los marca en `vistos`) y llegaron hace menos de `edadMaxima` ms,
 * con el negocio donde late cada uno. Los más viejos se marcan sin animar, para no repetir una ráfaga al volver.
 */
export function pulsosNuevos(eventos: EventoVisto[], vistos: Set<number>, estado: EstadoRed, edadMaxima: number, ahora = Date.now()) {
  const nuevos: Array<{ evento: EventoVisto; clase: ClasePulso; negocio: Negocio }> = [];
  for (const evento of eventos) {
    if (vistos.has(evento.clave)) continue;
    vistos.add(evento.clave);
    if (ahora - evento.recibido > edadMaxima) continue;
    const pulso = pulsoDeEvento(evento, estado);
    const negocio = pulso && estado.negocios.find(n => n.id === pulso.negocioId);
    if (pulso && negocio) nuevos.push({ evento, clase: pulso.clase, negocio });
  }
  return nuevos;
}
