// Ruta de reparto del proveedor: en qué orden visita a los negocios a los que ya vendió, saliendo de su bodega y
// volviendo a ella. Lógica pura que usan el servidor (respaldo cuando no hay ruta por calles) y la API falsa del
// cliente. Cada parada lleva su guía de despacho (52), que es el documento que acompaña la mercadería.
import { distanciaKm, type Punto } from './ubicacion.ts';

export interface GuiaParada {
  folio: number;
  estadoSii: string;
  pdfUrl?: string;
}

export interface ParadaReparto {
  /** 1, 2, 3...: el orden de visita. */
  orden: number;
  negocioId: string;
  nombre: string;
  comuna: string;
  /** La dirección que el negocio tiene en el SII, si se conoce. */
  direccion?: string;
  punto: Punto;
  /** Sin dirección ubicada: el punto es aproximado, en su comuna. */
  aproximado: boolean;
  /** Lo que lleva: lo que dice la guía de despacho (o lo pedido, si aún no hay guía). */
  items: { producto: string; cantidad: number }[];
  guias: GuiaParada[];
}

export interface RutaReparto {
  bodega: { punto: Punto; aproximada: boolean };
  paradas: ParadaReparto[];
  distanciaKm: number;
  duracionMin: number;
  /** La línea a dibujar: por calles si `porCalles`, si no, en línea recta entre paradas. */
  geometria: Punto[];
  porCalles: boolean;
  /** Enlace para abrir la ruta en Google Maps (sin API key). Lleva hasta `MAX_PARADAS_GOOGLE` paradas. */
  googleMaps: { url: string; paradas: number } | null;
}

/** Una parada antes de ordenar. */
export type ParadaSinOrden = Omit<ParadaReparto, 'orden'>;

/** Un viaje por calles ya resuelto (OSRM): el orden de las paradas (índices de la lista recibida), largo y línea. */
export interface ViajePorCalles {
  orden: number[];
  distanciaKm: number;
  duracionMin: number;
  geometria: Punto[];
}

/** Velocidad media urbana de un furgón y cuánto más largo es ir por calles que en línea recta (estimación sin OSRM). */
const KMH_URBANO = 25;
const FACTOR_CALLES = 1.3;
/** Google Maps acepta hasta 9 paradas intermedias en un enlace. */
export const MAX_PARADAS_GOOGLE = 9;

/** Largo en km del circuito bodega, paradas en `orden` y vuelta a la bodega. */
export function largoDelCircuito(bodega: Punto, puntos: readonly Punto[], orden: readonly number[]): number {
  const recorrido = [bodega, ...orden.map(i => puntos[i]!), bodega];
  return recorrido.slice(1).reduce((s, p, i) => s + distanciaKm(recorrido[i]!, p), 0);
}

/**
 * Orden de visita que sale de la bodega y vuelve a ella: vecino más cercano y después 2-opt (invierte tramos mientras
 * acorte el circuito). Devuelve los índices de `puntos` en el orden de visita.
 */
export function ordenarParadas(bodega: Punto, puntos: readonly Punto[]): number[] {
  const pendientes = new Set(puntos.map((_, i) => i));
  const orden: number[] = [];
  let actual = bodega;
  while (pendientes.size) {
    let mejor = -1;
    for (const i of pendientes) if (mejor < 0 || distanciaKm(actual, puntos[i]!) < distanciaKm(actual, puntos[mejor]!)) mejor = i;
    orden.push(mejor);
    pendientes.delete(mejor);
    actual = puntos[mejor]!;
  }
  // 2-opt sobre el circuito cerrado. Con pocas decenas de paradas termina en pocas vueltas.
  const punto = (k: number) => (k < 0 || k >= orden.length ? bodega : puntos[orden[k]!]!);
  for (let mejoro = true, vueltas = 0; mejoro && vueltas < 50; vueltas++) {
    mejoro = false;
    for (let a = 0; a < orden.length - 1; a++) {
      for (let b = a + 1; b < orden.length; b++) {
        const antes = distanciaKm(punto(a - 1), punto(a)) + distanciaKm(punto(b), punto(b + 1));
        const despues = distanciaKm(punto(a - 1), punto(b)) + distanciaKm(punto(a), punto(b + 1));
        if (despues < antes - 1e-9) {
          orden.splice(a, b - a + 1, ...orden.slice(a, b + 1).reverse());
          mejoro = true;
        }
      }
    }
  }
  return orden;
}

