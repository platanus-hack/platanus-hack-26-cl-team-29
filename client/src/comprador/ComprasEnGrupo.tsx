// Las compras en grupo del comprador con la marca Bando (Paper "C2" y "C3"): la lista de lo que se está comprando en
// grupo, en pestañas Abiertas y Cerradas, con un + para iniciar una; al entrar a un producto, el frasco que se llena, la
// escalera de tramos y "Sumarme con N". Puede haber varias abiertas (cada comprador inicia la suya). Todo se recalcula
// con cada `red:evento` (la foto llega nueva); mis cambios sin guardar ya mueven el precio y el frasco.

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { dinero, nota } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { nombreUnidad, pluralUnidad } from '../../../shared/unidades.ts';
import type { ProductoConocido } from '../../../shared/productos.ts';
import { SelectorProducto } from '../canal/CampoProducto.tsx';
import {
  aItems, carritoEnLaFoto, CANTIDAD_MAXIMA, desdeItems, fijar, itemsDe, productosDe, proyectar, una, type Carrito, type ProductoCanasta,
} from '../canal/carrito.ts';
import { Campo } from '../canal/Acceso.tsx';
import { Icono, iconoDeProducto } from '../canal/iconos.tsx';
import { estaAbierta, licitacionVigente } from '../canal/logica.ts';
import { Confirmar, useConfirmacion, useEnvio } from '../canal/piezas.tsx';
import { PedirTarjeta, useFaltaTarjeta } from '../canal/MiCredito.tsx';
import type { CanalApi } from '../canal/api.ts';
import type { FotoRed, LicitacionCanal, YoComprador } from '../canal/tipos.ts';
import { ABEJA, ILUSTRACION } from '../marca/recursos.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import { frasco, localesDelGrupo, siLlegan } from './compra.ts';
import { puedeCerrarAntes } from '../../../shared/precios.ts';
import { ProgresoCompra } from './ProgresoCompra.tsx';
import { Pestanas } from './Pestanas.tsx';
import { pistaTramo } from '../../../shared/precios.ts';

/** Qué muestra la sección: la lista, el formulario para iniciar una o un producto de una compra. */
export type RutaCompra = { vista: 'lista' } | { vista: 'nueva' } | { vista: 'producto'; licitacionId?: string; productoId: string };

/** `#compra`, `#compra/nueva`, `#compra/L-3/cafe` (o `#compra/cafe`, en la compra vigente). */
export function rutaDeCompra(partes: readonly string[]): RutaCompra {
  const [a, b] = partes.map(decodeURIComponent);
  if (a === 'nueva') return { vista: 'nueva' };
  if (a && b) return { vista: 'producto', licitacionId: a, productoId: b };
  return a ? { vista: 'producto', productoId: a } : { vista: 'lista' };
}

export const enlaceCompra = (licitacionId: string, productoId: string) => `#compra/${encodeURIComponent(licitacionId)}/${encodeURIComponent(productoId)}`;

interface Props {
  api: CanalApi;
  token: string;
  foto: FotoRed;
  yo: YoComprador;
  ruta: RutaCompra;
}

export function ComprasEnGrupo({ api, token, foto, yo, ruta }: Props) {
  const ahora = useAhora();
  if (ruta.vista === 'nueva') return <NuevaCompra api={api} token={token} />;
  if (ruta.vista === 'producto') {
    const lic = ruta.licitacionId ? foto.licitaciones.find(l => l.id === ruta.licitacionId) : licitacionVigente(foto.licitaciones);
    const productos = lic ? productosDe(lic) : [];
    const producto = productos.find(p => p.id === ruta.productoId);
    if (lic && producto) {
      const abierta = estaAbierta(lic, ahora);
      return (
        <DetalleCompra api={api} token={token} foto={foto} lic={lic} p={producto} orden={productos.map(x => x.id)}
          guardado={guardadoDe(lic, yo)} abierta={abierta} cierre={<Cierre lic={lic} abierta={abierta} ahora={ahora} />} yoId={yo.negocio.id} />
      );
    }
  }
  return <ListaCompras foto={foto} yo={yo} ahora={ahora} />;
}

