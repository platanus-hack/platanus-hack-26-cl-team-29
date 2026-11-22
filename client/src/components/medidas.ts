// Medidas del DOM para que la pantalla proyectada quepa sin scroll.

import { useLayoutEffect, useRef, useState } from 'react';

/** Tamaño de un elemento, actualizado cuando cambia (ventana, fuentes, contenido). */
export function useTamano<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [tamano, setTamano] = useState({ ancho: 0, alto: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setTamano({ ancho: el.clientWidth, alto: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, tamano] as const;
}

/**
 * Cuántas filas de una lista caben enteras en su alto disponible, hasta `maximo`.
 * La lista tiene que tener alto propio (flex: 1 y min-height: 0). Descuenta el relleno de la lista
 * y usa la fila más alta, así nunca queda una fila cortada a la mitad.
 * Sin alto acotado (pantallas chicas, con scroll), devuelve `maximo`.
 */
export function useFilasQueCaben<T extends HTMLElement>(maximo: number, cambios: unknown) {
  const ref = useRef<T>(null);
  const [caben, setCaben] = useState(maximo);
  useLayoutEffect(() => {
    const lista = ref.current;
    if (!lista) return;
    const medir = () => {
      const estilo = getComputedStyle(lista);
      const filas = Array.from(lista.children) as HTMLElement[];
      if (!filas.length || estilo.overflow !== 'hidden') return setCaben(maximo);
      const gap = parseFloat(estilo.rowGap) || 0;
      const util = lista.clientHeight - (parseFloat(estilo.paddingTop) || 0) - (parseFloat(estilo.paddingBottom) || 0);
      const fila = Math.max(...filas.map(f => f.offsetHeight));
      setCaben(Math.max(1, Math.min(maximo, Math.floor((util + gap) / (fila + gap)))));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(lista);
    document.fonts?.ready.then(medir);
    return () => ro.disconnect();
  }, [maximo, cambios]);
  return [ref, caben] as const;
}
