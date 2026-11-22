// "Tus productos" del proveedor (DESIGN.md, Paper "P4"): su lista de lo que vende, cada producto con su unidad, su
// precio base por unidad y cuánto baja por cantidad. Los tramos los escribe él (con una sugerencia a un toque). Debajo,
// lo que sale de sus facturas en el SII como sugerencia para agregar a la lista. Se actualiza en vivo con
// `catalogo.actualizado`.

import { useCallback, useState, type FormEvent } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { errorDeProductoEscrito, type CatalogoProveedor, type ProductoCatalogo } from '../../../shared/catalogo.ts';
import { contar, sinTildes } from '../../../shared/texto.ts';
import { esUnidad, nombreUnidad, pluralUnidad, unidadDeTexto } from '../../../shared/unidades.ts';
import { CampoProducto, SelectorUnidad } from '../canal/CampoProducto.tsx';
import { Campo } from '../canal/Acceso.tsx';
import { LogoSii } from '../canal/iconos.tsx';
import { useEnvio } from '../canal/piezas.tsx';
import type { LicitacionCanal } from '../canal/tipos.ts';
import { useDatoEnVivo } from '../canal/useCanal.ts';
import type { PropsAccion } from './Ventas.tsx';
import { FilaProducto } from './FilaProducto.tsx';
import { aFilas, aTramos, AccionesTramos, TablaTramos, useTramos, type FilaTramo } from './tramos.tsx';

/** Respaldo del evento mientras se arma desde las facturas (y lo único que tiene la red falsa del navegador). */
const POLEO_MS = 2000;
const VISIBLES_SUGERIDOS = 4;
const armando = (c: CatalogoProveedor) => c.estado === 'armando';

interface Borrador { clave?: string; nombre: string; unidad: string; filas: FilaTramo[]; minimo?: number }

const NUEVO: Borrador = { nombre: '', unidad: '', filas: [{ desde: '1', precio: '' }] };
// Lo que sale de las facturas trae la unidad como la escribe el facturador ("KG", "CJ"): pasa a una de la lista.
const aBorrador = (p: ProductoCatalogo, clave?: string): Borrador => ({
  ...(clave ? { clave } : {}), nombre: p.nombre, unidad: unidadDeTexto(p.unidad) ?? '',
  filas: aFilas(p.tramos), ...(p.minimo ? { minimo: p.minimo } : {}),
});

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
        <button type="button" className="bm-boton bm-mas" aria-label="Agregar un producto" onClick={() => editar(NUEVO)} disabled={!!borrador && !borrador.clave}>
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
                <FilaProducto key={p.clave} nombre={p.nombre} acciones={<button type="button" className="bm-boton secundario" onClick={() => editar(aBorrador(p))}>Agregar</button>}>
                  <span>{dinero(p.ultimoPrecio)} por {p.unidad} la última vez · {contar(p.ventas, 'venta')}</span>
                </FilaProducto>
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
    <FilaProducto nombre={p.nombre} acciones={<>
      {yaEsta ? <span className="bp-estado listo">En la compra</span> : abierta && (
        <button type="button" className="bm-boton secundario" disabled={enviando} onClick={() => enviar(() => api.sumarDelCatalogo(token, p.clave))}>
          {enviando ? 'Sumando...' : 'Sumar a la compra'}
        </button>
      )}
      <button type="button" className="bm-boton-texto" onClick={onEditar}>Editar</button>
      <button type="button" className="bm-boton-texto" disabled={enviando} onClick={() => enviar(() => api.quitarProducto(token, p.clave))}>Quitar</button>
    </>}>
      <span>{dinero(base.precioUnitario)} por {p.unidad}{p.minimo ? ` · pedido mínimo ${contar(p.minimo, p.unidad)}` : ''}</span>
      {porCantidad.length > 0 && (
        <ul className="bp-tramos-chicos" aria-label="Precio por cantidad">
          {porCantidad.map(t => <li key={t.desde}>desde {t.desde}: <strong>{dinero(t.precioUnitario)}</strong></li>)}
        </ul>
      )}
      {error && <span className="bm-error">{error}</span>}
    </FilaProducto>
  );
}

/** Agregar o editar un producto de su lista: nombre, unidad y la tabla de precios por cantidad (la primera fila es el precio base). */
function Editor({ api, token, inicial, otros, onListo, onCancelar }: {
  api: PropsAccion['api']; token: string; inicial: Borrador; otros: readonly ProductoCatalogo[]; onListo: () => void; onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial.nombre);
  const [unidadElegida, setUnidad] = useState(inicial.unidad);
  const t = useTramos(inicial.filas);
  const [minimo, setMinimo] = useState(inicial.minimo ? String(inicial.minimo) : '');
  const [tocado, setTocado] = useState(false);
  const { enviando, error, enviar } = useEnvio();
  const escrito = { nombre, unidad: unidadElegida, tramos: aTramos(t.filas), ...(Number(minimo) ? { minimo: Number(minimo) } : {}) };
  const problema = errorDeProductoEscrito(escrito, otros);
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    setTocado(true);
    if (problema) return;
    void enviar(async () => {
      await (inicial.clave ? api.editarProducto(token, inicial.clave, escrito) : api.agregarProducto(token, escrito));
      onListo();
    }, 'No pudimos guardar el producto. Inténtalo de nuevo.');
  };

  return (
    <form className="bm-tarjeta bp-bloque" onSubmit={guardar}>
      <header className="bp-bloque-cabecera"><h2>{inicial.clave ? `Editar ${inicial.nombre}` : 'Agregar un producto'}</h2></header>
      <div className="bp-sumar">
        <CampoProducto api={api} etiqueta="Producto" nombre={nombre} placeholder="Café molido 1 kg"
          onCambio={(n, u) => { setNombre(n); if (u) setUnidad(u); }} />
        <SelectorUnidad unidad={unidadElegida} onCambio={setUnidad} />
      </div>
      <TablaTramos t={t} unidad={esUnidad(unidadElegida) ? nombreUnidad(unidadElegida) : 'unidad'} unidades={esUnidad(unidadElegida) ? pluralUnidad(unidadElegida) : 'unidades'} />
      <div className="bp-sumar">
        <Campo etiqueta="Pedido mínimo del grupo (opcional)">
          <input inputMode="numeric" value={minimo} onChange={e => setMinimo(e.target.value.replace(/\D/g, ''))} placeholder="Sin mínimo" />
        </Campo>
        <p className="bm-ayuda">No impide la compra en grupo: si ganas y no llegan a este mínimo, puedes cancelar el pedido. Se lo avisamos a los compradores.</p>
      </div>
      {((tocado && problema) || error) && <p className="bm-error bp-margen" role="alert">{error || `${problema}.`}</p>}
      <div className="bp-acciones">
        <button className="bm-boton" disabled={enviando}>{enviando ? 'Guardando...' : 'Guardar'}</button>
        <AccionesTramos t={t} />
        <button type="button" className="bm-boton-texto" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
