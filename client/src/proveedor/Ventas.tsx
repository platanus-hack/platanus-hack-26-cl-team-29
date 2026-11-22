// Ventas del proveedor (DESIGN.md, Paper "P2"): lo vendido hoy en grande, lo que espera su confirmación (la compra en
// grupo y los pedidos sueltos) y los reclamos. Toda acción en el SII pasa por un paso de confirmación en la página.

import { useCallback, type ReactNode } from 'react';
import { dinero, nota } from '../../../shared/formato.ts';
import { totalOrden } from '../../../shared/precios.ts';
import { contar } from '../../../shared/texto.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import type { Documento, Negocio } from '../red/tipos.ts';
import type { CanalApi } from '../canal/api.ts';
import { Icono, iconoDeProducto, LogoSii, Monograma } from '../canal/iconos.tsx';
import { estaAbierta, estaFacturada, montoNotaCredito, ordenesDeLaCompra, precioDelGrupo, resumenFacturacion, unidadPara, type Unidad } from '../canal/logica.ts';
import { Confirmar, useConfirmacion } from '../canal/piezas.tsx';
import type { ConfigRed, LicitacionCanal, OrdenCanal, YoProveedor } from '../canal/tipos.ts';
import { ventasDeHoy } from './pedidos.ts';

export interface PropsAccion {
  api: CanalApi;
  token: string;
  alCambiar: () => void;
}

const cantidadEn = (n: number, u: Unidad) => contar(n, u.singular, u.plural);

export function detalleDe(orden: OrdenCanal, config: ConfigRed | null): string {
  return orden.items.map(i => `${i.producto} × ${cantidadEn(i.cantidad, unidadPara(i.producto, config))}`).join(', ');
}

export function Ventas({ yo, lic, config, comprador, ...props }: PropsAccion & {
  yo: YoProveedor; lic?: LicitacionCanal; config: ConfigRed | null; comprador: (id: string) => Negocio | undefined;
}) {
  const ahora = useAhora();
  // Las órdenes de la compra en grupo se facturan juntas desde su fila, no una por una.
  const deCompras = new Set((yo.licitaciones ?? []).flatMap(l => ordenesDeLaCompra(l, yo.ordenes)).map(o => o.id));
  const nuevos = yo.ordenes.filter(o => o.estado === 'enviada' && !deCompras.has(o.id)).sort((a, b) => Date.parse(a.creadaEn) - Date.parse(b.creadaEn));
  const reclamos = yo.ordenes.filter(o => o.estado === 'reclamada');
  const compraPendiente = lic && !estaFacturada(lic, yo.ordenes) ? lic : undefined;
  const porConfirmar = nuevos.length + (compraPendiente ? 1 : 0);
  const hoy = ventasDeHoy(yo.ordenes, ahora);
  const emitidas = yo.documentos.filter(d => d.tipo === 33).length;

  return (
    <div className="bp-pagina">
      <header className="bp-hero">
        <div>
          <p className="bm-bajada">Hoy vendiste</p>
          <strong className="bp-cifra">{dinero(hoy.total)}</strong>
          <p className="bm-bajada">
            {contar(hoy.pedidos, 'pedido confirmado', 'pedidos confirmados')}
            {porConfirmar > 0 && <> · <span className="bp-miel">{porConfirmar} por confirmar</span></>}
          </p>
        </div>
        <a className="bm-boton secundario" href="#precios">{lic && estaAbierta(lic, ahora) ? 'Sumar un producto' : 'Abrir una compra en grupo'}</a>
      </header>

      <div className="bp-columnas">
        <div className="bp-columna">
          <Bloque titulo="Por confirmar" cuenta={porConfirmar}>
            {porConfirmar === 0 && <p className="bp-nada">Nada por confirmar. Cuando un negocio te pida, aparece aquí.</p>}
            {compraPendiente && <FilaCompra {...props} lic={compraPendiente} yo={yo} config={config} ahora={ahora} />}
            {nuevos.map(o => <FilaPedido key={o.id} {...props} orden={o} comprador={comprador(o.compradorId)} config={config} />)}
          </Bloque>
          {reclamos.length > 0 && (
            <Bloque titulo="Reclamos" cuenta={reclamos.length} tono="reclamo">
              {reclamos.map(o => <FilaReclamo key={o.id} {...props} orden={o} comprador={comprador(o.compradorId)} documentos={yo.documentos} config={config} />)}
            </Bloque>
          )}
        </div>

        <div className="bp-columna">
          <section className="bm-tarjeta bp-dato">
            <h2>Tu nota en la red</h2>
            <p><strong className="bp-cifra-chica">{yo.nota === null ? '-' : nota(yo.nota)}</strong>
              <span>{yo.nota === null ? 'Se calcula con tus primeras entregas.' : 'Sube con cada entrega conforme y baja con cada reclamo.'}</span></p>
          </section>
          <a className="bm-tarjeta bp-dato bp-enlace" href="#facturas">
            <h2 className="bp-con-sii"><LogoSii tam={16} /> Facturas en el SII</h2>
            <p><strong className="bp-cifra-chica">{emitidas}</strong><span>{emitidas === 1 ? 'emitida' : 'emitidas'}, una por negocio. Ver documentos</span></p>
          </a>
        </div>
      </div>
    </div>
  );
}

