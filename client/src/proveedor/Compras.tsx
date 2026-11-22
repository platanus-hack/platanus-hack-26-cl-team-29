// "Pedidos en grupo" del proveedor (para el comprador son sus "compras en grupo"): todas las compras abiertas sin proveedor fijo (las inician los compradores) y, en
// Cerradas, las que ganó o perdió. Cada una abre su detalle (DESIGN.md, Paper "C3"): a la izquierda el frasco y la
// escalera que ve el comprador; a la derecha su oferta (su precio para el volumen del grupo, si va ganando y "Mejorar mi
// oferta"), el ranking de ofertas y los locales que van. Su lista entra sola; a mano la mejora o la pone si no estaba.
// Todo se recalcula con cada `red:evento`.

import { useState, type FormEvent } from 'react';
import { dinero, nota } from '../../../shared/formato.ts';
import { errorDeTramos, precioDeOferta, type Tramo } from '../../../shared/precios.ts';
import { contar } from '../../../shared/texto.ts';
import { itemsDe, productosDe } from '../canal/carrito.ts';
import { Campo } from '../canal/Acceso.tsx';
import { estaAbierta } from '../canal/logica.ts';
import { useEnvio } from '../canal/piezas.tsx';
import type { FotoRed, LicitacionCanal, YoProveedor } from '../canal/tipos.ts';
import { Cierre, LocalesDelGrupo } from '../comprador/ComprasEnGrupo.tsx';
import { localesDelGrupo } from '../comprador/compra.ts';
import { Pestanas } from '../comprador/Pestanas.tsx';
import { ProgresoCompra } from '../comprador/ProgresoCompra.tsx';
import { cuentaRegresiva } from '../red/formato.ts';
import type { Oferta, ProductoCompra } from '../red/tipos.ts';
import { useAhora } from '../red/useRed.ts';
import { FilaProducto } from './FilaProducto.tsx';
import { AccionesTramos, aFilas, aTramos, TablaTramos, useTramos } from './tramos.tsx';
import type { PropsAccion } from './Ventas.tsx';

interface Fila { lic: LicitacionCanal; p: ProductoCompra; mia?: Oferta }

export const enlaceCompraProveedor = (licitacionId: string, productoId: string) =>
  `#compras/${encodeURIComponent(licitacionId)}/${encodeURIComponent(productoId)}`;

/** Lo que pasa con su oferta en una compra: va ganando, por cuánto le ganan o cómo terminó. */
function estadoDe({ lic, p, mia }: Fila, ahora: number): { texto: string; tono: string } {
  const unidades = p.totalUnidades ?? 0;
  if (!estaAbierta(lic, ahora)) {
    if (mia && p.ganadora?.proveedorId === mia.proveedorId) return { texto: 'Ganaste', tono: 'listo' };
    return { texto: p.ganadora ? `Ganó otro a ${dinero(p.ganadora.precioUnitario)}` : 'Cerró sin ganador', tono: 'neutro' };
  }
  // Con proveedor fijo (solo llegan aquí las de este proveedor), la compra ya es suya: no compite, la abastece.
  if (lic.proveedorId) return { texto: 'Tú la abasteces', tono: 'listo' };
  if (!mia) return { texto: 'No compites', tono: 'neutro' };
  const suya = precioDeOferta(mia, unidades);
  const mejor = Math.min(...(p.ofertas ?? []).map(o => precioDeOferta(o, unidades)));
  return suya <= mejor ? { texto: 'Vas ganando', tono: 'listo' } : { texto: `Te ganan por ${dinero(suya - mejor)}`, tono: 'accion' };
}