const guardadoDe = (lic: LicitacionCanal, yo: YoComprador): Carrito =>
  carritoEnLaFoto(lic, yo.negocio.id) ?? desdeItems(yo.participaciones.find(p => p.licitacionId === lic.id)?.items ?? []);

export function Cierre({ lic, abierta, ahora }: { lic: LicitacionCanal; abierta: boolean; ahora: number }) {
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

/** Sin precio todavía: una solicitud sin referencia, antes de la primera oferta. */
const sinPrecio = (p: Pick<ProductoCanasta, 'precioActual'>) => !(p.precioActual > 0);

// ---------- Lista (C2) ----------

type Pestana = 'abiertas' | 'cerradas';

/** Una fila por producto de cada compra en grupo (`primero`: el primer producto de su canasta). */
export const filasDeCompras = (licitaciones: readonly LicitacionCanal[]) => licitaciones.flatMap(lic => {
  const productos = productosDe(lic);
  return productos.map(p => ({ lic, p, primero: productos[0].id }));
});
/** Las abiertas, la que cierra primero arriba. */
export const comprasAbiertas = <F extends { lic: LicitacionCanal }>(filas: readonly F[], ahora: number) =>
  filas.filter(f => estaAbierta(f.lic, ahora)).sort((a, b) => Date.parse(a.lic.cierraEn) - Date.parse(b.lic.cierraEn));

function ListaCompras({ foto, yo, ahora }: { foto: FotoRed; yo: YoComprador; ahora: number }) {
  const [pestana, setPestana] = useState<Pestana>('abiertas');
  const filas = filasDeCompras(foto.licitaciones);
  const abiertas = comprasAbiertas(filas, ahora);
  const cerradas = filas.filter(f => !estaAbierta(f.lic, ahora)).sort((a, b) => Date.parse(b.lic.cierraEn) - Date.parse(a.lic.cierraEn));
  const lista = pestana === 'abiertas' ? abiertas : cerradas;

  return (
    <>
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Compras en grupo</h1>
          <p className="bm-bajada">Mientras más negocios se suman, más baja el precio para todos.</p>
        </div>
        <a className="bm-boton bm-mas" href="#compra/nueva" aria-label="Iniciar una compra en grupo"><span aria-hidden="true">+</span></a>
      </header>

      <Pestanas etiqueta="Compras en grupo" activa={pestana} onCambio={setPestana}
        pestanas={[['abiertas', 'Abiertas', abiertas.length], ['cerradas', 'Cerradas', cerradas.length]]} />

      {!lista.length ? (
        <div className="bm-vacio">
          <img className="ilustracion" src={ILUSTRACION.equipo} alt="" />
          <h1>{pestana === 'abiertas' ? 'No hay compras en grupo abiertas' : 'Todavía no hay compras cerradas'}</h1>
          <p>{pestana === 'abiertas' ? 'Inicia una con + y los negocios de la red se suman.' : 'Cuando una compra cierre, aquí ves a qué precio quedó.'}</p>
        </div>
      ) : (
        <ul className="bm-tarjeta bm-lista">
          {lista.map(({ lic, p, primero }) => <FilaCompraEnGrupo key={`${lic.id}-${p.id}`} lic={lic} p={p} primero={primero} yo={yo} ahora={ahora} abierta={pestana === 'abiertas'} />)}
        </ul>
      )}
    </>
  );
}

/** Una compra en grupo en la lista (y en la portada): producto, precio de hoy contra comprar solo, avance y "Sumarme". */
export function FilaCompraEnGrupo({ lic, p, primero, yo, ahora, abierta }: {
  lic: LicitacionCanal; p: ProductoCanasta; primero: string; yo: YoComprador; ahora: number; abierta: boolean;
}) {
  const f = frasco(p.tramos, p.totalUnidades, p.siguienteTramo);
  const locales = conProducto(lic, p.id, primero).filter(x => x.cantidad > 0).length;
  const mio = guardadoDe(lic, yo)[p.id] ?? 0;
  return (
    <li className="bm-fila-compra">
      <span className="bm-icono-producto"><Icono nombre={iconoDeProducto(p.nombre)} tam={22} /></span>
      <div className="bm-fila-cuerpo">
        <div className="bm-fila-arriba">
          <strong className="bm-fila-nombre">{p.nombre}</strong>
          <span className="bm-precio">
            {sinPrecio(p) ? 'Esperando ofertas' : dinero(p.precioActual)}
            {!sinPrecio(p) && p.precioSolo > p.precioActual && <s>{dinero(p.precioSolo)}</s>}
          </span>
        </div>
        {p.tramos.length > 0 && (
          <div className="bm-barra" role="progressbar" aria-valuemin={0} aria-valuemax={f.meta} aria-valuenow={p.totalUnidades}
            aria-label={`${p.totalUnidades} de ${contar(f.meta, p.unidad, p.unidadPlural)}`}>
            <span style={{ width: `${f.llenado * 100}%` }} />
          </div>
        )}
        <div className="bm-fila-abajo">
          <span>
            {contar(locales, 'local', 'locales')} · {contar(p.totalUnidades, p.unidad, p.unidadPlural)}
            {abierta ? ` · cierra en ${cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}` : ''}
          </span>
          {abierta && p.minimo && p.totalUnidades < p.minimo
            ? <span className="bm-falta-minimo">Mínimo del proveedor: {contar(p.minimo, p.unidad, p.unidadPlural)}</span>
            : abierta && p.siguienteTramo && <span className="bm-ahorro">{pistaTramo(p.siguienteTramo, p)}</span>}
        </div>
      </div>
      <a className={`bm-boton${mio ? ' secundario' : ''}`} href={enlaceCompra(lic.id, p.id)}>
        {mio ? `Llevas ${mio}` : abierta ? 'Sumarme' : 'Ver'}
      </a>
    </li>
  );
}

// ---------- Iniciar una compra ----------

const DURACIONES = [{ minutos: 60, texto: '1 hora' }, { minutos: 24 * 60, texto: '1 día' }, { minutos: 3 * 24 * 60, texto: '3 días' }];

/** Iniciar una compra en grupo: qué producto, cuánto necesita, lo que paga hoy (opcional) y cuándo cierra. */
function NuevaCompra({ api, token }: { api: CanalApi; token: string }) {
  const [producto, setProducto] = useState<ProductoConocido | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [minutos, setMinutos] = useState(24 * 60);
  const { enviando, error, enviar } = useEnvio();
  const n = Number(cantidad);
  const completo = !!producto && n >= 1 && n <= CANTIDAD_MAXIMA;
  const unidad = producto?.unidad ?? 'unidad';
  const u = nombreUnidad(unidad);
  const iniciar = (e: FormEvent) => {
    e.preventDefault();
    if (!completo || !producto) return;
    void enviar(async () => {
      const r = await api.abrirSolicitud(token, { producto: producto.nombre, unidad, cantidad: n, minutos });
      location.hash = enlaceCompra(r.licitacionId, r.productoId).slice(1);
    }, 'No pudimos iniciar la compra. Inténtalo de nuevo.');
  };
  return (
    <>
      <header className="bm-cabecera">
        <div>
          <a className="bm-miga" href="#compra">Compras en grupo › Nueva</a>
          <h1 className="bm-titulo">Inicia una compra en grupo</h1>
          <p className="bm-bajada">Otros negocios se suman, los proveedores ofertan y al cerrar gana el mejor precio para todo el grupo.</p>
        </div>
      </header>
      <form className="bm-tarjeta bm-formulario bm-nueva" onSubmit={iniciar}>
        <SelectorProducto api={api} etiqueta="¿Qué quieres comprar?" elegido={producto} onElegir={setProducto} />
        <div className="bm-nueva-fila">
          <Campo etiqueta={`¿Cuántas ${pluralUnidad(unidad)} necesitas?`}>
            <input inputMode="numeric" value={cantidad} onChange={e => setCantidad(e.target.value.replace(/\D/g, ''))} placeholder="10" />
          </Campo>
          <Campo etiqueta="Cierra en">
            <select value={minutos} onChange={e => setMinutos(Number(e.target.value))}>
              {DURACIONES.map(d => <option key={d.minutos} value={d.minutos}>{d.texto}</option>)}
            </select>
          </Campo>
        </div>
        {producto && (
          <p className="bm-nota" role="status">
            {producto.precioBase
              ? <>Precio base desde <strong>{dinero(producto.precioBase)}</strong> por {u} en las listas de los proveedores.{producto.minimo ? <> Ese proveedor pide un mínimo de <strong>{contar(producto.minimo, u, pluralUnidad(unidad))}</strong> entre todo el grupo.</> : null} Con más volumen, baja.</>
              : 'Todavía ningún proveedor tiene precio para este producto: lo ponen al ofertar.'}
          </p>
        )}
        {error && <p className="bm-error" role="alert">{error}</p>}
        <button className="bm-boton bm-ancho" disabled={!completo || enviando}>{enviando ? 'Iniciando...' : 'Iniciar la compra en grupo'}</button>

      </form>
    </>
  );
}

// ---------- Detalle (C3) ----------

function DetalleCompra({ api, token, foto, lic, p, orden, guardado, abierta, cierre, yoId }: {
  api: CanalApi; token: string; foto: FotoRed; lic: LicitacionCanal; p: ProductoCanasta; orden: string[];
  guardado: Carrito; abierta: boolean; cierre: ReactNode;
  /** Mi negocio: si inicié esta compra, la puedo cerrar antes. */
  yoId: string;
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
          <img className="ilustracion" src={ABEJA.celebra} alt="" />
          <div>
            <strong>Te sumaste. Ya van {vista.unidades} de {contar(f.meta, p.unidad, p.unidadPlural)}.</strong>
            <span>{vista.siguiente ? `${pistaTramo(vista.siguiente, p)}. Te avisamos por WhatsApp.` : 'Ya tienen el mejor precio.'}</span>
          </div>
        </div>
      )}

      <div className="bm-detalle">
        <ProgresoCompra p={p} vista={vista} tuyas={Math.max(0, cantidad - mio)} />

        <div className="bm-columna">
          <section className="bm-tarjeta bm-sumarme">
            <h2>{abierta ? 'Súmate a la compra' : 'La compra cerró'}</h2>
            {pideTarjeta ? (
              <PedirTarjeta token={token} />
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
                {vista.precio > 0 ? (
                  <dl className="bm-cuenta">
                    <div><dt>{cantidad} × {dinero(vista.precio)}</dt><dd>{dinero(cantidad * vista.precio)}</dd></div>
                    {p.precioSolo > vista.precio && cantidad > 0 && (
                      <div><dt>Ahorras vs comprar solo</dt><dd className="bm-ahorro">{dinero(cantidad * (p.precioSolo - vista.precio))}</dd></div>
                    )}
                    <div className="bm-total"><dt>Total neto</dt><dd>{dinero(cantidad * vista.precio)}</dd></div>
                  </dl>
                ) : (
                  <p className="bm-nota">Todavía no hay ofertas: los proveedores ponen el precio. Al cerrar, pagas el mejor precio que consiga el grupo.</p>
                )}
                {siLlegan(vista.siguiente, cantidad, p) && (
                  <p className="bm-nota">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8M14 7h7v7" /></svg>
                    {siLlegan(vista.siguiente, cantidad, p)} Todos pagan el precio final.
                  </p>
                )}
                {p.quedan !== undefined && (
                  <p className="bm-nota bm-aviso-minimo">
                    {p.quedan > 0 ? `Quedan ${contar(p.quedan, p.unidad, p.unidadPlural)}: es todo el stock de los proveedores.` : 'Se acabó el stock de los proveedores.'}
                  </p>
                )}
                {p.minimo && vista.unidades < p.minimo && (
                  <p className="bm-nota bm-aviso-minimo">
                    El proveedor que hoy gana pide un mínimo de {contar(p.minimo, p.unidad, p.unidadPlural)}: si entre todos no llegan,
                    puede cancelar el pedido. Faltan {contar(p.minimo - vista.unidades, p.unidad, p.unidadPlural)}.
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
              <p className="bm-bajada">
                {sinPrecio(p) ? 'Cerró sin ofertas de proveedores.'
                  : mio ? `Cerró con ${contar(mio, p.unidad, p.unidadPlural)} tuyas a ${dinero(p.precioActual)} cada una. Tu pedido está en Pedidos.`
                  : `Cerró a ${dinero(p.precioActual)} por ${p.unidad}.`}
              </p>
            )}
          </section>

          {abierta && lic.iniciadaPor === yoId && <CerrarAntes api={api} token={token} lic={lic} p={p} />}
          <LocalesDelGrupo texto={locales} />
        </div>
      </div>
    </>
  );
}

/** "11 locales de Providencia y Ñuñoa · nombres ocultos" (nunca el nombre de otro comprador). Nada si no va nadie. */
export function LocalesDelGrupo({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <section className="bm-tarjeta bm-locales">
      <span className="bm-avatares" aria-hidden="true"><span /><span /><span /></span>
      <p>{texto} · <strong>nombres ocultos</strong></p>
    </section>
  );
}

/** Quien inició la compra la cierra antes de tiempo, cuando ya hay oferta y el grupo llegó al mínimo del que gana. */
function CerrarAntes({ api, token, lic, p }: { api: CanalApi; token: string; lic: LicitacionCanal; p: ProductoCanasta }) {
  const ofertas = lic.productos?.find(x => x.id === p.id)?.ofertas;
  const listo = puedeCerrarAntes(ofertas, p.totalUnidades);
  const faltanMinimo = p.minimo ? Math.max(0, p.minimo - p.totalUnidades) : 0;
  const ejecutar = useCallback(async () => { await api.cerrarSolicitud(token, lic.id); }, [api, token, lic.id]);
  const c = useConfirmacion(ejecutar);
  return (
    <section className="bm-tarjeta bm-cerrar-antes">
      <h2>Tú iniciaste esta compra</h2>
      {!listo ? (
        <p className="bm-bajada">
          {!ofertas?.length ? 'Podrás cerrarla antes cuando llegue la primera oferta de un proveedor.'
            : `Podrás cerrarla antes cuando el grupo llegue al mínimo del proveedor: faltan ${contar(faltanMinimo, p.unidad, p.unidadPlural)}.`}
        </p>
      ) : c.estado.fase === 'nada' ? (
        <>
          <p className="bm-bajada">Ya llegaron al mínimo. Puedes cerrarla ahora y el grupo paga {dinero(p.precioActual)} por {p.unidad}, sin esperar el cierre.</p>
          <button type="button" className="bm-boton secundario bm-ancho" onClick={() => c.pedir(undefined)}>Cerrar la compra ahora</button>
        </>
      ) : (
        <Confirmar titulo="¿Cierras la compra en grupo ahora?" si="Sí, cerrarla" {...c.panel}>
          <p>Nadie más podrá sumarse. Gana la mejor oferta, {dinero(p.precioActual)} por {p.unidad}, y queda una orden por local con su factura del SII.</p>
        </Confirmar>
      )}
    </section>
  );
}