function Bloque({ titulo, cuenta, tono, children }: { titulo: string; cuenta: number; tono?: 'reclamo'; children: ReactNode }) {
  return (
    <section className={`bm-tarjeta bp-bloque${tono ? ` ${tono}` : ''}`}>
      <header className="bp-bloque-cabecera"><h2>{titulo}</h2>{cuenta > 0 && <span>{cuenta}</span>}</header>
      <ul className="bp-filas">{children}</ul>
    </section>
  );
}

/** Una fila con monograma o ícono, qué es, el monto y su botón; el paso de confirmación se abre debajo. */
function Fila({ icono, titulo, detalle, monto, accion, confirmacion }: {
  icono: ReactNode; titulo: string; detalle: string; monto?: number; accion?: ReactNode; confirmacion?: ReactNode;
}) {
  return (
    <li className="bp-fila">
      <span className="bp-fila-icono">{icono}</span>
      <div className="bp-fila-texto"><strong>{titulo}</strong><span>{detalle}</span></div>
      {monto !== undefined && <span className="bp-monto">{dinero(monto)}</span>}
      {accion}
      {confirmacion && <div className="puente-legado bp-fila-confirmar">{confirmacion}</div>}
    </li>
  );
}

type AccionCompra = { tipo: 'cerrar' } | { tipo: 'facturar'; facturas: number; total: number };

function FilaCompra({ api, token, alCambiar, lic, yo, config, ahora }: PropsAccion & { lic: LicitacionCanal; yo: YoProveedor; config: ConfigRed | null; ahora: number }) {
  const u = unidadPara(lic.producto, config);
  const g = precioDelGrupo(lic);
  const abierta = estaAbierta(lic, ahora);
  const ejecutar = useCallback(async (a: AccionCompra) => {
    await (a.tipo === 'cerrar' ? api.cerrar(token, lic.id) : api.facturar(token, lic.id));
    alCambiar();
  }, [api, token, lic.id, alCambiar]);
  const c = useConfirmacion(ejecutar);
  const f = resumenFacturacion(lic, yo.ordenes);
  const cierre = abierta ? `cierra en ${cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}` : 'cerrada, lista para facturar';
  const enCurso = c.estado.fase !== 'nada' ? c.estado.accion : undefined;

  return (
    <Fila
      icono={<Icono nombre={iconoDeProducto(lic.producto)} tam={22} />}
      titulo={`Compra en grupo · ${lic.producto}`}
      detalle={`${contar(lic.participantes.length, 'local', 'locales')} · ${cantidadEn(g.unidades, u)} · ${cierre}`}
      monto={f.total}
      accion={!enCurso && (lic.estado === 'abierta'
        ? <button type="button" className="bm-boton" onClick={() => c.pedir({ tipo: 'cerrar' })}>Cerrar</button>
        : <button type="button" className="bm-boton bp-boton-sii" onClick={() => c.pedir({ tipo: 'facturar', ...f })}><LogoSii tam={16} /> Facturar</button>)}
      confirmacion={enCurso?.tipo === 'cerrar' ? (
        <Confirmar titulo="¿Cierras la compra en grupo?" si="Sí, cerrar" {...c.panel}>
          <p>Nadie más podrá sumarse. Queda una orden por local: {contar(lic.participantes.length, 'local', 'locales')}, {cantidadEn(g.unidades, u)} a {g.precio !== undefined ? dinero(g.precio) : '-'} por {u.singular}.</p>
        </Confirmar>
      ) : enCurso?.tipo === 'facturar' ? (
        <Confirmar sii titulo={`¿Emites ${contar(enCurso.facturas, 'factura')} en el SII?`} si="Sí, factura todo" {...c.panel}>
          <p className="cn-cifra-confirmar">{dinero(enCurso.total)} neto en total</p>
          <p>Una factura por local, con su orden de compra como referencia, en un solo envío al SII. Le avisamos a cada uno con su folio.</p>
        </Confirmar>
      ) : undefined}
    />
  );
}

