// La compra en grupo del comprador con la marca Bando (Paper "C2" y "C3"): la lista de productos con su progreso y,
// al entrar a uno, el frasco que se llena, la escalera de tramos y "Sumarme con N". Todo se recalcula con cada
// `red:evento` (la foto llega nueva); mis cambios sin guardar ya mueven el precio y el frasco.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { dinero, nota } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import {
  aItems, carritoEnLaFoto, CANTIDAD_MAXIMA, desdeItems, faltan, fijar, itemsDe, pistaTramo, productosDe, proyectar, una, type Carrito, type ProductoCanasta,
} from '../canal/carrito.ts';
import { Icono, iconoDeProducto } from '../canal/iconos.tsx';
import { estaAbierta, licitacionVigente } from '../canal/logica.ts';
import { useEnvio } from '../canal/piezas.tsx';
import { PedirTarjeta, useFaltaTarjeta } from '../canal/MiCredito.tsx';
import type { CanalApi } from '../canal/api.ts';
import type { FotoRed, LicitacionCanal, YoComprador } from '../canal/tipos.ts';
import { ABEJA, ILUSTRACION } from '../marca/recursos.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import { escalera, frasco, localesDelGrupo, rango, siLlegan } from './compra.ts';

interface Props {
  api: CanalApi;
  token: string;
  foto: FotoRed;
  yo: YoComprador;
  /** Producto abierto (`#compra/<id>`); sin él, la lista. */
  productoId?: string;
}

export function ComprasEnGrupo({ api, token, foto, yo, productoId }: Props) {
  const ahora = useAhora();
  const lic = licitacionVigente(foto.licitaciones);
  const productos = useMemo(() => (lic ? productosDe(lic) : []), [lic]);
  if (!lic) {
    return (
      <div className="bm-vacio">
        <img src={ILUSTRACION.equipo} alt="" />
        <h1>No hay una compra en grupo abierta</h1>
        <p>Cuando parta una, aparece aquí con sus precios en vivo.</p>
      </div>
    );
  }
  const guardado = carritoEnLaFoto(lic, yo.negocio.id) ?? desdeItems(yo.participaciones.find(p => p.licitacionId === lic.id)?.items ?? []);
  const abierta = estaAbierta(lic, ahora);
  const producto = productos.find(p => p.id === productoId);
  const cierre = <Cierre lic={lic} abierta={abierta} ahora={ahora} />;
  return producto
    ? <DetalleCompra api={api} token={token} foto={foto} lic={lic} p={producto} orden={productos.map(x => x.id)} guardado={guardado} abierta={abierta} cierre={cierre} />
    : <ListaCompras lic={lic} productos={productos} guardado={guardado} abierta={abierta} cierre={cierre} />;
}

function Cierre({ lic, abierta, ahora }: { lic: LicitacionCanal; abierta: boolean; ahora: number }) {
  return (
    <div className="bm-cierre">
      <span className="bm-etiqueta">{abierta ? 'Cierra en' : 'Cerró'}</span>
      <strong>{abierta ? cuentaRegresiva(Date.parse(lic.cierraEn) - ahora) : 'Compra cerrada'}</strong>
    </div>
  );
}

/** Locales que llevan este producto. */
const conProducto = (lic: LicitacionCanal, productoId: string, primero: string) =>
  lic.participantes.map(p => ({ negocioId: p.negocioId, cantidad: itemsDe(p, primero).find(i => i.productoId === productoId)?.cantidad ?? 0 }));

// ---------- Lista (C2) ----------

