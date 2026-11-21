// Ruta de reparto del proveedor (GET /api/red/proveedor/ruta): los negocios a los que ya vendió y aún no reciben,
// ordenados para salir de su bodega y volver, con la guía de despacho de cada parada.
//
// - Orden y línea por calles: OSRM (`/trip`, servidor público sin key, uso liviano, con caché y timeout).
//   Si no responde, el orden sale de `ordenarParadas` (shared/ruta.ts) en línea recta.
// - Dónde queda cada negocio: su dirección del SII geocodificada con Nominatim (sin key; una consulta por segundo,
//   User-Agent genérico, caché). Mientras no esté, o si no hay dirección, el centro de su comuna (aproximado).
// Las direcciones viajan solo a esos servicios y al proveedor con sesión: nunca en logs ni en la foto pública.

import { armarRuta, paradasDeOrdenes, type DondeQueda, type RutaReparto, type ViajePorCalles } from '../../shared/ruta.ts';
import { centroDeComuna, MUT, ubicarEnComuna, type Punto } from '../../shared/ubicacion.ts';
import type { Red } from '../red/dominio.ts';
import type { Negocio } from '../red/tipos.ts';

export type BuscarViaje = (puntos: readonly Punto[]) => Promise<ViajePorCalles | null>;
export type Geocodificar = (direccion: string, comuna: string) => Promise<Punto | null>;

const USER_AGENT = 'bando-reparto/1.0';
const ESPERA_TOTAL_MS = 3000;

/** Recuerda las últimas `max` respuestas por clave (también las nulas: no se reintenta en cada vista). */
function conCache<T>(max: number) {
  const datos = new Map<string, T>();
  return {
    tiene: (k: string) => datos.has(k),
    leer: (k: string) => datos.get(k),
    guardar(k: string, v: T) {
      if (datos.size >= max) datos.delete(datos.keys().next().value!);
      datos.set(k, v);
    },
  };
}

/**
 * Viaje por calles con OSRM: circuito que sale del primer punto (la bodega) y vuelve. `orden` son índices de las
 * paradas (puntos sin la bodega). null si OSRM no responde a tiempo o no encuentra ruta.
 */
export function crearViajeOsrm({ base = 'https://router.project-osrm.org', timeoutMs = 4000, buscar = fetch } = {}): BuscarViaje {
  const cache = conCache<ViajePorCalles | null>(200);
  return async puntos => {
    if (puntos.length < 2) return null;
    const coordenadas = puntos.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
    if (cache.tiene(coordenadas)) return cache.leer(coordenadas) ?? null;
    let viaje: ViajePorCalles | null = null;
    try {
      const r = await buscar(`${base}/trip/v1/driving/${coordenadas}?roundtrip=true&source=first&geometries=geojson&overview=full`, {
        headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs),
      });
      const j = (await r.json()) as {
        code?: string; trips?: { distance: number; duration: number; geometry: { coordinates: Punto[] } }[];
        waypoints?: { waypoint_index: number }[];
      };
      const trip = j.trips?.[0];
      if (r.ok && j.code === 'Ok' && trip && j.waypoints?.length === puntos.length) {
        const orden = j.waypoints.map((w, i) => ({ i, pos: w.waypoint_index })).slice(1).sort((a, b) => a.pos - b.pos).map(x => x.i - 1);
        viaje = { orden, distanciaKm: trip.distance / 1000, duracionMin: trip.duration / 60, geometria: trip.geometry.coordinates };
      }
    } catch (e) {
      console.warn(`[reparto] OSRM no respondió: ${(e as Error).message}`);
      return null; // No se guarda: el próximo intento vuelve a probar.
    }
    cache.guardar(coordenadas, viaje);
    return viaje;
  };
}

/** Nominatim (OpenStreetMap): una consulta por segundo como pide su política, en fila, con caché. */
export function crearGeocodificadorNominatim({ base = 'https://nominatim.openstreetmap.org', intervaloMs = 1100, buscar = fetch } = {}): Geocodificar {
  const cache = conCache<Punto | null>(2000);
  const enCurso = new Map<string, Promise<Punto | null>>();
  let fila: Promise<unknown> = Promise.resolve();
  return (direccion, comuna) => {
    const clave = `${direccion}|${comuna}`.toLowerCase();
    if (cache.tiene(clave)) return Promise.resolve(cache.leer(clave) ?? null);
    const pendiente = enCurso.get(clave);
    if (pendiente) return pendiente;
    const turno = fila.then(async () => {
      let punto: Punto | null = null;
      try {
        const q = new URLSearchParams({ q: `${direccion}, ${comuna}, Chile`, format: 'jsonv2', limit: '1', countrycodes: 'cl' });
        const r = await buscar(`${base}/search?${q}`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(5000) });
        const [hit] = r.ok ? ((await r.json()) as { lat: string; lon: string }[]) : [];
        if (hit) punto = [Number(hit.lon), Number(hit.lat)];
        cache.guardar(clave, punto);
      } catch {
        console.warn('[reparto] Nominatim no respondió');
      }
      await new Promise(listo => setTimeout(listo, intervaloMs));
      return punto;
    });
    fila = turno;
    const resultado = turno.finally(() => enCurso.delete(clave));
    enCurso.set(clave, resultado);
    return resultado;
  };
}

