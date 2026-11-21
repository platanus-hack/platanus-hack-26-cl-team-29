// Estado de la red para las pantallas. Pide GET /api/red/estado y escucha `red:evento`.
// Si el backend no responde, usa la red falsa y sigue preguntando: apenas responde, cambia a datos reales.

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { EstadoRed, EventoRed, Fuente } from './tipos.ts';
import { cambiosDeNota, normalizarEstado, type CambioNota } from './derivar.ts';
import { iniciarRedFalsa, type RedFalsa } from './falso.ts';

/** Cuánto tiempo se muestra animado un cambio de nota. */
const DURACION_CAMBIO = 12_000;
const MAX_EVENTOS = 30;
const REINTENTO_MS = 5_000;

async function pedirEstado(): Promise<EstadoRed> {
  const r = await fetch('/api/red/estado', { headers: { accept: 'application/json' } });
  // Sin backend de la red, el fallback SPA responde index.html con 200: eso también es "no hay backend".
  if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw new Error(`estado ${r.status}`);
  return normalizarEstado(await r.json());
}

/** Evento recibido, con una clave local para animarlo en las listas. */
export type EventoVisto = EventoRed & { clave: number };

export interface DatosUnirse {
  nombre: string;
  comuna: string;
  cantidad: number;
}

export function useRed() {
  const [estado, setEstado] = useState<EstadoRed | null>(null);
  const [eventos, setEventos] = useState<EventoVisto[]>([]);
  const [cambios, setCambios] = useState<CambioNota[]>([]);
  const [fuente, setFuente] = useState<Fuente>('cargando');
  const previo = useRef<EstadoRed | null>(null);
  const falsa = useRef<RedFalsa | null>(null);
  const contador = useRef(0);

  const recibirEstado = useCallback((nuevo: EstadoRed) => {
    const ahora = Date.now();
    const nuevos = cambiosDeNota(previo.current, nuevo, ahora);
    previo.current = nuevo;
    setEstado(nuevo);
    setCambios(c => [...c.filter(x => ahora - x.en < DURACION_CAMBIO && !nuevos.some(n => n.proveedorId === x.proveedorId)), ...nuevos]);
  }, []);

  const recibirEvento = useCallback((e: EventoRed) => {
    setEventos(es => [{ ...e, clave: ++contador.current }, ...es].slice(0, MAX_EVENTOS));
  }, []);

  useEffect(() => {
    let activo = true;
    let reintento: ReturnType<typeof setTimeout> | undefined;
    let refresco: ReturnType<typeof setTimeout> | undefined;
    let socket: ReturnType<typeof io> | undefined;

    const refrescar = () => {
      clearTimeout(refresco);
      refresco = setTimeout(() => pedirEstado().then(e => activo && recibirEstado(e)).catch(() => {}), 150);
    };

    const pasarAReal = (inicial: EstadoRed) => {
      falsa.current?.detener();
      falsa.current = null;
      previo.current = null;
      setEventos([]);
      recibirEstado(inicial);
      setFuente('real');
      socket = io();
      socket.on('red:evento', (e: EventoRed) => {
        recibirEvento(e);
        refrescar(); // la foto manda; el evento alimenta el feed y dispara la animación
      });
      socket.on('connect', refrescar);
    };

    const intentar = () => {
      pedirEstado()
        .then(e => activo && pasarAReal(e))
        .catch(() => {
          if (!activo) return;
          if (!falsa.current) {
            setFuente('falsa');
            falsa.current = iniciarRedFalsa((e, ev) => {
              recibirEstado(e);
              if (ev) recibirEvento(ev);
            });
          }
          reintento = setTimeout(intentar, REINTENTO_MS);
        });
    };
    intentar();

    return () => {
      activo = false;
      clearTimeout(reintento);
      clearTimeout(refresco);
      falsa.current?.detener();
      falsa.current = null;
      socket?.close();
    };
  }, [recibirEstado, recibirEvento]);

  // Los cambios de nota vencidos se limpian solos para que la animación termine.
  useEffect(() => {
    if (!cambios.length) return;
    const t = setTimeout(() => setCambios(c => c.filter(x => Date.now() - x.en < DURACION_CAMBIO)), 1000);
    return () => clearTimeout(t);
  }, [cambios]);

  const unirse = useCallback(async (licitacionId: string, datos: DatosUnirse) => {
    if (falsa.current) return falsa.current.unirse(licitacionId, datos);
    const r = await fetch(`/api/red/licitaciones/${encodeURIComponent(licitacionId)}/unirse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(datos),
    });
    if (!r.ok) {
      // El backend responde { error, mensaje }; el mensaje ya viene en español para la persona.
      const cuerpo = (await r.json().catch(() => null)) as { mensaje?: unknown } | null;
      throw new Error(typeof cuerpo?.mensaje === 'string' ? cuerpo.mensaje : `No pudimos sumarte (${r.status})`);
    }
  }, []);

  return { estado, eventos, cambios, fuente, unirse };
}

/** Hora actual que se actualiza sola, para cuentas regresivas y "hace 5 s". */
export function useAhora(cadaMs = 1000): number {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
  return ahora;
}
