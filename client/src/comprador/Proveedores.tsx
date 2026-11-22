// Proveedores para el comprador: "Mis proveedores" (a quienes ya les compró, con su comuna y su nota) y "Todos", el
// buscador de los de la red y los de Mercado Público (BuscadorProveedores). Clic en uno → su ficha (#proveedores/<clave>).
// Se recalcula con cada `red:evento` (`cambio`).

import { useState } from 'react';
import { nota } from '../../../shared/formato.ts';
import { puedeVender } from '../../../shared/red.ts';
import { contar } from '../../../shared/texto.ts';
import { Monograma } from '../canal/iconos.tsx';
import type { FotoRed, YoComprador } from '../canal/tipos.ts';
import { Pestanas } from './Pestanas.tsx';
import { Buscador, FichaProveedor } from './BuscadorProveedores.tsx';

type Pestana = 'mios' | 'todos';

/** `#proveedores/<clave>`: la ficha de ese proveedor (por RUT o id de la red). */
export const rutaDeProveedor = (resto: readonly string[]): string | null => (resto.length ? decodeURIComponent(resto.join('/')) : null);
const irA = (clave: string | null) => { location.hash = clave ? `proveedores/${encodeURIComponent(clave)}` : 'proveedores'; };

export function Proveedores({ foto, yo, cambio, ficha }: { foto: FotoRed; yo: YoComprador; cambio: number; ficha: string | null }) {
  const compras = new Map<string, number>();
  for (const o of yo.ordenes) compras.set(o.proveedorId, (compras.get(o.proveedorId) ?? 0) + 1);
  const notaDe = (id: string) => foto.notas.find(n => n.proveedorId === id)?.nota;
  const mios = foto.negocios.filter(n => puedeVender(n) && compras.has(n.id)).sort((a, b) => compras.get(b.id)! - compras.get(a.id)!);
  const [pestana, setPestana] = useState<Pestana>(mios.length ? 'mios' : 'todos');

  if (ficha) return <div className="pv-pagina"><FichaProveedor clave={ficha} evento={cambio} volver={() => irA(null)} /></div>;

  return (
    <>
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Proveedores</h1>
          <p className="bm-bajada">Los de la red compiten en tus compras en grupo. En Todos, búscalos junto a los que le venden al Estado en Mercado Público.</p>
        </div>
      </header>
      <Pestanas etiqueta="Proveedores" activa={pestana} onCambio={setPestana}
        pestanas={[['mios', 'Mis proveedores', mios.length], ['todos', 'Todos']]} />
      {pestana === 'todos' ? (
        <Buscador evento={cambio} abrir={irA} />
      ) : !mios.length ? (
        <p className="bm-vacio-texto">Todavía no le compras a nadie. Cuando gane una de tus compras en grupo, aparece aquí.</p>
      ) : (
        <ul className="bm-tarjeta bm-lista">
          {mios.map(n => {
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
