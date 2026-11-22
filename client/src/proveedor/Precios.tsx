// Precios por volumen del proveedor (DESIGN.md, Paper "P3"): abrir una compra en grupo con su producto o sumarlo a
// la abierta (lo mismo que "vendo ..." por WhatsApp) y cada producto con sus tramos y la barra que ve el comprador. El dueño de
// un producto cambia sus tramos mientras la compra está abierta.

import { useState, type FormEvent } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { duenoDeTramos, errorDeTramos, MAX_TRAMOS, precioPorVolumen, tramosAutomaticos } from '../../../shared/precios.ts';
import { contar, pluralDe } from '../../../shared/texto.ts';
import { estadoTramos, licitacionDeProducto, nombreCorto, type EstadoTramos } from '../red/derivar.ts';
import { useAhora } from '../red/useRed.ts';
import type { Licitacion, ProductoCompra } from '../red/tipos.ts';
import { Icono, iconoDeProducto } from '../canal/iconos.tsx';
import { estaAbierta } from '../canal/logica.ts';
import { Campo } from '../canal/Acceso.tsx';
import { useEnvio } from '../canal/piezas.tsx';
import type { LicitacionCanal, Tramo, YoProveedor } from '../canal/tipos.ts';
import type { PropsAccion } from './Ventas.tsx';
import { largoDeBarras } from './pedidos.ts';

export function Precios({ lic, yo, ...props }: PropsAccion & { lic?: LicitacionCanal; yo: YoProveedor }) {
  const ahora = useAhora();
  const red = lic as unknown as Licitacion | undefined;
  const productos = (red?.productos ?? []).filter(p => p.tramos.length);
  const abierta = !!lic && estaAbierta(lic, ahora);
  return (
    <div className="bp-pagina">
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Precios por volumen</h1>
          <p className="bm-bajada">Más unidades en una compra, menos precio para todos los que se suman. Quien ya se sumó nunca paga más.</p>
        </div>
      </header>
      <SumarProducto {...props} lic={lic && abierta ? lic : undefined} />
      {!lic || !productos.length ? (
        <p className="bp-nada">Cuando haya una compra en grupo abierta, aquí ves sus tramos y cambias los de lo que vendes.</p>
      ) : productos.map(p => (
        <TramosDeProducto key={p.id} {...props} lic={lic} producto={p} estado={estadoTramos(licitacionDeProducto(red!, p.id))}
          editable={abierta && duenoDeTramos(p, lic) === yo.proveedor?.id} />
      ))}
    </div>
  );
}

/** Cuánto dura una compra en grupo nueva. */
const DURACIONES = [{ minutos: 15, texto: '15 minutos' }, { minutos: 60, texto: '1 hora' }, { minutos: 24 * 60, texto: '1 día' }];

/**
 * Un producto suyo a la compra en grupo: nombre, unidad y precio de comprar solo; los tramos salen solos del precio.
 * Si hay una abierta se suma a ella; si no, abre una nueva con ese producto.
 */
function SumarProducto({ api, token, alCambiar, lic }: PropsAccion & { lic?: LicitacionCanal }) {
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [minutos, setMinutos] = useState(60);
  const [listo, setListo] = useState('');
  const { enviando, error, enviar } = useEnvio();
  const monto = Number(precio);
  const completo = nombre.trim().length >= 3 && !!unidad.trim() && monto > 0;
  const plural = pluralDe(unidad.trim().toLowerCase() || 'unidad');
  const sumar = (e: FormEvent) => {
    e.preventDefault();
    if (!completo) return;
    const producto = { nombre: nombre.trim(), unidad: unidad.trim(), precio: monto };
    void enviar(async () => {
      await (lic ? api.sumarProducto(token, lic.id, producto) : api.abrirCompra(token, { ...producto, minutos }));
      setListo(lic ? `${producto.nombre} ya está en la compra en grupo. Abajo puedes ajustar sus tramos.`
        : `Abriste una compra en grupo con ${producto.nombre}. Les avisamos a los negocios de la red.`);
      setNombre(''); setUnidad(''); setPrecio('');
      alCambiar();
    }, lic ? 'No pudimos sumar el producto. Inténtalo de nuevo.' : 'No pudimos abrir la compra. Inténtalo de nuevo.');
  };
  return (
    <form className="bm-tarjeta bp-bloque" onSubmit={sumar}>
      <header className="bp-bloque-cabecera">
        <h2>{lic ? 'Sumar un producto a la compra en grupo' : 'Abrir una compra en grupo'}</h2>
        {!lic && <span>No hay una abierta</span>}
      </header>
      <div className={`bp-sumar${lic ? '' : ' con-duracion'}`}>
        <Campo etiqueta="Producto"><input value={nombre} onChange={e => { setNombre(e.target.value); setListo(''); }} placeholder="Café molido 1 kg" maxLength={60} /></Campo>
        <Campo etiqueta="Se vende por"><input value={unidad} onChange={e => setUnidad(e.target.value)} placeholder="bolsa" maxLength={20} /></Campo>
        <Campo etiqueta="Precio comprando solo">
          <input inputMode="numeric" value={precio ? dinero(monto) : ''} onChange={e => setPrecio(e.target.value.replace(/\D/g, ''))} placeholder="$12.000" />
        </Campo>
        {!lic && (
          <Campo etiqueta="Cierra en">
            <select value={minutos} onChange={e => setMinutos(Number(e.target.value))}>
              {DURACIONES.map(d => <option key={d.minutos} value={d.minutos}>{d.texto}</option>)}
            </select>
          </Campo>
        )}
      </div>
      {monto > 0 && (
        <p className="bm-bajada bp-margen">
          Tramos de partida: {tramosAutomaticos(monto).filter(t => t.desde > 1).map(t => `${t.desde} ${plural} o más a ${dinero(t.precioUnitario)}`).join(', ')}.
        </p>
      )}
      {(error || listo) && <p className={`bp-margen ${error ? 'bm-error' : 'bm-ahorro'}`} role="status">{error || listo}</p>}
      <div className="bp-acciones">
        <button className="bm-boton" disabled={!completo || enviando}>
          {enviando ? (lic ? 'Sumando...' : 'Abriendo...') : lic ? 'Sumar a la compra' : 'Abrir la compra en grupo'}
        </button>
      </div>
    </form>
  );
}