function FilaPedido({ api, token, alCambiar, orden, comprador, config }: PropsAccion & { orden: OrdenCanal; comprador?: Negocio; config: ConfigRed | null }) {
  const ejecutar = useCallback(async () => {
    await api.confirmarOrden(token, orden.id);
    alCambiar();
  }, [api, token, orden.id, alCambiar]);
  const c = useConfirmacion(ejecutar);
  const total = totalOrden(orden);
  const quien = comprador?.nombre ?? 'Un negocio';
  return (
    <Fila
      icono={<Monograma nombre={quien} tam={32} />}
      titulo={quien}
      detalle={`${detalleDe(orden, config)}${comprador?.comuna ? ` · ${comprador.comuna}` : ''}`}
      monto={total}
      accion={c.estado.fase === 'nada' && <button type="button" className="bm-boton" onClick={() => c.pedir(undefined)}>Confirmar</button>}
      confirmacion={c.estado.fase !== 'nada' && (
        <Confirmar sii titulo="¿Confirmas y facturas?" si="Sí, factura" {...c.panel}>
          <p className="cn-cifra-confirmar">1 factura · {dinero(total)} neto</p>
          <p>Emitimos en el SII la factura con la orden de compra de {quien} y su guía de despacho. Le avisamos a {quien}.</p>
        </Confirmar>
      )}
    />
  );
}

function FilaReclamo({ api, token, alCambiar, orden, comprador, documentos, config }: PropsAccion & {
  orden: OrdenCanal; comprador?: Negocio; documentos: Documento[]; config: ConfigRed | null;
}) {
  const ejecutar = useCallback(async () => {
    await api.notaCredito(token, orden.id);
    alCambiar();
  }, [api, token, orden.id, alCambiar]);
  const c = useConfirmacion(ejecutar);
  const monto = montoNotaCredito(orden, documentos);
  const factura = documentos.find(d => d.ordenId === orden.id && d.tipo === 33);
  const u = unidadPara(orden.items[0]?.producto ?? '', config);
  const quien = comprador?.nombre ?? 'Un negocio';
  const faltante = orden.reclamo?.faltante ?? 0;
  return (
    <Fila
      icono={<Monograma nombre={quien} tam={32} />}
      titulo={`${quien} reclamó${factura?.folio ? ` la factura ${factura.folio}` : ''}`}
      detalle={`${faltante === 1 ? 'Faltó' : 'Faltaron'} ${cantidadEn(faltante, u)}. Con la nota de crédito hoy, tu nota sube.`}
      monto={-monto}
      accion={c.estado.fase === 'nada' && <button type="button" className="bm-boton bp-boton-sii" onClick={() => c.pedir(undefined)}><LogoSii tam={16} /> Nota de crédito</button>}
      confirmacion={c.estado.fase !== 'nada' && (
        <Confirmar sii titulo="¿Emites la nota de crédito?" si="Sí, emítela" {...c.panel}>
          <p className="cn-cifra-confirmar">Nota de crédito · {dinero(monto)} neto</p>
          <p>Queda amarrada a la factura{factura?.folio ? ` ${factura.folio}` : ''} en el SII. Le avisamos a {quien}.</p>
        </Confirmar>
      )}
    />
  );
}
