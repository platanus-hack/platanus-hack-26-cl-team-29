// "Tus productos" del proveedor (DESIGN.md, Paper "P4"): su lista de lo que vende, cada producto con su unidad, su
// precio base por unidad y cuánto baja por cantidad. Los tramos los escribe él (con una sugerencia a un toque). Debajo,
// lo que sale de sus facturas en el SII como sugerencia para agregar a la lista. Se actualiza en vivo con
// `catalogo.actualizado`.

import { useCallback, useState, type FormEvent } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { errorDeProductoEscrito, type CatalogoProveedor, type ProductoCatalogo } from '../../../shared/catalogo.ts';
import { MAX_TRAMOS, tramosAutomaticos } from '../../../shared/precios.ts';
import { contar, pluralDe, sinTildes } from '../../../shared/texto.ts';
import { Campo } from '../canal/Acceso.tsx';
import { Icono, iconoDeProducto, LogoSii } from '../canal/iconos.tsx';
import { useEnvio } from '../canal/piezas.tsx';
import type { LicitacionCanal } from '../canal/tipos.ts';
import { useDatoEnVivo } from '../canal/useCanal.ts';
import type { PropsAccion } from './Ventas.tsx';

/** Respaldo del evento mientras se arma desde las facturas (y lo único que tiene la red falsa del navegador). */
const POLEO_MS = 2000;
const VISIBLES_SUGERIDOS = 4;
const armando = (c: CatalogoProveedor) => c.estado === 'armando';

type Fila = { desde: string; precio: string };
interface Borrador { clave?: string; nombre: string; unidad: string; filas: Fila[] }

const NUEVO: Borrador = { nombre: '', unidad: '', filas: [{ desde: '1', precio: '' }] };
const aBorrador = (p: ProductoCatalogo, clave?: string): Borrador => ({
  ...(clave ? { clave } : {}), nombre: p.nombre, unidad: p.unidad,
  filas: p.tramos.map(t => ({ desde: String(t.desde), precio: String(t.precioUnitario) })),
});
const aTramos = (filas: readonly Fila[]) => filas.map(f => ({ desde: Number(f.desde), precioUnitario: Number(f.precio) }));
const soloDigitos = (v: string) => v.replace(/\D/g, '');

