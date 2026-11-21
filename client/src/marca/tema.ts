// Tema de la interfaz de marca (DESIGN.md, "Modo oscuro"): claro u oscuro. Por defecto sigue al sistema; si la persona
// lo cambia, queda fijo en este dispositivo. Se aplica como `data-tema` en <html> antes de dibujar, así no parpadea.

import { useEffect, useState } from 'react';

export type Tema = 'claro' | 'oscuro';

const CLAVE = 'bando.tema';
const EVENTO = 'bando:tema';
const delSistema = () => matchMedia('(prefers-color-scheme: dark)');

function elegido(): Tema | null {
  try {
    const t = localStorage.getItem(CLAVE);
    return t === 'claro' || t === 'oscuro' ? t : null;
  } catch {
    return null;
  }
}

export const temaActual = (): Tema => elegido() ?? (delSistema().matches ? 'oscuro' : 'claro');

function aplicar() {
  document.documentElement.dataset.tema = temaActual();
  dispatchEvent(new Event(EVENTO));
}

/** Una vez, antes de dibujar la app. Si nadie eligió, sigue los cambios del sistema. */
export function iniciarTema() {
  aplicar();
  delSistema().addEventListener('change', aplicar);
}

/** El tema vigente y cómo pasar al otro (queda guardado en el dispositivo). */
export function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState(temaActual);
  useEffect(() => {
    const alCambiar = () => setTema(temaActual());
    addEventListener(EVENTO, alCambiar);
    return () => removeEventListener(EVENTO, alCambiar);
  }, []);
  const cambiar = () => {
    try {
      localStorage.setItem(CLAVE, tema === 'oscuro' ? 'claro' : 'oscuro');
    } catch {
      // Sin almacenamiento, el cambio dura lo que dure la página.
      document.documentElement.dataset.tema = tema === 'oscuro' ? 'claro' : 'oscuro';
      return setTema(t => (t === 'oscuro' ? 'claro' : 'oscuro'));
    }
    aplicar();
  };
  return [tema, cambiar];
}