export function Compras({ foto, yo, ruta, ...props }: PropsAccion & { foto: FotoRed; yo: YoProveedor; ruta: readonly string[] }) {
  const ahora = useAhora();
  const [pestana, setPestana] = useState<'abiertas' | 'cerradas'>('abiertas');
  // Las compras abiertas a todos y las que abastece este proveedor (la de la demo tiene proveedor fijo): antes la suya
  // no aparecía y la lista decía "no hay pedidos" justo encima de la compra en curso.
  const esMio = (id?: string) => !id || id === yo.proveedor.id;
  const filas: Fila[] = foto.licitaciones.filter(l => esMio(l.proveedorId)).flatMap(lic => (lic.productos ?? []).filter(p => esMio(p.proveedorId)).map(p => {
    const mia = p.ofertas?.find(o => o.proveedorId === yo.proveedor.id);
    return { lic, p, ...(mia ? { mia } : {}) };
  }));
  const [licId, productoId] = ruta.map(decodeURIComponent);
  const elegida = filas.find(f => f.lic.id === licId && f.p.id === productoId);
  if (elegida) return <DetalleCompra {...props} foto={foto} fila={elegida} ahora={ahora} />;

  const abiertas = filas.filter(f => estaAbierta(f.lic, ahora)).sort((a, b) => Number(!!b.mia) - Number(!!a.mia));
  const cerradas = filas.filter(f => !estaAbierta(f.lic, ahora) && f.mia).reverse();
  const lista = pestana === 'abiertas' ? abiertas : cerradas;

  return (
    <div className="bp-pagina">
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Pedidos en grupo</h1>
          <p className="bm-bajada">Lo que están comprando en grupo los negocios. Con lo que tienes en tu lista compites solo; al cerrar gana el mejor precio para el grupo.</p>
        </div>
      </header>
      <Pestanas etiqueta="Pedidos en grupo" activa={pestana} onCambio={setPestana}
        pestanas={[['abiertas', 'Abiertas', abiertas.length], ['cerradas', 'Cerradas', cerradas.length]]} />
      {!lista.length ? (
        <p className="bp-nada">
          {pestana === 'abiertas' ? 'No hay pedidos en grupo abiertos ahora. Cuando un negocio inicie uno, aparece aquí.' : 'Aquí quedan los pedidos en grupo en que competiste: los que ganaste y los que no.'}
        </p>
      ) : (
        <ul className="bm-tarjeta bp-filas">
          {lista.map(f => {
            const estado = estadoDe(f, ahora);
            const locales = f.lic.participantes.filter(x => x.cantidad > 0).length;
            const unidades = f.p.totalUnidades ?? 0;
            return (
              <FilaProducto key={`${f.lic.id}-${f.p.id}`} nombre={f.p.nombre} acciones={<>
                <span className={`bp-estado ${estado.tono}`}>{estado.texto}</span>
                <a className="bm-boton secundario" href={enlaceCompraProveedor(f.lic.id, f.p.id)}>Ver</a>
              </>}>
                <span>
                  {contar(locales, 'local', 'locales')} · {contar(unidades, f.p.unidad, f.p.unidadPlural)}
                  {estaAbierta(f.lic, ahora) ? ` · cierra en ${cuentaRegresiva(Date.parse(f.lic.cierraEn) - ahora)}` : ''}
                </span>
                {f.mia && <span>Tu precio a este volumen: <strong>{dinero(precioDeOferta(f.mia, unidades))}</strong>{f.mia.automatica ? ' (desde tu lista)' : ''}</span>}
              </FilaProducto>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DetalleCompra({ api, token, alCambiar, foto, fila, ahora }: PropsAccion & { foto: FotoRed; fila: Fila; ahora: number }) {
  const { lic, p, mia } = fila;
  const [ofertando, setOfertando] = useState(false);
  const productos = productosDe(lic);
  const visto = productos.find(x => x.id === p.id)!;
  const abierta = estaAbierta(lic, ahora);
  const unidades = visto.totalUnidades;
  const estado = estadoDe(fila, ahora);
  const ranking = [...(p.ofertas ?? [])].sort((a, b) => precioDeOferta(a, unidades) - precioDeOferta(b, unidades));
  const nombreDe = (id: string) => foto.negocios.find(n => n.id === id)?.nombre ?? 'Proveedor';
  const notaDe = (id: string) => foto.notas.find(n => n.proveedorId === id)?.nota;
  const conProducto = lic.participantes.map(x => ({ negocioId: x.negocioId, cantidad: itemsDe(x, productos[0].id).find(i => i.productoId === p.id)?.cantidad ?? 0 }));
  const locales = localesDelGrupo(conProducto, foto.negocios);
  const faltaMinimo = mia?.minimo && unidades < mia.minimo ? mia.minimo - unidades : 0;

  return (
    <div className="bp-pagina">
      <header className="bm-cabecera">
        <div>
          <a className="bm-miga" href="#compras">Pedidos en grupo › {p.nombre}</a>
          <h1 className="bm-titulo">{p.nombre}</h1>
          <p className="bm-bajada">{abierta ? 'Los negocios se suman y el precio baja con el volumen. Gana el mejor precio para todo el grupo.' : 'Este pedido en grupo ya cerró.'}</p>
        </div>
        <Cierre lic={lic} abierta={abierta} ahora={ahora} />
      </header>

      <div className="bm-detalle">
        <ProgresoCompra p={visto} vista={{ unidades, precio: visto.precioActual, siguiente: visto.siguienteTramo }} />

        <div className="bm-columna">
          <section className="bm-tarjeta bm-sumarme">
            <h2>Tu oferta</h2>
            {mia ? (
              <dl className="bm-cuenta">
                <div><dt>Tu precio con {contar(unidades, p.unidad, p.unidadPlural)}</dt><dd>{dinero(precioDeOferta(mia, unidades))}</dd></div>
                {mia.minimo ? <div><dt>Tu pedido mínimo</dt><dd>{contar(mia.minimo, p.unidad, p.unidadPlural)}</dd></div> : null}
                <div><dt><span className={`bp-estado ${estado.tono}`}>{estado.texto}</span></dt><dd>{mia.automatica ? 'Desde tu lista' : 'A mano'}</dd></div>
              </dl>
            ) : <p className="bm-bajada">{abierta ? 'Todavía no compites en este pedido. Pon tu precio por cantidad y entras.' : 'No ofertaste en este pedido.'}</p>}
            {abierta && faltaMinimo > 0 && (
              <p className="bm-nota">Al grupo le faltan {contar(faltaMinimo, p.unidad, p.unidadPlural)} para tu mínimo. Si gana tu oferta y no llegan, puedes cancelar el pedido.</p>
            )}
            {abierta && !ofertando && (
              <button type="button" className="bm-boton bm-ancho" onClick={() => setOfertando(true)}>{mia ? 'Mejorar mi oferta' : 'Ofertar'}</button>
            )}
            {ofertando && (
              <MejorarOferta api={api} token={token} lic={lic} p={p} minimo={mia?.minimo}
                inicial={mia?.tramos?.length ? mia.tramos : [{ desde: 1, precioUnitario: mia?.precioUnitario ?? 0 }]}
                onListo={() => { setOfertando(false); alCambiar(); }} onCancelar={() => setOfertando(false)} />
            )}
          </section>

          {ranking.length > 0 && (
            <section className="bm-tarjeta bp-bloque">
              <header className="bp-bloque-cabecera"><h2>Ofertas</h2><span>con {contar(unidades, p.unidad, p.unidadPlural)}</span></header>
              <ol className="bp-filas bp-ranking">
                {ranking.map((o, i) => {
                  const n = notaDe(o.proveedorId);
                  const mio = o.proveedorId === mia?.proveedorId;
                  return (
                    <li key={o.proveedorId} className={`bp-fila${mio ? ' mia' : ''}`}>
                      <span className="bp-fila-icono">{i + 1}</span>
                      <div className="bp-fila-texto">
                        <strong>{mio ? 'Tú' : nombreDe(o.proveedorId)}</strong>
                        <span>{n !== undefined ? `★ ${nota(n)}` : 'Sin nota todavía'}{o.minimo ? ` · mínimo ${o.minimo}` : ''}{o.automatica ? ' · desde su lista' : ''}</span>
                      </div>
                      <span className="bp-monto">{dinero(precioDeOferta(o, unidades))}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <LocalesDelGrupo texto={locales} />
        </div>
      </div>
    </div>
  );
}

function MejorarOferta({ api, token, lic, p, inicial, minimo: minimoInicial, onListo, onCancelar }: Pick<PropsAccion, 'api' | 'token'> & {
  lic: LicitacionCanal; p: ProductoCompra; inicial: Tramo[]; minimo?: number; onListo: () => void; onCancelar: () => void;
}) {
  const t = useTramos(aFilas(inicial).map(f => (f.precio === '0' ? { ...f, precio: '' } : f)));
  const [minimo, setMinimo] = useState(minimoInicial ? String(minimoInicial) : '');
  const { enviando, error, enviar } = useEnvio();
  const problema = errorDeTramos(aTramos(t.filas));
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    if (problema) return;
    void enviar(async () => {
      await api.ofertar(token, lic.id, p.id, aTramos(t.filas), Number(minimo) || undefined);
      onListo();
    }, 'No pudimos guardar tu oferta. Inténtalo de nuevo.');
  };
  return (
    <form className="bp-mejorar" onSubmit={guardar}>
      <TablaTramos t={t} unidad={p.unidad} unidades={p.unidadPlural} />
      <Campo etiqueta={`Pedido mínimo del grupo (opcional, en ${p.unidadPlural})`}>
        <input inputMode="numeric" value={minimo} onChange={e => setMinimo(e.target.value.replace(/\D/g, ''))} placeholder="Sin mínimo" />
      </Campo>
      {error && <p className="bm-error" role="alert">{error}</p>}
      <div className="bp-acciones">
        <button className="bm-boton" disabled={enviando || !!problema}>{enviando ? 'Guardando...' : 'Guardar mi oferta'}</button>
        <AccionesTramos t={t} />
        <button type="button" className="bm-boton-texto" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
