// La tabla de precios por cantidad que escribe el proveedor: la primera fila es su precio base y cada otra, "desde N,
// a $X". La usan su lista de productos y su oferta en una compra en grupo. La validación es la de siempre
// (`errorDeTramos`): cantidades que suben, precios que nunca suben.

import { useState } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { MAX_TRAMOS, tramosAutomaticos, type Tramo } from '../../../shared/precios.ts';

export type FilaTramo = { desde: string; precio: string };

export const aFilas = (tramos: readonly Tramo[]): FilaTramo[] => tramos.map(t => ({ desde: String(t.desde), precio: String(t.precioUnitario) }));
export const aTramos = (filas: readonly FilaTramo[]): Tramo[] => filas.map(f => ({ desde: Number(f.desde), precioUnitario: Number(f.precio) }));
const soloDigitos = (v: string) => v.replace(/\D/g, '');

/** Las filas y lo que se hace con ellas. */
export function useTramos(inicial: FilaTramo[]) {
  const [filas, setFilas] = useState(inicial);
  const base = Number(filas[0]?.precio);
  return {
    filas, setFilas, base,
    cambiar: (i: number, campo: keyof FilaTramo, valor: string) => setFilas(fs => fs.map((f, k) => (k === i ? { ...f, [campo]: soloDigitos(valor) } : f))),
    quitar: (i: number) => setFilas(fs => fs.filter((_, k) => k !== i)),
    agregar: () => setFilas(fs => [...fs, { desde: String(Math.max(2, Number(fs.at(-1)!.desde) * 2 || 10)), precio: fs.at(-1)!.precio }]),
    sugerir: () => setFilas(aFilas(tramosAutomaticos(base))),
  };
}

export function TablaTramos({ t, unidad, unidades }: { t: ReturnType<typeof useTramos>; unidad: string; unidades: string }) {
  return (
    <div className="bp-tramos" role="table" aria-label="Precio por cantidad">
      <div className="bp-tramo bp-tramo-titulos" role="row">
        <span role="columnheader">Desde ({unidades})</span><span role="columnheader">Precio por {unidad}</span><span />
      </div>
      {t.filas.map((f, i) => (
        <div key={i} role="row" className="bp-tramo">
          {i === 0 ? <span role="cell" className="bp-base">Precio base</span> : (
            <input aria-label={`Tramo ${i + 1}: desde cuántas ${unidades}`} inputMode="numeric" value={f.desde} onChange={e => t.cambiar(i, 'desde', e.target.value)} />
          )}
          <input aria-label={i === 0 ? `Precio base por ${unidad}` : `Tramo ${i + 1}: precio por ${unidad}`} inputMode="numeric" placeholder="$12.000"
            value={f.precio ? dinero(Number(f.precio)) : ''} onChange={e => t.cambiar(i, 'precio', e.target.value)} />
          {i === 0 ? <span /> : (
            <button type="button" className="bm-boton-texto" aria-label={`Quitar el tramo ${i + 1}`} onClick={() => t.quitar(i)}>Quitar</button>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Agregar tramo" y, con solo el precio base, la sugerencia de 5, 10 y 15 % menos. */
export function AccionesTramos({ t }: { t: ReturnType<typeof useTramos> }) {
  return (
    <>
      {t.filas.length < MAX_TRAMOS && <button type="button" className="bm-boton secundario" onClick={t.agregar} disabled={!t.base}>Agregar tramo</button>}
      {t.filas.length === 1 && t.base > 0 && <button type="button" className="bm-boton-texto" onClick={t.sugerir}>Sugerir tramos (5, 10 y 15 % menos)</button>}
    </>
  );
}