const latLng = ([lng, lat]: Punto) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

/** Enlace de Google Maps: sale de la bodega, pasa por las paradas en orden y vuelve. */
export function enlaceGoogleMaps(bodega: Punto, paradas: readonly Punto[]): { url: string; paradas: number } | null {
  if (!paradas.length) return null;
  const incluidas = paradas.slice(0, MAX_PARADAS_GOOGLE);
  const q = new URLSearchParams({ api: '1', origin: latLng(bodega), destination: latLng(bodega), travelmode: 'driving', waypoints: incluidas.map(latLng).join('|') });
  return { url: `https://www.google.com/maps/dir/?${q}`, paradas: incluidas.length };
}

/** La ruta completa: con el viaje por calles si lo hay, si no, el orden local en línea recta. */
export function armarRuta(bodega: RutaReparto['bodega'], paradas: readonly ParadaSinOrden[], viaje: ViajePorCalles | null): RutaReparto {
  const puntos = paradas.map(p => p.punto);
  const orden = viaje?.orden ?? ordenarParadas(bodega.punto, puntos);
  const enOrden = orden.map((i, k) => ({ ...paradas[i]!, orden: k + 1 }));
  const km = viaje?.distanciaKm ?? largoDelCircuito(bodega.punto, puntos, orden);
  return {
    bodega,
    paradas: enOrden,
    distanciaKm: Math.round(km * 10) / 10,
    duracionMin: Math.round(viaje?.duracionMin ?? ((km * FACTOR_CALLES) / KMH_URBANO) * 60),
    geometria: viaje?.geometria ?? (enOrden.length ? [bodega.punto, ...enOrden.map(p => p.punto), bodega.punto] : []),
    porCalles: !!viaje,
    googleMaps: enlaceGoogleMaps(bodega.punto, enOrden.map(p => p.punto)),
  };
}

/** Pedidos que el proveedor ya confirmó y todavía no se reciben: lo que hay que repartir. */
export const POR_ENTREGAR: readonly string[] = ['confirmada', 'facturada'];

interface OrdenParaRuta {
  id: string;
  compradorId: string;
  estado: string;
  items: readonly { producto: string; cantidad: number; cantidadDespachada?: number }[];
}
interface DocumentoParaRuta {
  ordenId: string;
  tipo: number;
  folio: number | null;
  estadoSii: string | null;
  pdfUrl?: string;
}
export interface DondeQueda {
  nombre: string;
  comuna: string;
  direccion?: string;
  punto: Punto;
  aproximado: boolean;
}

/**
 * Las paradas: una por negocio con pedidos por entregar, con todo lo que lleva y sus guías de despacho (52).
 * `donde` ubica a cada comprador; si no lo conoce, ese negocio queda fuera.
 */
export function paradasDeOrdenes(
  ordenes: readonly OrdenParaRuta[], documentos: readonly DocumentoParaRuta[], donde: (compradorId: string) => DondeQueda | null,
): ParadaSinOrden[] {
  const porNegocio = new Map<string, ParadaSinOrden>();
  for (const o of ordenes) {
    if (!POR_ENTREGAR.includes(o.estado)) continue;
    let parada = porNegocio.get(o.compradorId);
    if (!parada) {
      const lugar = donde(o.compradorId);
      if (!lugar) continue;
      parada = { negocioId: o.compradorId, ...lugar, items: [], guias: [] };
      porNegocio.set(o.compradorId, parada);
    }
    for (const i of o.items) {
      const cantidad = i.cantidadDespachada ?? i.cantidad;
      const previo = parada.items.find(x => x.producto === i.producto);
      if (previo) previo.cantidad += cantidad;
      else if (cantidad > 0) parada.items.push({ producto: i.producto, cantidad });
    }
    for (const d of documentos) {
      if (d.ordenId !== o.id || d.tipo !== 52 || d.folio === null) continue;
      parada.guias.push({ folio: d.folio, estadoSii: d.estadoSii ?? '', ...(d.pdfUrl ? { pdfUrl: d.pdfUrl } : {}) });
    }
  }
  return [...porNegocio.values()];
}
