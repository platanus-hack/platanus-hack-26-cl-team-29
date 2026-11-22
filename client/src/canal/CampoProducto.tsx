// Productos de la biblioteca de Bando (lo que ya existe en la plataforma) y unidades de la lista fija.
// - `CampoProducto`: el proveedor escribe el nombre de lo que vende, con sugerencias; elegir una completa su unidad.
// - `SelectorProducto`: el comprador elige uno de la biblioteca con un buscador; no puede inventar uno.
// Así dos personas no crean el mismo producto con otro nombre y las compras calzan con las listas de los proveedores.

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { ProductoConocido } from '../../../shared/productos.ts';
import { esUnidad, nombreUnidad, UNIDADES, type IdUnidad } from '../../../shared/unidades.ts';
import type { CanalApi } from './api.ts';
import { Campo } from './Acceso.tsx';

/** Espera a que deje de escribir antes de buscar. */
const ESPERA_MS = 250;

export function CampoProducto({ api, etiqueta, nombre, onCambio, placeholder }: {
  api: CanalApi; etiqueta: string; nombre: string; placeholder: string;
  /** El nombre escrito y, si coincide con una sugerencia, su unidad. */
  onCambio: (nombre: string, unidad?: IdUnidad) => void;
}) {
  const lista = useId();
  const [sugeridos, setSugeridos] = useState<ProductoConocido[]>([]);
  useEffect(() => {
    if (nombre.trim().length < 2) return setSugeridos([]);
    const espera = setTimeout(() => { api.buscarProductos(nombre).then(setSugeridos, () => setSugeridos([])); }, ESPERA_MS);
    return () => clearTimeout(espera);
  }, [api, nombre]);
  const escribir = (texto: string) => onCambio(texto, sugeridos.find(s => s.nombre === texto)?.unidad);
  return (
    <Campo etiqueta={etiqueta}>
      <input value={nombre} onChange={e => escribir(e.target.value)} placeholder={placeholder} maxLength={60} list={lista} autoComplete="off" />
      <datalist id={lista}>
        {sugeridos.map(s => <option key={`${s.nombre}|${s.unidad}`} value={s.nombre}>{`por ${nombreUnidad(s.unidad)}`}</option>)}
      </datalist>
    </Campo>
  );
}

export function SelectorUnidad({ etiqueta = 'Se vende por', unidad, onCambio }: { etiqueta?: string; unidad: string; onCambio: (u: IdUnidad) => void }) {
  return (
    <Campo etiqueta={etiqueta}>
      <select value={esUnidad(unidad) ? unidad : ''} onChange={e => onCambio(e.target.value as IdUnidad)}>
        {!esUnidad(unidad) && <option value="" disabled>Elige una</option>}
        {UNIDADES.map(u => <option key={u.id} value={u.id}>{nombreUnidad(u.id)}</option>)}
      </select>
    </Campo>
  );
}

/** Busca en la biblioteca mientras se escribe, esperando a que deje de escribir. */
function useBiblioteca(api: CanalApi, q: string, activa: boolean): ProductoConocido[] | null {
  const [resultados, setResultados] = useState<ProductoConocido[] | null>(null);
  useEffect(() => {
    if (!activa) return;
    const espera = setTimeout(() => { api.buscarProductos(q).then(setResultados, () => setResultados([])); }, ESPERA_MS);
    return () => clearTimeout(espera);
  }, [api, q, activa]);
  return resultados;
}

/** Un producto de la biblioteca, elegido con un buscador (combobox accesible: flechas, Enter y Escape). */
export function SelectorProducto({ api, etiqueta, elegido, onElegir }: {
  api: CanalApi; etiqueta: string; elegido: ProductoConocido | null; onElegir: (p: ProductoConocido | null) => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const resultados = useBiblioteca(api, q, abierto && !elegido);
  const elegir = (p: ProductoConocido) => { onElegir(p); setAbierto(false); setQ(''); };
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = resultados?.length ?? 0;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActivo(i => Math.min(n - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && abierto && resultados?.[activo]) { e.preventDefault(); elegir(resultados[activo]); }
    else if (e.key === 'Escape') setAbierto(false);
  };

  if (elegido) {
    return (
      <div className="bm-campo">
        <span className="bm-campo-etiqueta">{etiqueta}</span>
        <div className="bm-elegido">
          <div><strong>{elegido.nombre}</strong><span>por {nombreUnidad(elegido.unidad)}</span></div>
          <button type="button" className="bm-boton-texto" onClick={() => { onElegir(null); setAbierto(true); }}>Cambiar</button>
        </div>
      </div>
    );
  }
  return (
    <div className="bm-campo bm-selector-producto">
      <label className="bm-campo-etiqueta" htmlFor={`${id}-q`}>{etiqueta}</label>
      <input id={`${id}-q`} role="combobox" aria-expanded={abierto} aria-controls={`${id}-lista`} aria-autocomplete="list"
        aria-activedescendant={abierto && resultados?.[activo] ? `${id}-${activo}` : undefined} autoComplete="off"
        value={q} placeholder="Busca un producto: café, rollos, guantes..." onChange={e => { setQ(e.target.value); setAbierto(true); setActivo(0); }}
        onFocus={() => setAbierto(true)} onBlur={() => setAbierto(false)} onKeyDown={teclas} />
      {abierto && resultados && (
        <ul id={`${id}-lista`} role="listbox" className="bm-opciones">
          {resultados.map((p, i) => (
            <li key={`${p.nombre}|${p.unidad}`} id={`${id}-${i}`} role="option" aria-selected={i === activo}
              onMouseDown={e => e.preventDefault()} onClick={() => elegir(p)} onMouseEnter={() => setActivo(i)}>
              <strong>{p.nombre}</strong><span>por {nombreUnidad(p.unidad)}</span>
            </li>
          ))}
          {!resultados.length && (
            <li className="bm-opciones-vacio" role="presentation">
              No encontramos «{q.trim()}» en Bando. Prueba con otra palabra o pídele a tu proveedor que lo agregue a su lista.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
