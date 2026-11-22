// Facturas del negocio, igual en /app y en /proveedor: pestañas "Emitidas" (lo que facturó como proveedor) y
// "Recibidas" (lo que le facturaron como comprador), con su folio, la contraparte, el monto y su estado en el SII.
// Un negocio que compra y vende ve los dos lados. Se vuelve a pedir con cada `red:evento`.

import { useCallback, useState, type ReactNode } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { totalOrden } from '../../../shared/precios.ts';
import { Monograma } from '../canal/iconos.tsx';
import type { Documento, Negocio } from '../red/tipos.ts';
import type { CanalApi } from '../canal/api.ts';
import { Confirmar, ListaDocumentos, useConfirmacion } from '../canal/piezas.tsx';
import type { OrdenCanal } from '../canal/tipos.ts';
import { useDatosConSesion } from '../canal/useCanal.ts';
import { Pestanas } from './Pestanas.tsx';
import '../proveedor/proveedor.css';

type Pestana = 'emitidas' | 'recibidas';
interface Lado { documentos: Documento[]; ordenes: OrdenCanal[] }
const NADA: Lado = { documentos: [], ordenes: [] };

/** Facturas, notas de crédito y guías: lo que queda registrado en el SII. */
const delSii = (docs: readonly Documento[]) => docs.filter(d => d.tipo === 33 || d.tipo === 61 || d.tipo === 52);

export function Facturas({ api, token, cambio, negocios, vende, compra, vencer, acciones }: {
  api: CanalApi; token: string; cambio: number; negocios: readonly Negocio[];
  /** Puede vender (ve Emitidas) y comprar (ve Recibidas). */
  vende: boolean; compra: boolean; vencer: () => void;
  /** Arriba a la derecha (en el panel del proveedor, el botón del SII). */
  acciones?: ReactNode;
}) {
  const emitidas = useDatosConSesion(api, token, cambio, (a, t) => (vende ? a.yoProveedor(t) : Promise.resolve(NADA)), vencer).datos ?? NADA;
  const recibidas = useDatosConSesion(api, token, cambio, (a, t) => (compra ? a.yo(t) : Promise.resolve(NADA)), vencer).datos ?? NADA;
  const [pestana, setPestana] = useState<Pestana>(vende ? 'emitidas' : 'recibidas');
  const lado = pestana === 'emitidas' ? emitidas : recibidas;
  const docs = delSii(lado.documentos);
  const nombre = (id: string | undefined) => negocios.find(n => n.id === id)?.nombre;
  const contraparte = (d: Documento) => {
    const o = lado.ordenes.find(x => x.id === d.ordenId);
    return (pestana === 'emitidas' ? nombre(o?.compradorId) : nombre(o?.proveedorId)) ?? (pestana === 'emitidas' ? 'Cliente' : 'Proveedor');
  };

  return (
    <section className="bm-facturas">
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Facturas</h1>
          <p className="bm-bajada">Tus documentos en el SII: lo que facturaste como proveedor y lo que te facturaron como comprador.</p>
        </div>
        {acciones}
      </header>
      <Pestanas etiqueta="Facturas" activa={pestana} onCambio={setPestana}
        pestanas={[['emitidas', 'Emitidas', delSii(emitidas.documentos).length], ['recibidas', 'Recibidas', delSii(recibidas.documentos).length]]} />
      {pestana === 'recibidas' && (
        <PorRecibir api={api} token={token} ordenes={recibidas.ordenes.filter(o => o.estado === 'facturada')} proveedor={id => nombre(id) ?? 'Proveedor'} />
      )}
      {docs.length ? (
        <div className="puente-legado"><ListaDocumentos documentos={docs} contraparte={contraparte} /></div>
      ) : (
        <p className="bm-vacio-texto">
          {pestana === 'emitidas'
            ? (vende ? 'Todavía no emites facturas. Cuando ganes una compra en grupo y la factures, aparecen aquí con su estado en el SII.' : 'Tu negocio no vende en Bando. Regístralo como proveedor por WhatsApp para vender.')
            : 'Todavía no recibes facturas. Cuando cierre una compra en grupo en que participaste, la factura del proveedor llega aquí.'}
        </p>
      )}
    </section>
  );
}

/**
 * Lo que le facturaron y todavía no recibe: "Llegó todo" (acuse en el SII, libera el pago al proveedor) o "Faltó algo"
 * (cuántas: reclamo en el SII y el proveedor emite la nota de crédito). Las dos pasan por un paso de confirmación.
 */
function PorRecibir({ api, token, ordenes, proveedor }: { api: CanalApi; token: string; ordenes: readonly OrdenCanal[]; proveedor: (id: string) => string }) {
  if (!ordenes.length) return null;
  return (
    <section className="bm-tarjeta bp-bloque">
      <header className="bp-bloque-cabecera"><h2>Por recibir</h2><span>{ordenes.length}</span></header>
      <ul className="bp-filas">{ordenes.map(o => <Recibir key={o.id} api={api} token={token} orden={o} proveedor={proveedor(o.proveedorId)} />)}</ul>
    </section>
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
        <div className="puente-legado bp-fila-confirmar">
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
