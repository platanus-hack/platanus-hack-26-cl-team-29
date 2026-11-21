// Conexión del canal web con la red: elige la API (real o falsa), trae la config y la foto pública,
// y avisa cada cambio en vivo (Socket.io o la red falsa) para que cada página vuelva a pedir lo suyo.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fuente } from '../red/tipos.ts';
import { crearApiReal, ErrorCanal, hayBackend, type CanalApi } from './api.ts';
import { crearApiFalsa } from './falso.ts';
import type { ConfigRed, FotoRed } from './tipos.ts';

let apiElegida: Promise<CanalApi> | undefined;

/** Una sola API por pestaña: la falsa guarda su estado en memoria. */
function elegirApi(): Promise<CanalApi> {
  apiElegida ??= hayBackend().then(real => (real ? crearApiReal() : crearApiFalsa()));
  return apiElegida;
}

export function useCanal() {
  const [api, setApi] = useState<CanalApi | null>(null);
  const [config, setConfig] = useState<ConfigRed | null>(null);
  const [foto, setFoto] = useState<FotoRed | null>(null);
  /** Sube con cada cambio en la red: las páginas lo usan para volver a pedir sus datos. */
  const [cambio, setCambio] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    let pausa: ReturnType<typeof setTimeout> | undefined;
    let dejar: (() => void) | undefined;
    elegirApi().then(async a => {
      if (!activo) return;
      setApi(a);
      const refrescar = () => a.estado().then(f => activo && setFoto(f)).catch(() => {});
      try {
        const [c] = await Promise.all([a.config(), refrescar()]);
        if (activo) setConfig(c);
      } catch (e) {
        if (activo) setError(e instanceof ErrorCanal ? e.message : 'No pudimos conectar con la red.');
      }
      dejar = a.escuchar(() => {
        clearTimeout(pausa);
        pausa = setTimeout(() => {
          refrescar();
          setCambio(n => n + 1);
        }, 150);
      });
    });
    return () => {
      activo = false;
      clearTimeout(pausa);
      dejar?.();
    };
  }, []);

  const fuente: Fuente = !api ? 'cargando' : api.modo === 'falso' ? 'falsa' : 'real';
  return { api, config, foto, cambio, fuente, error };
}

/** Guarda un valor en el almacenamiento del navegador; si no está disponible, sigue sin él. */
export function useGuardado(clave: string, almacen: 'local' | 'sesion') {
  const leer = useCallback((): string | null => {
    try {
      return (almacen === 'local' ? localStorage : sessionStorage).getItem(clave);
    } catch {
      return null;
    }
  }, [clave, almacen]);
  const [valor, setValor] = useState<string | null>(leer);
  const guardar = useCallback((nuevo: string | null) => {
    setValor(nuevo);
    try {
      const s = almacen === 'local' ? localStorage : sessionStorage;
      if (nuevo === null) s.removeItem(clave);
      else s.setItem(clave, nuevo);
    } catch {
      // Navegación privada o almacenamiento bloqueado: la sesión dura lo que dure la pestaña.
    }
  }, [clave, almacen]);
  return [valor, guardar] as const;
}

/** Datos de una página con sesión (`/yo`), que se vuelven a pedir con cada cambio de la red. */
export function useDatosConSesion<T>(
  api: CanalApi | null,
  token: string | null,
  cambio: number,
  pedir: (api: CanalApi, token: string) => Promise<T>,
  alVencer: () => void,
) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [pedidos, setPedidos] = useState(0);
  const pedirRef = useRef(pedir);
  pedirRef.current = pedir;
  const vencerRef = useRef(alVencer);
  vencerRef.current = alVencer;

  useEffect(() => {
    if (!api || !token) return setDatos(null);
    let activo = true;
    pedirRef.current(api, token)
      .then(d => { if (activo) { setDatos(d); setError(''); } })
      .catch((e: unknown) => {
        if (!activo) return;
        if (e instanceof ErrorCanal && e.sesionVencida) return vencerRef.current();
        setError(e instanceof Error ? e.message : 'No pudimos traer tus datos.');
      });
    return () => { activo = false; };
  }, [api, token, cambio, pedidos]);

  const recargar = useCallback(() => setPedidos(n => n + 1), []);
  return { datos, error, recargar };
}
