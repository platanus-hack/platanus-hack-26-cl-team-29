// Estado de la red para las pantallas. Pide GET /api/red/estado y escucha `red:evento`.
// Si el backend no responde, usa la red falsa y sigue preguntando: apenas responde, cambia a datos reales.

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { ConfigRed, EstadoRed, EventoRed, Fuente } from './tipos.ts';
import { cambiosDeNota, normalizarEstado, type CambioNota } from './derivar.ts';
import { CONFIG_FALSA, type RedFalsa } from './falso.ts';
import { iniciarRedFalsaCompartida } from './falso-compartido.ts';

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

/** Evento recibido, con una clave local para animarlo en las listas y la hora local en que llegó. */
export type EventoVisto = EventoRed & { clave: number; recibido: number };

/** Acciones del panel del presentador. Todas exigen el token de la demo. */
export type AccionDemo = 'reiniciar' | 'cerrar' | 'confirmar' | 'cobrar';

const RUTA_ACCION: Record<AccionDemo, (id: string) => string> = {
  reiniciar: () => '/api/red/demo/reiniciar',
  cerrar: id => `/api/red/licitaciones/${encodeURIComponent(id)}/cerrar`,
  confirmar: id => `/api/red/licitaciones/${encodeURIComponent(id)}/confirmar`,
  cobrar: () => '/api/pagos/demo/cobrar',
};

async function mensajeDeError(r: Response, porDefecto: string): Promise<string> {
  // El backend responde { error, mensaje }; el mensaje ya viene en español para la persona.
  const cuerpo = (await r.json().catch(() => null)) as { mensaje?: unknown } | null;
  return typeof cuerpo?.mensaje === 'string' ? cuerpo.mensaje : `${porDefecto} (${r.status})`;
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
    setEventos(es => [{ ...e, clave: ++contador.current, recibido: Date.now() }, ...es].slice(0, MAX_EVENTOS));
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

    // La demo se reinició: foto nueva completa, sin animar diferencias y con el feed vacío.
    const reiniciar = (foto: unknown) => {
      try {
        previo.current = null;
        setEventos([]);
        setCambios([]);
        recibirEstado(normalizarEstado(foto));
      } catch {
        refrescar();
      }
    };

    const pasarAReal = (inicial: EstadoRed) => {
      falsa.current?.detener();
      falsa.current = null;
      previo.current = null;
      setEventos([]);
      recibirEstado(inicial);
      setFuente('real');
      // Lo que pasó antes de abrir la pantalla (los últimos eventos): el feed no parte vacío a mitad de la demo.
      fetch('/api/red/eventos', { headers: { accept: 'application/json' } })
        .then(r => (r.ok ? (r.json() as Promise<EventoRed[]>) : []))
        .then(previos => activo && setEventos(es => [
          ...es,
          ...previos.map(e => ({ ...e, clave: ++contador.current, recibido: Date.parse(e.en) || Date.now() })),
        ].slice(0, MAX_EVENTOS)))
        .catch(() => {});
      socket = io();
      socket.on('red:evento', (e: EventoRed) => {
        if (e.tipo === 'red.reiniciada') return reiniciar(e.datos);
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
            falsa.current = iniciarRedFalsaCompartida((e, ev) => {
              if (ev?.tipo === 'red.reiniciada') return reiniciar(e);
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

  /** Devuelve lo que responde el backend (por ejemplo `{ cobrados, fallidos }` al cobrar). */
  const accionDemo = useCallback(async (accion: AccionDemo, token: string, licitacionId = ''): Promise<unknown> => {
    if (falsa.current) {
      if (accion === 'cobrar') throw new Error('El cobro funciona solo con la red real.');
      return falsa.current[accion](licitacionId);
    }
    const r = await fetch(RUTA_ACCION[accion](licitacionId), { method: 'POST', headers: { 'x-demo-token': token } });
    if (!r.ok) throw new Error(await mensajeDeError(r, 'No se pudo'));
    return r.json().catch(() => null);
  }, []);

  return { estado, eventos, cambios, fuente, accionDemo };
}

/** GET /api/red/config. Con la red falsa usa su config; si el backend todavía no tiene la ruta, sin número. */
export function useConfigRed(fuente: Fuente): ConfigRed {
  const [config, setConfig] = useState<ConfigRed>({ whatsappNumero: null });
  useEffect(() => {
    if (fuente === 'falsa') return setConfig(CONFIG_FALSA);
    if (fuente !== 'real') return;
    let activo = true;
    fetch('/api/red/config', { headers: { accept: 'application/json' } })
      .then(r => (r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null))
      .then((c: ConfigRed | null) => activo && setConfig({ ...c, whatsappNumero: c?.whatsappNumero || null }))
      .catch(() => {});
    return () => { activo = false; };
  }, [fuente]);
  return config;
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