/** Dirección que vale la pena ubicar: la del SII, no la de la consulta simulada. */
const direccionReal = (n: Negocio): string | undefined => {
  const c = n.contribuyente;
  const d = c?.direccion?.trim();
  return c && !c.simulado && d && !/^sin informar$/i.test(d) ? d : undefined;
};

export interface OpcionesReparto {
  viaje?: BuscarViaje | null;
  geocodificar?: Geocodificar | null;
  /** Cuánto se espera a la geocodificación antes de responder con lo que haya (el resto queda en caché). */
  esperaMs?: number;
}

/** Con `REPARTO_CALLES=0` o `REPARTO_GEOCODIFICAR=0` se apaga cada servicio externo (queda la línea recta por comuna). */
export function opcionesDesdeEnv(env: NodeJS.ProcessEnv): OpcionesReparto {
  return {
    viaje: env.REPARTO_CALLES === '0' ? null : crearViajeOsrm(),
    geocodificar: env.REPARTO_GEOCODIFICAR === '0' ? null : crearGeocodificadorNominatim(),
  };
}

export function crearReparto(red: Red, { viaje = null, geocodificar = null, esperaMs = ESPERA_TOTAL_MS }: OpcionesReparto = {}) {
  /** Ubica a todos de una vez, esperando hasta `esperaMs`; lo que no llegue a tiempo queda en su comuna. */
  async function ubicarTodos(negocios: Negocio[]): Promise<Map<string, Punto>> {
    const exactos = new Map<string, Punto>();
    if (!geocodificar) return exactos;
    const pedidos = negocios.flatMap(n => {
      const d = direccionReal(n);
      return d ? [geocodificar(d, n.contribuyente!.comuna || n.comuna).then(p => { if (p) exactos.set(n.id, p); })] : [];
    });
    await Promise.race([Promise.all(pedidos), new Promise(listo => setTimeout(listo, esperaMs))]);
    return new Map(exactos);
  }

  return async function rutaDe(proveedorId: string): Promise<RutaReparto> {
    const estado = red.estadoDeLaRed();
    const proveedor = red.negocioPorId(proveedorId);
    const ordenes = estado.ordenes.filter(o => o.proveedorId === proveedorId);
    const compradores = [...new Set(ordenes.map(o => o.compradorId))].map(id => red.negocioPorId(id)).filter((n): n is Negocio => !!n);
    const exactos = await ubicarTodos(proveedor ? [proveedor, ...compradores] : compradores);

    const bodegaExacta = proveedor && exactos.get(proveedor.id);
    const bodega = { punto: bodegaExacta ?? (proveedor && centroDeComuna(proveedor.comuna)) ?? MUT, aproximada: !bodegaExacta };
    const donde = (id: string): DondeQueda | null => {
      const n = red.negocioPorId(id);
      if (!n) return null;
      const exacto = exactos.get(id);
      const direccion = direccionReal(n);
      return {
        nombre: n.nombre, comuna: n.contribuyente?.comuna || n.comuna, ...(direccion ? { direccion } : {}),
        punto: exacto ?? ubicarEnComuna(n.id, n.comuna), aproximado: !exacto,
      };
    };
    const ids = new Set(ordenes.map(o => o.id));
    const documentos = estado.documentos.filter(d => ids.has(d.ordenId)).map(d => {
      const pdfUrl = red.enlacePdf(d);
      return pdfUrl ? { ...d, pdfUrl } : d;
    });
    const paradas = paradasDeOrdenes(ordenes, documentos, donde);
    const porCalles = paradas.length && viaje ? await viaje([bodega.punto, ...paradas.map(p => p.punto)]) : null;
    return armarRuta(bodega, paradas, porCalles);
  };
}

export type Reparto = ReturnType<typeof crearReparto>;
