// "Recepción" del comprador (/app): lo que le facturaron y todavía no confirma. "Llegó todo" registra el acuse en el SII
// y libera el pago al proveedor; "Faltó algo" (cuántas) deja el reclamo en el SII y el proveedor emite la nota de
// crédito. Las dos pasan por un paso de confirmación. Se recalcula con cada `red:evento`.

import { useCallback, useState } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { totalOrden } from '../../../shared/precios.ts';
import type { Negocio } from '../red/tipos.ts';
import type { CanalApi } from '../canal/api.ts';
import { Monograma } from '../canal/iconos.tsx';
import { Confirmar, useConfirmacion } from '../canal/piezas.tsx';
import type { OrdenCanal } from '../canal/tipos.ts';
import '../proveedor/proveedor.css';

export function Recepcion({ api, token, ordenes, negocios }: { api: CanalApi; token: string; ordenes: readonly OrdenCanal[]; negocios: readonly Negocio[] }) {
  const porRecibir = ordenes.filter(o => o.estado === 'facturada');
  const proveedor = (id: string) => negocios.find(n => n.id === id)?.nombre ?? 'Proveedor';
  return (
    <>
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Recepción</h1>
          <p className="bm-bajada">Cuando te llegue un pedido, confírmalo aquí: si llegó todo, el proveedor cobra; si faltó algo, queda el reclamo en el SII.</p>
        </div>
      </header>
      {!porRecibir.length ? (
        <p className="bm-vacio-texto">No tienes pedidos por recibir. Cuando un proveedor te facture, aparece aquí.</p>
      ) : (
        <ul className="bm-tarjeta bp-filas">{porRecibir.map(o => <Recibir key={o.id} api={api} token={token} orden={o} proveedor={proveedor(o.proveedorId)} />)}</ul>
      )}
    </>
  );
}

type AccionRecepcion = { conforme: true } | { faltante: number };

function Recibir({ api, token, orden, proveedor }: { api: CanalApi; token: string; orden: OrdenCanal; proveedor: string }) {
  const [faltante, setFaltante] = useState<string | null>(null);
  const ejecutar = useCallback(async (a: AccionRecepcion) => { await api.recepcion(token, orden.id, { ...a, confirmado: true }); }, [api, token, orden.id]);
  const c = useConfirmacion(ejecutar);
  const item = orden.items[0];
  const n = Number(faltante);
  return (
    <li className="bp-fila">
      <span className="bp-fila-icono"><Monograma nombre={proveedor} tam={32} /></span>
      <div className="bp-fila-texto">
        <strong>{proveedor}</strong>
        <span>{orden.items.map(i => `${i.producto} × ${i.cantidad}`).join(', ')} · {dinero(totalOrden(orden))}</span>
      </div>
      {c.estado.fase === 'nada' && faltante === null && (
        <div className="bp-producto-acciones">
          <button type="button" className="bm-boton" onClick={() => c.pedir({ conforme: true })}>Llegó todo</button>
          <button type="button" className="bm-boton-texto" onClick={() => setFaltante('1')}>Faltó algo</button>
        </div>
      )}
      {c.estado.fase === 'nada' && faltante !== null && (
        <div className="bp-producto-acciones">
          <label className="bm-faltaron">Faltaron
            <input inputMode="numeric" value={faltante} onChange={e => setFaltante(e.target.value.replace(/\D/g, ''))} aria-label="Cuántas faltaron" />
          </label>
          <button type="button" className="bm-boton" disabled={!(n >= 1 && n <= (item?.cantidad ?? 0))} onClick={() => c.pedir({ faltante: n })}>Seguir</button>
          <button type="button" className="bm-boton-texto" onClick={() => setFaltante(null)}>Cancelar</button>
        </div>
      )}
      {c.estado.fase !== 'nada' && (
        <div className="bp-fila-confirmar">
          {'conforme' in c.estado.accion ? (
            <Confirmar sii titulo="¿Llegó todo bien?" si="Sí, llegó todo" {...c.panel}>
              <p>Queda registrado en el SII que recibiste conforme la factura de {proveedor}, y Bando le paga.</p>
            </Confirmar>
          ) : (
            <Confirmar sii titulo={`¿Reclamas ${c.estado.accion.faltante} que faltaron?`} si="Sí, reclamar" {...c.panel}>
              <p>Queda el reclamo en el SII y {proveedor} emite la nota de crédito por lo que faltó.</p>
            </Confirmar>
          )}
        </div>
      )}
    </li>
  );
}

