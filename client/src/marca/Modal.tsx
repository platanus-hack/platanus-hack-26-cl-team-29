// Un modal con la marca Bando: fondo oscurecido, se cierra con Escape, con la X o tocando afuera, y lleva el foco
// adentro al abrirse. El contenido decide su propio alto; en el teléfono ocupa todo el ancho.
import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    caja.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    addEventListener('keydown', tecla);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', tecla); document.body.style.overflow = scroll; antes?.focus(); };
  }, [onCerrar]);
  return (
    <div className="bm-modal-fondo" onMouseDown={e => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div ref={caja} className="bm-modal" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1}>
        <header className="bm-modal-cabecera">
          <h2>{titulo}</h2>
          <button type="button" className="bm-boton-icono" aria-label="Cerrar" onClick={onCerrar}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="bm-modal-cuerpo">{children}</div>
      </div>
    </div>
  );
}