export function Productos({ api, token, alCambiar, abierta }: PropsAccion & { abierta?: LicitacionCanal }) {
  const cargar = useCallback(() => api.catalogo(token), [api, token]);
  const { dato: catalogo, error } = useDatoEnVivo(api, cargar, 'catalogo.actualizado', armando, POLEO_MS);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [todos, setTodos] = useState(false);

  const mios = catalogo?.productos.filter(p => p.manual) ?? [];
  const sugeridos = catalogo?.productos.filter(p => !p.manual) ?? [];
  const enLaCompra = new Set((abierta?.productos ?? []).map(p => sinTildes(p.nombre)));
  const editar = (b: Borrador) => { setBorrador(b); scrollTo({ top: 0 }); };

  return (
    <div className="bp-pagina">
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Tus productos</h1>
          <p className="bm-bajada">Tu precio base por unidad y cuánto baja según la cantidad. Con esto compites en las compras en grupo.</p>
        </div>
        <button type="button" className="bm-boton bp-mas" aria-label="Agregar un producto" onClick={() => editar(NUEVO)} disabled={!!borrador && !borrador.clave}>
          <span aria-hidden="true">+</span>
        </button>
      </header>

      {borrador && (
        <Editor key={borrador.clave ?? `nuevo-${borrador.nombre}`} api={api} token={token} inicial={borrador}
          otros={mios.filter(p => p.clave !== borrador.clave)} onListo={() => { setBorrador(null); alCambiar(); }} onCancelar={() => setBorrador(null)} />
      )}

      <section className="bm-tarjeta bp-bloque">
        <header className="bp-bloque-cabecera"><h2>Tu lista</h2>{mios.length > 0 && <span>{contar(mios.length, 'producto')}</span>}</header>
        {error && <p className="bm-error bp-margen">{error}</p>}
        {!catalogo ? <p className="bp-nada">Cargando tus productos...</p> : !mios.length ? (
          <p className="bp-nada">Todavía no tienes productos. Agrega el primero con + o desde las sugerencias de tus facturas.</p>
        ) : (
          <ul className="bp-filas">
            {mios.map(p => (
              <ProductoDeLista key={p.clave} api={api} token={token} producto={p} abierta={!!abierta} yaEsta={enLaCompra.has(sinTildes(p.nombre))}
                onEditar={() => editar(aBorrador(p, p.clave))} />
            ))}
          </ul>
        )}
      </section>

      {catalogo && (sugeridos.length > 0 || armando(catalogo)) && (
        <section className="bm-tarjeta bp-bloque" aria-busy={armando(catalogo)}>
          <header className="bp-bloque-cabecera">
            <h2 className="bp-con-sii"><LogoSii tam={16} />Sugeridos desde tus facturas</h2>
            {catalogo.origen === 'ejemplo' && <span>Historial de ejemplo</span>}
          </header>
          {armando(catalogo) ? <p className="bp-nada">Leyendo tus facturas en el SII...</p> : (
            <ul className="bp-filas">
              {(todos ? sugeridos : sugeridos.slice(0, VISIBLES_SUGERIDOS)).map(p => (
                <li key={p.clave} className="bp-fila">
                  <span className="bp-fila-icono"><Icono nombre={iconoDeProducto(p.nombre)} tam={22} /></span>
                  <div className="bp-fila-texto">
                    <strong>{p.nombre}</strong>
                    <span>{dinero(p.ultimoPrecio)} por {p.unidad} la última vez · {contar(p.ventas, 'venta')}</span>
                  </div>
                  <button type="button" className="bm-boton secundario" onClick={() => editar(aBorrador(p))}>Agregar</button>
                </li>
              ))}
            </ul>
          )}
          {sugeridos.length > VISIBLES_SUGERIDOS && (
            <div className="bp-acciones">
              <button type="button" className="bm-boton-texto" onClick={() => setTodos(t => !t)}>{todos ? 'Ver menos' : `Ver las ${sugeridos.length} sugerencias`}</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ProductoDeLista({ api, token, producto: p, abierta, yaEsta, onEditar }: {
  api: PropsAccion['api']; token: string; producto: ProductoCatalogo; abierta: boolean; yaEsta: boolean; onEditar: () => void;
}) {
  const { enviando, error, enviar } = useEnvio();
  const [base, ...porCantidad] = p.tramos;
  return (
    <li className="bp-fila bp-producto">
      <span className="bp-fila-icono"><Icono nombre={iconoDeProducto(p.nombre)} tam={22} /></span>
      <div className="bp-fila-texto">
        <strong>{p.nombre}</strong>
        <span>{dinero(base.precioUnitario)} por {p.unidad}</span>
        {porCantidad.length > 0 && (
          <ul className="bp-tramos-chicos" aria-label="Precio por cantidad">
            {porCantidad.map(t => <li key={t.desde}>desde {t.desde}: <strong>{dinero(t.precioUnitario)}</strong></li>)}
          </ul>
        )}
        {error && <span className="bm-error">{error}</span>}
      </div>
      <div className="bp-producto-acciones">
        {yaEsta ? <span className="bp-estado listo">En la compra</span> : abierta && (
          <button type="button" className="bm-boton secundario" disabled={enviando} onClick={() => enviar(() => api.sumarDelCatalogo(token, p.clave))}>
            {enviando ? 'Sumando...' : 'Sumar a la compra'}
          </button>
        )}
        <button type="button" className="bm-boton-texto" onClick={onEditar}>Editar</button>
        <button type="button" className="bm-boton-texto" disabled={enviando} onClick={() => enviar(() => api.quitarProducto(token, p.clave))}>Quitar</button>
      </div>
    </li>
  );
}

/** Agregar o editar un producto de su lista: nombre, unidad y la tabla de precios por cantidad (la primera fila es el precio base). */
function Editor({ api, token, inicial, otros, onListo, onCancelar }: {
  api: PropsAccion['api']; token: string; inicial: Borrador; otros: readonly ProductoCatalogo[]; onListo: () => void; onCancelar: () => void;
}) {
  const [b, setB] = useState(inicial);
  const [tocado, setTocado] = useState(false);
  const { enviando, error, enviar } = useEnvio();
  const escrito = { nombre: b.nombre, unidad: b.unidad, tramos: aTramos(b.filas) };
  const problema = errorDeProductoEscrito(escrito, otros);
  const unidad = b.unidad.trim().toLowerCase() || 'unidad';
  const base = Number(b.filas[0].precio);
  const cambiarFila = (i: number, campo: keyof Fila, valor: string) => setB(x => ({ ...x, filas: x.filas.map((f, k) => (k === i ? { ...f, [campo]: soloDigitos(valor) } : f)) }));
  const agregarFila = () => {
    const ultima = b.filas.at(-1)!;
    setB(x => ({ ...x, filas: [...x.filas, { desde: String(Math.max(2, Number(ultima.desde) * 2 || 10)), precio: ultima.precio }] }));
  };
  const sugerir = () => setB(x => ({ ...x, filas: tramosAutomaticos(base).map(t => ({ desde: String(t.desde), precio: String(t.precioUnitario) })) }));
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    setTocado(true);
    if (problema) return;
    void enviar(async () => {
      await (b.clave ? api.editarProducto(token, b.clave, escrito) : api.agregarProducto(token, escrito));
      onListo();
    }, 'No pudimos guardar el producto. Inténtalo de nuevo.');
  };

  return (
    <form className="bm-tarjeta bp-bloque" onSubmit={guardar}>
      <header className="bp-bloque-cabecera"><h2>{b.clave ? `Editar ${inicial.nombre}` : 'Agregar un producto'}</h2></header>
      <div className="bp-sumar">
        <Campo etiqueta="Producto"><input value={b.nombre} onChange={e => setB(x => ({ ...x, nombre: e.target.value }))} placeholder="Café molido 1 kg" maxLength={60} autoFocus /></Campo>
        <Campo etiqueta="Se vende por"><input value={b.unidad} onChange={e => setB(x => ({ ...x, unidad: e.target.value }))} placeholder="bolsa" maxLength={20} /></Campo>
      </div>

      <div className="bp-tramos" role="table" aria-label="Precio por cantidad">
        <div className="bp-tramo bp-tramo-titulos" role="row">
          <span role="columnheader">Desde ({pluralDe(unidad)})</span><span role="columnheader">Precio por {unidad}</span><span />
        </div>
        {b.filas.map((f, i) => (
          <div key={i} role="row" className="bp-tramo">
            {i === 0 ? <span role="cell" className="bp-base">Precio base</span> : (
              <input aria-label={`Tramo ${i + 1}: desde cuántas ${pluralDe(unidad)}`} inputMode="numeric" value={f.desde} onChange={e => cambiarFila(i, 'desde', e.target.value)} />
            )}
            <input aria-label={i === 0 ? `Precio base por ${unidad}` : `Tramo ${i + 1}: precio por ${unidad}`} inputMode="numeric" placeholder="$12.000"
              value={f.precio ? dinero(Number(f.precio)) : ''} onChange={e => cambiarFila(i, 'precio', e.target.value)} />
            {i === 0 ? <span /> : (
              <button type="button" className="bm-boton-texto" aria-label={`Quitar el tramo ${i + 1}`} onClick={() => setB(x => ({ ...x, filas: x.filas.filter((_, k) => k !== i) }))}>Quitar</button>
            )}
          </div>
        ))}
      </div>

      {((tocado && problema) || error) && <p className="bm-error bp-margen" role="alert">{error || `${problema}.`}</p>}
      <div className="bp-acciones">
        <button className="bm-boton" disabled={enviando}>{enviando ? 'Guardando...' : 'Guardar'}</button>
        {b.filas.length < MAX_TRAMOS && <button type="button" className="bm-boton secundario" onClick={agregarFila} disabled={!base}>Agregar tramo</button>}
        {b.filas.length === 1 && base > 0 && <button type="button" className="bm-boton-texto" onClick={sugerir}>Sugerir tramos (5, 10 y 15 % menos)</button>}
        <button type="button" className="bm-boton-texto" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
