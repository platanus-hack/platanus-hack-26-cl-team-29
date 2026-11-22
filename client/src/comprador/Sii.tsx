// "SII": los documentos tributarios del negocio, igual en /app y en /proveedor. Pestañas "Recibidas" (lo que le
// facturaron como comprador) y "Emitidas" (lo que facturó como proveedor), en ese orden en /app y al revés en
// /proveedor; filtro por tipo de DTE (factura, guía de despacho, nota de crédito); cada uno con su folio, la
// contraparte, el monto, su estado en el SII y su PDF. Se vuelve a pedir con cada `red:evento`.

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { totalOrden } from '../../../shared/precios.ts';
import { Monograma } from '../canal/iconos.tsx';
import type { Documento, Negocio } from '../red/tipos.ts';
import type { CanalApi } from '../canal/api.ts';
import { Confirmar, ListaDocumentos, useConfirmacion, useEnvio } from '../canal/piezas.tsx';
import type { FacturaA, OrdenCanal } from '../canal/tipos.ts';
import { CamposDireccion } from '../canal/Acceso.tsx';
import { useDatosConSesion } from '../canal/useCanal.ts';
import { Pestanas } from './Pestanas.tsx';
import '../proveedor/proveedor.css';

type Pestana = 'emitidas' | 'recibidas';
type Tipo = 'todos' | 33 | 52 | 61;
const TIPOS: readonly [Tipo, string][] = [['todos', 'Todos'], [33, 'Facturas'], [52, 'Guías de despacho'], [61, 'Notas de crédito']];
interface Lado { documentos: Documento[]; ordenes: OrdenCanal[]; facturaA?: FacturaA | null }
const NADA: Lado = { documentos: [], ordenes: [] };

/** Facturas, guías de despacho y notas de crédito: lo que queda registrado en el SII. */
const delSii = (docs: readonly Documento[]) => docs.filter(d => d.tipo === 33 || d.tipo === 61 || d.tipo === 52);

export function Sii({ api, token, cambio, negocios, panel, vende, compra, vencer, acciones }: {
  api: CanalApi; token: string; cambio: number; negocios: readonly Negocio[];
  /** En qué panel está: el comprador parte en Recibidas y el proveedor en Emitidas. */
  panel: 'comprador' | 'proveedor';
  /** Puede vender (ve Emitidas) y comprar (ve Recibidas). */
  vende: boolean; compra: boolean; vencer: () => void;
  /** Arriba a la derecha (en el panel del proveedor, el botón del SII). */
  acciones?: ReactNode;
}) {
  const emitidas = useDatosConSesion<Lado>(api, token, cambio, (a, t) => (vende ? a.yoProveedor(t) : Promise.resolve(NADA)), vencer).datos ?? NADA;
  const recibidas = useDatosConSesion<Lado>(api, token, cambio, (a, t) => (compra ? a.yo(t) : Promise.resolve(NADA)), vencer).datos ?? NADA;
  const [pestana, setPestana] = useState<Pestana>(panel === 'comprador' ? 'recibidas' : 'emitidas');
  const [tipo, setTipo] = useState<Tipo>('todos');
  const lado = pestana === 'emitidas' ? emitidas : recibidas;
  const delLado = delSii(lado.documentos);
  const docs = tipo === 'todos' ? delLado : delLado.filter(d => d.tipo === tipo);
  const pestanas: [Pestana, string, number][] = [
    ['recibidas', 'Recibidas', delSii(recibidas.documentos).length], ['emitidas', 'Emitidas', delSii(emitidas.documentos).length],
  ];
  if (panel === 'proveedor') pestanas.reverse();
  const nombre = (id: string | undefined) => negocios.find(n => n.id === id)?.nombre;
  const contraparte = (d: Documento) => {
    const o = lado.ordenes.find(x => x.id === d.ordenId);
    return (pestana === 'emitidas' ? nombre(o?.compradorId) : nombre(o?.proveedorId)) ?? (pestana === 'emitidas' ? 'Cliente' : 'Proveedor');
  };

  return (
    <section className="bm-facturas">
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">SII</h1>
          <p className="bm-bajada">Tus documentos tributarios: facturas, guías de despacho y notas de crédito, recibidas y emitidas.</p>
        </div>
        {acciones}
      </header>
      <Pestanas etiqueta="Documentos del SII" activa={pestana} onCambio={setPestana} pestanas={pestanas} />
      <div className="bm-chips" role="group" aria-label="Tipo de documento">
        {TIPOS.map(([id, texto]) => {
          const n = id === 'todos' ? delLado.length : delLado.filter(d => d.tipo === id).length;
          return (
            <button key={id} type="button" className={`bm-chip${tipo === id ? ' elegido' : ''}`} aria-pressed={tipo === id} onClick={() => setTipo(id)}>
              {texto} {n}
            </button>
          );
        })}
      </div>
      {compra && recibidas.facturaA && !recibidas.facturaA.direccion && <CompletarDireccion api={api} token={token} comuna={recibidas.facturaA.comuna} />}
      {docs.length ? (
        <ListaDocumentos documentos={docs} contraparte={contraparte} />
      ) : (
        <p className="bm-vacio-texto">
          {tipo !== 'todos' && delLado.length ? 'No hay documentos de este tipo.' : pestana === 'emitidas'
            ? (vende ? 'Todavía no emites facturas. Cuando ganes una compra en grupo y la factures, aparecen aquí con su estado en el SII.' : 'Tu negocio no vende en Bando. Regístralo como proveedor por WhatsApp para vender.')
            : 'Todavía no recibes facturas. Cuando cierre una compra en grupo en que participaste, la factura del proveedor llega aquí.'}
        </p>
      )}
    </section>
  );
}

/** Sin dirección (la consulta pública del SII no la trae), sus facturas no se pueden emitir: la completa aquí. */
function CompletarDireccion({ api, token, comuna: comunaSii }: { api: CanalApi; token: string; comuna: string }) {
  const [direccion, setDireccion] = useState('');
  const [comuna, setComuna] = useState(comunaSii);
  const { enviando, error, enviar } = useEnvio();
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    void enviar(() => api.fijarDireccion(token, { direccion: direccion.trim(), comuna: comuna.trim() }), 'No pudimos guardar tu dirección. Inténtalo de nuevo.');
  };
  return (
    <form className="bm-tarjeta bm-formulario bm-direccion" onSubmit={guardar}>
      <h2>Completa tu dirección de facturación</h2>
      <p className="bm-bajada">El SII no nos entrega tu dirección y sin ella tus proveedores no pueden emitirte la factura.</p>
      <div className="bm-nueva-fila"><CamposDireccion direccion={direccion} comuna={comuna} onDireccion={setDireccion} onComuna={setComuna} /></div>
      {error && <p className="bm-error" role="alert">{error}</p>}
      <button className="bm-boton" disabled={enviando || !direccion.trim() || !comuna.trim()}>{enviando ? 'Guardando...' : 'Guardar dirección'}</button>
    </form>
  );
}
