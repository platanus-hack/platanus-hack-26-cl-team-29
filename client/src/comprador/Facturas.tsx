// Facturas del negocio, igual en /app y en /proveedor: pestañas "Emitidas" (lo que facturó como proveedor) y
// "Recibidas" (lo que le facturaron como comprador), con su folio, la contraparte, el monto y su estado en el SII.
// Un negocio que compra y vende ve los dos lados. Se vuelve a pedir con cada `red:evento`.

import { useState } from 'react';
import type { Documento, Negocio } from '../red/tipos.ts';
import type { CanalApi } from '../canal/api.ts';
import { ListaDocumentos } from '../canal/piezas.tsx';
import type { OrdenCanal } from '../canal/tipos.ts';
import { useDatosConSesion } from '../canal/useCanal.ts';
import { Pestanas } from './Pestanas.tsx';

type Pestana = 'emitidas' | 'recibidas';
interface Lado { documentos: Documento[]; ordenes: OrdenCanal[] }
const NADA: Lado = { documentos: [], ordenes: [] };

/** Facturas, notas de crédito y guías: lo que queda registrado en el SII. */
const delSii = (docs: readonly Documento[]) => docs.filter(d => d.tipo === 33 || d.tipo === 61 || d.tipo === 52);

export function Facturas({ api, token, cambio, negocios, vende, compra, vencer }: {
  api: CanalApi; token: string; cambio: number; negocios: readonly Negocio[];
  /** Puede vender (ve Emitidas) y comprar (ve Recibidas). */
  vende: boolean; compra: boolean; vencer: () => void;
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
      </header>
      <Pestanas etiqueta="Facturas" activa={pestana} onCambio={setPestana}
        pestanas={[['emitidas', 'Emitidas', delSii(emitidas.documentos).length], ['recibidas', 'Recibidas', delSii(recibidas.documentos).length]]} />
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
