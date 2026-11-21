// Locales que el explorador va encontrando alrededor del MUT. Pide GET /api/locales una vez y escucha
// `locales:evento` para sumar cada celda recorrida, en vivo. Sin backend devuelve null y el mapa no dibuja la capa.

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export interface LocalMapa {
  id: string;
  nombre: string;
  tipo: string;
  lat: number;
  lng: number;
}

export interface CeldaMapa {
  sur: number;
  oeste: number;
  norte: number;
  este: number;
}

export interface AvanceLocales {
  celda: number;
  total: number;
  distanciaKm: number;
  fase: 'reparto' | 'acumulando';
  buscando: CeldaMapa | null;
  terminado: boolean;
}

export interface Locales {
  locales: LocalMapa[];
  avance: AvanceLocales;
}

const lista = (x: unknown): LocalMapa[] => (Array.isArray(x) ? x.filter(l => l && typeof l.id === 'string') : []);

export function useLocales(): Locales | null {
  const [datos, setDatos] = useState<Locales | null>(null);

  useEffect(() => {
    let activo = true;
    let socket: ReturnType<typeof io> | undefined;
    fetch('/api/locales', { headers: { accept: 'application/json' } })
      .then(r => (r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null))
      .then((foto: { locales?: unknown; avance?: AvanceLocales } | null) => {
        if (!activo || !foto?.avance) return;
        setDatos({ locales: lista(foto.locales), avance: foto.avance });
        socket = io();
        socket.on('locales:evento', (h: { nuevos?: unknown; avance?: AvanceLocales }) => {
          if (!h?.avance) return;
          const nuevos = lista(h.nuevos);
          setDatos(d => (d ? { locales: nuevos.length ? [...d.locales, ...nuevos] : d.locales, avance: h.avance! } : d));
        });
      })
      .catch(() => {});
    return () => {
      activo = false;
      socket?.close();
    };
  }, []);

  return datos;
}

/** Puntos para MapLibre: un Feature por local. */
export function puntosDeLocales(locales: LocalMapa[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: locales.map(l => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [l.lng, l.lat] }, properties: { nombre: l.nombre, tipo: l.tipo } })),
  };
}

/** Contorno de la celda que se está buscando, para mostrar por dónde va el explorador. */
export function contornoDeCelda(c: CeldaMapa | null): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!c) return { type: 'FeatureCollection', features: [] };
  const anillo = [[c.oeste, c.sur], [c.este, c.sur], [c.este, c.norte], [c.oeste, c.norte], [c.oeste, c.sur]];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [anillo] }, properties: {} }] };
}
