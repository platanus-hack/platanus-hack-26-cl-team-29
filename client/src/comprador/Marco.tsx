// El marco de la app del comprador con la marca Bando (DESIGN.md, Paper "C2"): en escritorio, lateral crema con el
// logo, las secciones y el negocio abajo; en el teléfono, una barra arriba con el negocio y las secciones fijas abajo.

import { useEffect, useState, type ReactNode } from 'react';
import { Monograma } from '../canal/iconos.tsx';
import { ICONO_MENU, type IconoMenu } from '../marca/recursos.ts';
import { Logo } from '../marca/Logo.tsx';
import { BotonTema } from '../marca/BotonTema.tsx';
import type { Negocio } from '../red/tipos.ts';
import './comprador.css';

export interface SeccionMarco<S extends string> {
  id: S;
  titulo: string;
  /** En la barra de abajo del teléfono, si el título no cabe. */
  corto?: string;
  /** Ícono ilustrado del menú (`ICONO_MENU`). */
  icono: IconoMenu;
  /** Un número al lado (por ejemplo, pedidos por revisar). */
  globo?: number;
}

export function Marco<S extends string>({ secciones, activa, negocio, aviso, onSalir, children }: {
  secciones: readonly SeccionMarco<S>[];
  activa: S;
  negocio: Negocio;
  /** El aviso de datos de prueba, si corresponde. */
  aviso?: ReactNode;
  onSalir: () => void;
  children: ReactNode;
}) {
  const quien = (
    <div className="bm-negocio">
      <Monograma nombre={negocio.nombre} tam={32} />
      <div className="bm-negocio-texto">
        <strong>{negocio.nombre}</strong>
        <span>{negocio.comuna}</span>
      </div>
    </div>
  );
  return (
    <div className="bando-ui bm-marco">
      <header className="bm-superior">
        <Logo variante="icono" className="bm-logo-icono" />
        {quien}
        <BotonTema className="bm-boton-icono" />
        <button type="button" className="bm-boton-texto" onClick={onSalir}>Salir</button>
      </header>

      <aside className="bm-lateral">
        <Logo className="bm-logo" />
        <nav className="bm-secciones" aria-label="Secciones">
          {secciones.map(s => (
            <a key={s.id} href={`#${s.id}`} className={s.id === activa ? 'activa' : ''} aria-current={s.id === activa ? 'page' : undefined}>
              <img className="bm-icono-menu ilustracion" src={ICONO_MENU[s.icono]} alt="" width={22} height={22} />
              <span className="bm-seccion-titulo">{s.titulo}</span>
              {s.corto && <span className="bm-seccion-corto" aria-hidden="true">{s.corto}</span>}
              {!!s.globo && <span className="bm-globo" aria-label={`${s.globo} por revisar`}>{s.globo}</span>}
            </a>
          ))}
        </nav>
        <div className="bm-lateral-pie">
          {aviso}
          {quien}
          <div className="bm-lateral-acciones">
            <button type="button" className="bm-boton-texto" onClick={onSalir}>Salir</button>
            <BotonTema className="bm-boton-icono" />
          </div>
        </div>
      </aside>

      <main className="bm-lienzo">{children}</main>
    </div>
  );
}

/** La sección (y lo que sigue) según el `#hash`, al día con cada cambio; al cambiar, vuelve arriba. La usan /app y /proveedor. */
export function useRutaDelHash<R>(leer: () => R): R {
  const [ruta, setRuta] = useState(leer);
  useEffect(() => {
    const alCambiar = () => { setRuta(leer()); scrollTo(0, 0); };
    addEventListener('hashchange', alCambiar);
    return () => removeEventListener('hashchange', alCambiar);
  }, [leer]);
  return ruta;
}