type FilaTramo = { desde: string; precio: string };
const aFilas = (tramos: readonly Tramo[]): FilaTramo[] => tramos.map(t => ({ desde: String(t.desde), precio: String(t.precioUnitario) }));
const aTramos = (filas: readonly FilaTramo[]): Tramo[] => filas.map(f => ({ desde: Number(f.desde), precioUnitario: Number(f.precio.replace(/\D/g, '')) }));

function TramosDeProducto({ api, token, alCambiar, lic, producto, estado, editable }: PropsAccion & {
  lic: LicitacionCanal; producto: ProductoCompra; estado: EstadoTramos; editable: boolean;
}) {
  const [filas, setFilas] = useState<FilaTramo[] | null>(null);
  const { enviando, error, enviar } = useEnvio();
  const tramos = filas ? aTramos(filas) : estado.tramos;
  const problema = filas && errorDeTramos(tramos, { unidades: estado.totalUnidades, precio: precioPorVolumen(producto, estado.totalUnidades) });
  const barras = largoDeBarras(tramos.map(t => t.precioUnitario));
  const cambiar = (i: number, campo: keyof FilaTramo, valor: string) => setFilas(f => f!.map((x, k) => (k === i ? { ...x, [campo]: valor.replace(/\D/g, '') } : x)));
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    if (!filas || problema) return;
    void enviar(async () => {
      await api.fijarTramos(token, lic.id, producto.id, tramos);
      setFilas(null);
      alCambiar();
    }, 'No pudimos guardar los tramos. Inténtalo de nuevo.');
  };
  const agregar = () => {
    const ultimo = tramos.at(-1)!;
    setFilas([...filas!, { desde: String(ultimo.desde * 2), precio: String(ultimo.precioUnitario) }]);
  };

  return (
    <form className="bm-tarjeta bp-bloque" onSubmit={guardar}>
      <header className="bp-bloque-cabecera">
        <h2 className="bp-con-sii"><Icono nombre={iconoDeProducto(producto.nombre)} tam={22} />{nombreCorto(producto.nombre, producto.unidad)}</h2>
        <span>{contar(estado.totalUnidades, producto.unidad, producto.unidadPlural)} en el grupo</span>
      </header>
      <div className="bp-tramos" role="table" aria-label={`Tramos de ${producto.nombre}`}>
        <div className="bp-tramo bp-tramo-titulos" role="row">
          <span role="columnheader">Desde</span><span role="columnheader">Precio por {producto.unidad}</span><span role="columnheader" className="bp-solo-ancho">Lo que ve el comprador</span>
        </div>
        {tramos.map((t, i) => {
          const actual = !filas && i === estado.alcanzados - 1;
          return (
            <div key={i} role="row" className={`bp-tramo${actual ? ' actual' : ''}`}>
              {filas ? (
                <>
                  <input aria-label={`Tramo ${i + 1}: desde cuántas ${producto.unidadPlural}`} inputMode="numeric" value={filas[i].desde} disabled={i === 0} onChange={e => cambiar(i, 'desde', e.target.value)} />
                  <input aria-label={`Tramo ${i + 1}: precio por ${producto.unidad}`} inputMode="numeric" value={filas[i].precio ? dinero(Number(filas[i].precio)) : ''} onChange={e => cambiar(i, 'precio', e.target.value)} />
                </>
              ) : (
                <>
                  <span role="cell">{contar(t.desde, producto.unidad, producto.unidadPlural)}</span>
                  <span role="cell" className="bp-monto">{dinero(t.precioUnitario)}{actual && <em> · hoy</em>}</span>
                </>
              )}
              <span role="cell" className="bp-barra" aria-hidden="true"><i style={{ width: `${barras[i] * 100}%` }} /></span>
              {filas && i > 0 && <button type="button" className="bm-boton-texto" aria-label={`Quitar el tramo ${i + 1}`} onClick={() => setFilas(filas.filter((_, k) => k !== i))}>Quitar</button>}
            </div>
          );
        })}
      </div>
      {(problema || error) && <p className="bm-error bp-margen">{problema ? `${problema}.` : error}</p>}
      {editable && (
        <div className="bp-acciones">
          {!filas ? <button type="button" className="bm-boton secundario" onClick={() => setFilas(aFilas(estado.tramos))}>Cambiar tramos</button> : (
            <>
              <button className="bm-boton" disabled={!!problema || enviando}>{enviando ? 'Guardando...' : 'Guardar'}</button>
              {filas.length < MAX_TRAMOS && <button type="button" className="bm-boton secundario" onClick={agregar}>Agregar tramo</button>}
              <button type="button" className="bm-boton-texto" onClick={() => setFilas(null)}>Cancelar</button>
            </>
          )}
        </div>
      )}
    </form>
  );
}
