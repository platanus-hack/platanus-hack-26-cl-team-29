// Conexión del canal web con la red: elige la API (real o falsa), trae la config y la foto pública,
// y avisa cada cambio en vivo (Socket.io o la red falsa) para que cada página vuelva a pedir lo suyo.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fuente } from '../red/tipos.ts';
import { crearApiReal, ErrorCanal, hayBackend, type CanalApi } from './api.ts';
import { crearApiFalsa } from './falso.ts';
import { mensajeDeError } from './logica.ts';
import type { ConfigRed, DatosEntrada, FotoRed } from './tipos.ts';

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
        setError(mensajeDeError(e, 'No pudimos traer tus datos.'));
      });
    return () => { activo = false; };
  }, [api, token, cambio, pedidos]);

  const recargar = useCallback(() => setPedidos(n => n + 1), []);
  return { datos, error, recargar };
}

interface SesionGuardada extends DatosEntrada {
  token: string;
  modo: string;
}

function leerSesion(texto: string | null): SesionGuardada | null {
  try {
    const s = texto ? (JSON.parse(texto) as SesionGuardada) : null;
    return s && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

/**
 * Sesión web del comprador, compartida por `/unirse` y `/app` en el mismo teléfono (localStorage).
 * Si vence (reinicio del servidor o de la red falsa), se vuelve a entrar sola con el mismo nombre.
 */
export function useSesionComprador(api: CanalApi | null) {
  const [guardada, guardar] = useGuardado('domino.app.sesion', 'local');
  const sesion = leerSesion(guardada);
  // Una sesión de la red falsa no sirve contra el backend real, ni al revés; una sin RUT (anterior a pedirlo) tampoco.
  const token = api && sesion?.modo === api.modo && sesion.rut ? sesion.token : null;

  const entrar = useCallback(async (datos: DatosEntrada) => {
    if (!api) return;
    const r = await api.sesion(datos);
    guardar(JSON.stringify({ ...datos, token: r.token, modo: api.modo } satisfies SesionGuardada));
  }, [api, guardar]);

  // Vuelve a entrar sola con lo guardado; una sesión guardada sin RUT (anterior a pedirlo) vuelve al formulario.
  const alVencer = useCallback(() => {
    if (sesion?.rut) void entrar({ nombre: sesion.nombre, comuna: sesion.comuna, rut: sesion.rut, ...(sesion.rubro ? { rubro: sesion.rubro } : {}) }).catch(() => guardar(null));
    else guardar(null);
  }, [sesion?.token, entrar, guardar]); // eslint-disable-line react-hooks/exhaustive-deps

  const salir = useCallback(() => guardar(null), [guardar]);
  return { token, nombre: sesion?.nombre, entrar, alVencer, salir };
}

/**
 * Un dato del panel que se pide con sesión y se actualiza en vivo: se vuelve a pedir con cada `red:evento` del tipo
 * dado y, mientras `enCurso` diga que algo sigue corriendo en el servidor, cada `poleoMs` como respaldo del evento
 * (y lo único que tiene la red falsa del navegador). `cargar` tiene que ser estable (useCallback).
 */
export function useDatoEnVivo<T>(
  api: CanalApi, cargar: () => Promise<T>, tipoEvento: string, enCurso: (dato: T) => boolean, poleoMs: number,
) {
  const [dato, setDato] = useState<T | null>(null);
  const [error, setError] = useState('');
  const recargar = useCallback(async () => {
    try {
      setDato(await cargar());
      setError('');
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }, [cargar]);
  useEffect(() => { void recargar(); }, [recargar]);
  useEffect(() => api.escuchar(e => { if (!e || e.tipo === tipoEvento) void recargar(); }), [api, tipoEvento, recargar]);
  const corriendo = dato !== null && enCurso(dato);
  useEffect(() => {
    if (!corriendo) return;
    const t = setInterval(() => { void recargar(); }, poleoMs);
    return () => clearInterval(t);
  }, [corriendo, poleoMs, recargar]);
  return { dato, setDato, error };
}
