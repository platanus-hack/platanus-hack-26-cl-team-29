// "Mi catálogo" en el panel del proveedor: lo que vende, armado solo desde sus facturas en el SII (el equipo consigue
// los XML; el proveedor no carga nada). Cada producto trae los tramos que sugiere su historial y se suma a la compra
// conjunta abierta con un toque. Se actualiza en vivo con `catalogo.actualizado`.

import { useCallback, useState } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { fechaCorta } from '../../../shared/fecha.ts';
import { contar, sinTildes } from '../../../shared/texto.ts';
import type { CatalogoProveedor, ProductoCatalogo } from '../../../shared/catalogo.ts';
import type { CanalApi } from './api.ts';
import { Icono, iconoDeProducto, LogoSii } from './iconos.tsx';
import { useEnvio } from './piezas.tsx';
import type { LicitacionCanal } from './tipos.ts';
import { useDatoEnVivo } from './useCanal.ts';

const VISIBLES = 4;
/** Respaldo del evento mientras se arma (y lo único que tiene la red falsa del navegador). */
const POLEO_MS = 2000;
const armandoCatalogo = (c: CatalogoProveedor): boolean => c.estado === 'armando';

interface Props {
  api: CanalApi;
  token: string;
  /** La compra conjunta abierta, si hay: a ella se suman los productos. */
  abierta?: LicitacionCanal;
}

export function MiCatalogo({ api, token, abierta }: Props) {
  const [todos, setTodos] = useState(false);
  const cargar = useCallback(() => api.catalogo(token), [api, token]);
  const { dato: catalogo, error } = useDatoEnVivo(api, cargar, 'catalogo.actualizado', armandoCatalogo, POLEO_MS);

  if (!catalogo) return error ? <p className="error">{error}</p> : null;
  const armando = armandoCatalogo(catalogo);

  const enLaCompra = new Set((abierta?.productos ?? []).map(p => sinTildes(p.nombre)));
  const productos = todos ? catalogo.productos : catalogo.productos.slice(0, VISIBLES);
  return (
    <section className="tarjeta cn-catalogo" aria-busy={armando}>
      <div className="cn-fila-meta">
        <span className="cn-chip cn-con-sii"><LogoSii tam={14} />Desde tus facturas</span>
        {catalogo.origen === 'ejemplo' && <span className="mono tenue">Historial de ejemplo</span>}
      </div>
      <h2 className="cn-titulo">Mi catálogo</h2>
      {catalogo.estado === 'listo' && (
        <p className="mono tenue cn-texto">
          Armado desde tus {contar(catalogo.facturas, 'factura')} en el SII
          {catalogo.desde && catalogo.hasta ? ` (${fechaCorta(catalogo.desde)} al ${fechaCorta(catalogo.hasta)})` : ''}.
          {' '}Tramos según lo que cobraste por volumen.
        </p>
      )}
      {armando && <p className="mono tenue cn-texto">Armando tu catálogo desde tus facturas en el SII...</p>}
      {catalogo.estado === 'error' && <p className="error cn-texto">{catalogo.mensaje}</p>}
      {error && <p className="error">{error}</p>}

      {productos.length > 0 && (
        <ul className="cn-catalogo-lista">
          {productos.map(p => (
            <ProductoDelCatalogo key={p.clave} api={api} token={token} producto={p} abierta={!!abierta} yaEsta={enLaCompra.has(sinTildes(p.nombre))} />
          ))}
        </ul>
      )}
      {catalogo.productos.length > VISIBLES && (
        <button type="button" className="cn-boton-texto" onClick={() => setTodos(t => !t)}>
          {todos ? 'Ver menos' : `Ver los ${catalogo.productos.length} productos`}
        </button>
      )}
    </section>
  );
}

function ProductoDelCatalogo({ api, token, producto: p, abierta, yaEsta }: {
  api: CanalApi; token: string; producto: ProductoCatalogo; abierta: boolean; yaEsta: boolean;
}) {
  const { enviando, error, enviar } = useEnvio();
  return (
    <li className="cn-catalogo-producto">
      <div className="cn-catalogo-cabeza">
        <Icono nombre={iconoDeProducto(p.nombre)} tam={22} />
        <div className="cn-catalogo-dato">
          <strong>{p.nombre}</strong>
          <span className="mono tenue">
            {dinero(p.ultimoPrecio)} la última vez, {contar(p.unidadesVendidas, p.unidad)} en {contar(p.ventas, 'venta')}
          </span>
        </div>
      </div>
      <p className="mono tenue cn-catalogo-nota">{p.tramosDe === 'historial' ? 'Tramos sugeridos por tu historial' : 'Tramos automáticos: tu historial no muestra descuentos por volumen'}</p>
      <ol className="cn-catalogo-tramos">
        {p.tramos.map(t => (
          <li key={t.desde}><span className="tenue">{t.desde} o más</span> {dinero(t.precioUnitario)}</li>
        ))}
      </ol>
      {(yaEsta || abierta) && (
        <div className="cn-catalogo-accion">
          {yaEsta ? <span className="cn-chip">En la compra</span> : (
            <button type="button" className="boton secundario cn-catalogo-sumar" disabled={enviando}
              onClick={() => enviar(() => api.sumarDelCatalogo(token, p.clave))}>
              {enviando ? 'Sumando...' : 'Sumar con estos tramos'}
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}
