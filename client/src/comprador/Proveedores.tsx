// Proveedores de la red para el comprador: pestañas "Mis proveedores" (a quienes ya les compró) y "Todos", con su
// comuna y su nota. Se recalcula con cada `red:evento` (la foto llega nueva).

import { useState } from 'react';
import { nota } from '../../../shared/formato.ts';
import { puedeVender } from '../../../shared/red.ts';
import { contar } from '../../../shared/texto.ts';
import { Monograma } from '../canal/iconos.tsx';
import type { FotoRed, YoComprador } from '../canal/tipos.ts';
import { Pestanas } from './Pestanas.tsx';

type Pestana = 'mios' | 'todos';

export function Proveedores({ foto, yo }: { foto: FotoRed; yo: YoComprador }) {
  const compras = new Map<string, number>();
  for (const o of yo.ordenes) compras.set(o.proveedorId, (compras.get(o.proveedorId) ?? 0) + 1);
  const notaDe = (id: string) => foto.notas.find(n => n.proveedorId === id)?.nota;
  // Los de mejor nota primero; sin nota, al final.
  const todos = foto.negocios.filter(puedeVender).sort((a, b) => (notaDe(b.id) ?? 0) - (notaDe(a.id) ?? 0) || a.nombre.localeCompare(b.nombre));
  const mios = todos.filter(n => compras.has(n.id)).sort((a, b) => compras.get(b.id)! - compras.get(a.id)!);
  const [pestana, setPestana] = useState<Pestana>(mios.length ? 'mios' : 'todos');
  const lista = pestana === 'mios' ? mios : todos;

  return (
    <>
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Proveedores</h1>
          <p className="bm-bajada">Los proveedores de la red compiten en tus compras en grupo. Los mejor evaluados, primero.</p>
        </div>
      </header>
      <Pestanas etiqueta="Proveedores" activa={pestana} onCambio={setPestana}
        pestanas={[['mios', 'Mis proveedores', mios.length], ['todos', 'Todos', todos.length]]} />
      {!lista.length ? (
        <p className="bm-vacio-texto">
          {pestana === 'mios' ? 'Todavía no le compras a nadie. Cuando gane una de tus compras en grupo, aparece aquí.' : 'Todavía no hay proveedores en la red.'}
        </p>
      ) : (
        <ul className="bm-tarjeta bm-lista">
          {lista.map(n => {
            const nt = notaDe(n.id);
            const veces = compras.get(n.id);
            return (
              <li key={n.id} className="bm-fila-proveedor">
                <Monograma nombre={n.nombre} tam={40} rubro={false} />
                <div className="bm-fila-cuerpo">
                  <strong className="bm-fila-nombre">{n.nombre}</strong>
                  <span className="bm-fila-abajo">{[n.comuna, veces ? `le compraste ${contar(veces, 'vez', 'veces')}` : ''].filter(Boolean).join(' · ')}</span>
                </div>
                <span className="bm-nota-proveedor">{nt !== undefined ? <>★ {nota(nt)}</> : 'Sin nota'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
