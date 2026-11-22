// El nombre de un producto con sugerencias de la biblioteca de Bando (lo que ya existe en la plataforma) y la unidad de
// venta de la lista fija. Elegir una sugerencia completa el nombre y su unidad: así dos personas no crean el mismo
// producto con otro nombre. Lo usan la lista del proveedor y "Inicia una compra en grupo".

import { useEffect, useId, useState } from 'react';
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
