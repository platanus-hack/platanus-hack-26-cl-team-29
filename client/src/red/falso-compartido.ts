// Una sola red falsa para todas las pestañas del navegador: sin backend, /red, /mapa y /sala
// abiertas a la vez muestran los mismos datos y los mismos eventos, en vivo.
// La pestaña que toma el candado corre el guion y lo transmite; las demás solo escuchan.

import { iniciarRedFalsa, type RedFalsa } from './falso.ts';
import type { EstadoRed, EventoRed } from './tipos.ts';

const NOMBRE = 'domino-red-falsa';
const ACCIONES = ['unirse', 'reiniciar', 'cerrar', 'confirmar'] as const;
type Accion = (typeof ACCIONES)[number];

type Mensaje =
  | { tipo: 'cambio'; estado: EstadoRed; evento?: EventoRed }
  | { tipo: 'hola' }
  | { tipo: 'accion'; accion: Accion; args: unknown[] };

export function iniciarRedFalsaCompartida(alCambiar: (estado: EstadoRed, evento?: EventoRed) => void): RedFalsa {
  // Navegador sin estas APIs: cada pestaña con su propia red, como antes.
  if (typeof BroadcastChannel === 'undefined' || !globalThis.navigator?.locks) return iniciarRedFalsa(alCambiar);

  const canal = new BroadcastChannel(NOMBRE);
  let guion: RedFalsa | null = null;
  let ultimo: EstadoRed | null = null;
  let soltar: (() => void) | undefined;
  let detenido = false;

  const ejecutar = (accion: Accion, args: unknown[]) => (guion![accion] as (...a: unknown[]) => void)(...args);

  canal.onmessage = ({ data }: MessageEvent<Mensaje>) => {
    if (data.tipo === 'cambio' && !guion) alCambiar(data.estado, data.evento);
    // Una pestaña recién abierta pide la foto actual para no esperar al próximo evento.
    else if (data.tipo === 'hola' && guion && ultimo) canal.postMessage({ tipo: 'cambio', estado: ultimo } satisfies Mensaje);
    else if (data.tipo === 'accion' && guion) ejecutar(data.accion, data.args);
  };

  // El candado se suelta solo si la pestaña se cierra: otra lo toma y sigue con un guion nuevo.
  void navigator.locks.request(NOMBRE, () => new Promise<void>(resolve => {
    if (detenido) return resolve();
    soltar = resolve;
    guion = iniciarRedFalsa((estado, evento) => {
      ultimo = estado;
      alCambiar(estado, evento);
      canal.postMessage({ tipo: 'cambio', estado, evento } satisfies Mensaje);
    });
  }));
  canal.postMessage({ tipo: 'hola' } satisfies Mensaje);

  // Las acciones (sumarse, cerrar...) las ejecuta quien corre el guion, venga de la pestaña que venga.
  const pedir = (accion: Accion) => (...args: unknown[]) =>
    guion ? ejecutar(accion, args) : canal.postMessage({ tipo: 'accion', accion, args } satisfies Mensaje);

  return {
    detener() {
      detenido = true;
      guion?.detener();
      guion = null;
      soltar?.();
      canal.close();
    },
    unirse: pedir('unirse'),
    reiniciar: pedir('reiniciar'),
    cerrar: pedir('cerrar'),
    confirmar: pedir('confirmar'),
  };
}