function ListaCompras({ lic, productos, guardado, abierta, cierre }: {
  lic: LicitacionCanal; productos: ProductoCanasta[]; guardado: Carrito; abierta: boolean; cierre: ReactNode;
}) {
  return (
    <>
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Compras en grupo</h1>
          <p className="bm-bajada">Cada producto baja de precio cuando el grupo junta más.</p>
        </div>
        {cierre}
      </header>
      <ul className="bm-tarjeta bm-lista">
        {productos.map(p => {
          const f = frasco(p.tramos, p.totalUnidades, p.siguienteTramo);
          const locales = conProducto(lic, p.id, productos[0].id).filter(x => x.cantidad > 0).length;
          const mio = guardado[p.id] ?? 0;
          return (
            <li key={p.id} className="bm-fila-compra">
              <span className="bm-icono-producto"><Icono nombre={iconoDeProducto(p.nombre)} tam={22} /></span>
              <div className="bm-fila-cuerpo">
                <div className="bm-fila-arriba">
                  <strong className="bm-fila-nombre">{p.nombre}</strong>
                  <span className="bm-precio">
                    {dinero(p.precioActual)}
                    {p.precioSolo > p.precioActual && <s>{dinero(p.precioSolo)}</s>}
                  </span>
                </div>
                <div className="bm-barra" role="progressbar" aria-valuemin={0} aria-valuemax={f.meta} aria-valuenow={p.totalUnidades}
                  aria-label={`${p.totalUnidades} de ${contar(f.meta, p.unidad, p.unidadPlural)}`}>
                  <span style={{ width: `${f.llenado * 100}%` }} />
                </div>
                <div className="bm-fila-abajo">
                  <span>{contar(locales, 'local', 'locales')} · {p.totalUnidades} de {contar(f.meta, p.unidad, p.unidadPlural)}</span>
                  {abierta && p.siguienteTramo && <span className="bm-ahorro">{pistaTramo(p.siguienteTramo, p)}</span>}
                </div>
              </div>
              <a className={`bm-boton${mio ? ' secundario' : ''}`} href={`#compra/${encodeURIComponent(p.id)}`}>
                {mio ? `Llevas ${mio}` : abierta ? 'Sumarme' : 'Ver'}
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------- Detalle (C3) ----------

function DetalleCompra({ api, token, foto, lic, p, orden, guardado, abierta, cierre }: {
  api: CanalApi; token: string; foto: FotoRed; lic: LicitacionCanal; p: ProductoCanasta; orden: string[];
  guardado: Carrito; abierta: boolean; cierre: ReactNode;
}) {
  const mio = guardado[p.id] ?? 0;
  // Crédito Bando: quien todavía no está en la compra y no tiene tarjeta, primero la inscribe (igual que el carrito).
  const falta = useFaltaTarjeta(api, token);
  const pideTarjeta = abierta && !Object.keys(guardado).length && falta === true;
  const [cantidad, setCantidad] = useState(mio || 1);
  const [listo, setListo] = useState(false);
  const { enviando, error, enviar } = useEnvio();
  // Lo guardado cambió (otra pestaña, WhatsApp o este mismo botón): el selector parte de ahí.
  useEffect(() => { if (mio) setCantidad(mio); }, [mio]);

  const vista = proyectar(p, cantidad - mio);
  const f = frasco(p.tramos, vista.unidades, vista.siguiente);
  const peldanos = escalera(p.tramos, vista.unidades);
  const proveedor = foto.negocios.find(n => n.id === lic.proveedorId);
  const notaProveedor = foto.notas.find(n => n.proveedorId === lic.proveedorId)?.nota;
  const locales = localesDelGrupo(conProducto(lic, p.id, orden[0]), foto.negocios);

  const guardar = (n: number) => enviar(async () => {
    await api.carrito(token, lic.id, aItems(fijar(guardado, p.id, n), orden));
    setListo(n > 0);
    if (n === 0) setCantidad(1);
  }, 'No pudimos guardar tu pedido. Inténtalo de nuevo.');

  const textoBoton = enviando ? 'Guardando...'
    : !mio ? `Sumarme con ${contar(cantidad, p.unidad, p.unidadPlural)}`
    : cantidad === mio ? `Vas con ${contar(mio, p.unidad, p.unidadPlural)}`
    : `Cambiar a ${contar(cantidad, p.unidad, p.unidadPlural)}`;
  const accion = (
    <button type="button" className="bm-boton bm-ancho" disabled={enviando || cantidad === mio} onClick={() => void guardar(cantidad)}>{textoBoton}</button>
  );

  return (
    <>
      <header className="bm-cabecera">
        <div>
          <a className="bm-miga" href="#compra">Compras en grupo › {p.nombre}</a>
          <h1 className="bm-titulo">{p.nombre}</h1>
          <p className="bm-bajada">
            {proveedor
              ? <>{proveedor.nombre}{notaProveedor !== undefined && <strong> ★ {nota(notaProveedor)}</strong>}</>
              : 'Los proveedores compiten por darle el mejor precio al grupo'}
          </p>
        </div>
        {cierre}
      </header>

      {listo && mio > 0 && (
        <div className="bm-listo" role="status">
          <img src={ABEJA.celebra} alt="" />
          <div>
            <strong>Te sumaste. Ya van {vista.unidades} de {contar(f.meta, p.unidad, p.unidadPlural)}.</strong>
            <span>{vista.siguiente ? `${pistaTramo(vista.siguiente, p)}. Te avisamos por WhatsApp.` : 'Ya tienen el mejor precio.'}</span>
          </div>
        </div>
      )}

      <div className="bm-detalle">
        <section className="bm-tarjeta bm-tramos" aria-label="Precios por volumen">
          <div className="bm-frasco" role="img" aria-label={`${vista.unidades} de ${contar(f.meta, p.unidad, p.unidadPlural)}`}>
            <span className="bm-miel" style={{ height: `${f.llenado * 100}%` }} />
            {f.marcas.map(m => <span key={m} className="bm-marca-tramo" style={{ bottom: `${m * 100}%` }} />)}
            <span className="bm-frasco-cifra"><strong>{vista.unidades}</strong>de {contar(f.meta, p.unidad, p.unidadPlural)}</span>
          </div>
          <ol className="bm-escalera">
            {peldanos.map(t => (
              <li key={t.desde} className={`bm-peldano ${t.estado}`}>
                <div>
                  <span className="bm-peldano-rango">
                    {rango(t, p)}{t.estado === 'siguiente' ? ' · siguiente tramo' : t.estado === 'actual' ? ' · precio de hoy' : ''}
                  </span>
                  {t.estado === 'siguiente' && vista.siguiente && <strong>{faltan(vista.siguiente, p)}</strong>}
                  {t.estado === 'actual' && <strong>Todos pagan esto</strong>}
                </div>
                <span className="bm-peldano-precio">{dinero(t.estado === 'actual' ? vista.precio : t.precio)}</span>
              </li>
            ))}
            {p.precioSolo > Math.max(0, ...p.tramos.map(t => t.precioUnitario)) && (
              <li className="bm-peldano superado">
                <div><span className="bm-peldano-rango">Comprando solo</span></div>
                <span className="bm-peldano-precio">{dinero(p.precioSolo)}</span>
              </li>
            )}
          </ol>
        </section>

        <div className="bm-columna">
          <section className="bm-tarjeta bm-sumarme">
            <h2>{abierta ? 'Súmate a la compra' : 'La compra cerró'}</h2>
            {pideTarjeta ? (
              <div className="puente-legado"><PedirTarjeta token={token} /></div>
            ) : abierta ? (
              <>
                <div className="bm-fila-cantidad">
                  <span>{p.unidadPlural[0].toUpperCase() + p.unidadPlural.slice(1)}</span>
                  <div className="bm-selector" role="group" aria-label={`Cantidad de ${p.unidadPlural}`}>
                    <button type="button" onClick={() => setCantidad(n => Math.max(mio ? 0 : 1, n - 1))} disabled={cantidad <= (mio ? 0 : 1)} aria-label={`${una(p)} menos`}>−</button>
                    <output aria-live="polite">{cantidad}</output>
                    <button type="button" onClick={() => setCantidad(n => Math.min(CANTIDAD_MAXIMA, n + 1))} disabled={cantidad >= CANTIDAD_MAXIMA} aria-label={`${una(p)} más`}>+</button>
                  </div>
                </div>
                <dl className="bm-cuenta">
                  <div><dt>{cantidad} × {dinero(vista.precio)}</dt><dd>{dinero(cantidad * vista.precio)}</dd></div>
                  {p.precioSolo > vista.precio && cantidad > 0 && (
                    <div><dt>Ahorras vs comprar solo</dt><dd className="bm-ahorro">{dinero(cantidad * (p.precioSolo - vista.precio))}</dd></div>
                  )}
                  <div className="bm-total"><dt>Total neto</dt><dd>{dinero(cantidad * vista.precio)}</dd></div>
                </dl>
                {siLlegan(vista.siguiente, cantidad, p) && (
                  <p className="bm-nota">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8M14 7h7v7" /></svg>
                    {siLlegan(vista.siguiente, cantidad, p)} Todos pagan el precio final.
                  </p>
                )}
                {error && <p className="bm-error" role="alert">{error}</p>}
                <div className="bm-accion-fija">{accion}</div>
                {mio > 0 && (
                  <button type="button" className="bm-boton-texto" onClick={() => void guardar(0)} disabled={enviando}>Quitar este producto</button>
                )}
                <p className="bm-pie">Al cerrar, tu factura del SII sale a tu RUT con el precio final.</p>
              </>
            ) : (
              <p className="bm-bajada">{mio ? `Cerró con ${contar(mio, p.unidad, p.unidadPlural)} tuyas a ${dinero(p.precioActual)} cada una. Tu pedido está en Pedidos.` : `Cerró a ${dinero(p.precioActual)} por ${p.unidad}.`}</p>
            )}
          </section>

          {locales && (
            <section className="bm-tarjeta bm-locales">
              <span className="bm-avatares" aria-hidden="true"><span /><span /><span /></span>
              <p>{locales} · <strong>nombres ocultos</strong></p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
