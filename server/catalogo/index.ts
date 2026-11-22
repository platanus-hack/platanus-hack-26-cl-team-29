// Catálogo de cada proveedor, armado solo desde sus facturas de venta, más lo que el proveedor agrega a mano. Conseguir los XML es tarea del equipo, no del
// proveedor: los trae un origen (el historial de ejemplo en la demo; los XML que entrega su facturador o su casilla de
// intercambio, cargados por la ruta de operación). Se arma la primera vez que el proveedor entra a su panel o se
// registra, y avisa por `red:evento` (`catalogo.actualizado`, solo el id del proveedor y el estado).
// Decisión: docs/decisiones/20261121-1941-catalogo-desde-facturas.md
import type pg from 'pg';
import {
  armarCatalogo, errorDeProductoEscrito, juntarCatalogo, productoManual, resumenDeFacturas,
  type CatalogoProveedor, type LineaVendida, type ProductoCatalogo, type ProductoEscrito,
} from '../../shared/catalogo.ts';
import { ErrorRed } from '../red/dominio.ts';
import { mismoProducto } from '../../shared/productos.ts';
import type { EventoRed } from '../red/tipos.ts';
import { origenEjemplo, type OrigenXml } from './origenes.ts';
import { leerFacturas } from './xml.ts';

export { crearRutasCatalogo, crearRutasOperacionCatalogo } from './rutas.ts';
export { origenArchivos, origenEjemplo, type OrigenXml } from './origenes.ts';

export interface ProveedorCatalogo {
  id: string;
  /** Si se conoce, las facturas de otro emisor no entran a su catálogo. */
  rut?: string;
}

/** Cómo fue una carga: facturas que entraron y las que se dejaron fuera, por qué. */
export interface ResultadoCarga {
  catalogo: CatalogoProveedor;
  facturas: number;
  omitidos: number;
  deOtraEmpresa: number;
  ilegibles: number;
}

/** Lo que se guarda: el catálogo y las líneas por factura (para sumar cargas sin contar dos veces). Sin receptores. */
interface Guardado {
  catalogo: CatalogoProveedor;
  facturas: { clave: string; fecha: string; lineas: LineaVendida[] }[];
  /** Los que agregó a mano; sobreviven a cada nueva carga de facturas. */
  manuales?: ProductoCatalogo[];
}

export interface Catalogos {
  /** El catálogo del proveedor, o null si nunca se armó. */
  de(proveedorId: string): CatalogoProveedor | null;
  /** El catálogo; si nunca se armó, lo empieza a armar desde el origen por defecto y lo devuelve `armando`. */
  asegurar(proveedor: ProveedorCatalogo): CatalogoProveedor;
  /** Arma (o suma, si son archivos) desde un origen. */
  armar(proveedor: ProveedorCatalogo, origen?: OrigenXml): Promise<ResultadoCarga>;
  producto(proveedorId: string, clave: string): ProductoCatalogo | undefined;
  /** Agrega un producto a su lista. Si el catálogo nunca se armó, lo empieza a armar desde las facturas. */
  agregar(proveedor: ProveedorCatalogo, producto: ProductoEscrito): Promise<ProductoCatalogo>;
  /** Cambia un producto de su lista (nombre, unidad, tramos), con la misma clave. */
  editar(proveedor: ProveedorCatalogo, clave: string, producto: ProductoEscrito): Promise<ProductoCatalogo>;
  /** Quita un producto de su lista (las sugerencias de sus facturas no se quitan). */
  quitar(proveedorId: string, clave: string): Promise<void>;
  /** El precio base más bajo del mismo producto (nombre y unidad) en las listas de los proveedores, o undefined. */
  referencia(producto: string, unidad: string): number | undefined;
  /** La lista de productos de cada proveedor que tiene una. */
  listas(): { proveedorId: string; productos: ProductoCatalogo[] }[];
  /** Avisa cuando un proveedor cambia su lista (agrega, edita o quita). */
  alCambiarLista(oyente: (proveedorId: string) => void): void;
}

export interface OpcionesCatalogos {
  db?: pg.Pool | null;
  emitir(evento: EventoRed): void;
  /** El origen cuando nadie cargó archivos. Por defecto, el historial de ejemplo. */
  origenPorDefecto?: (proveedor: ProveedorCatalogo) => OrigenXml;
  ahora?: () => Date;
}

export async function iniciarCatalogos({ db, emitir, origenPorDefecto = p => origenEjemplo(p.rut), ahora = () => new Date() }: OpcionesCatalogos): Promise<Catalogos> {
  const guardados = new Map<string, Guardado>();
  if (db) {
    await db.query('create table if not exists catalogo_proveedores (proveedor_id text primary key, datos jsonb not null)');
    const { rows } = await db.query('select proveedor_id, datos from catalogo_proveedores');
    for (const r of rows) if (r.datos?.catalogo?.estado === 'listo') guardados.set(r.proveedor_id, r.datos);
  }
  const enCurso = new Map<string, Promise<ResultadoCarga>>();

  function cambiar(proveedorId: string, g: Guardado) {
    guardados.set(proveedorId, g);
    emitir({ tipo: 'catalogo.actualizado', datos: { proveedorId, estado: g.catalogo.estado }, en: ahora().toISOString() });
  }

  async function persistir(proveedorId: string, g: Guardado) {
    if (!db) return;
    await db.query(
      'insert into catalogo_proveedores (proveedor_id, datos) values ($1, $2) on conflict (proveedor_id) do update set datos = excluded.datos',
      [proveedorId, JSON.stringify(g)],
    );
  }

  async function cargar(p: ProveedorCatalogo, origen: OrigenXml): Promise<ResultadoCarga> {
    const previo = guardados.get(p.id);
    // Los archivos se suman a los ya cargados (una factura repetida cuenta una vez); el ejemplo reemplaza todo.
    const base = origen.origen === 'archivos' && previo?.catalogo.origen === 'archivos' ? previo.facturas : [];
    const porClave = new Map(base.map(f => [f.clave, f]));
    const cuenta = { omitidos: 0, deOtraEmpresa: 0, ilegibles: 0 };
    const manuales = previo?.manuales ?? [];
    if (previo?.catalogo.estado !== 'listo') {
      cambiar(p.id, { catalogo: { estado: 'armando', origen: origen.origen, facturas: 0, productos: manuales, actualizado: ahora().toISOString() }, facturas: [], manuales });
    }
    try {
      for (const xml of await origen.xmls()) {
        let lectura;
        try {
          lectura = leerFacturas(xml);
        } catch {
          cuenta.ilegibles++;
          continue;
        }
        cuenta.omitidos += lectura.omitidos;
        for (const f of lectura.facturas) {
          if (p.rut && f.rutEmisor && f.rutEmisor !== p.rut) {
            cuenta.deOtraEmpresa++;
            continue;
          }
          porClave.set(`${f.rutEmisor}-${f.tipo}-${f.folio}`, { clave: `${f.rutEmisor}-${f.tipo}-${f.folio}`, fecha: f.fecha, lineas: f.lineas });
        }
      }
    } catch (error) {
      // Si ya había un catálogo listo, se queda; si no, queda en error y se reintenta la próxima vez que entre.
      if (previo?.catalogo.estado !== 'listo') {
        const mensaje = 'No pudimos traer tus facturas. Lo intentamos de nuevo la próxima vez que entres.';
        cambiar(p.id, { catalogo: { estado: 'error', origen: origen.origen, facturas: 0, productos: manuales, actualizado: ahora().toISOString(), mensaje }, facturas: [], manuales });
      }
      throw error;
    }
    const facturas = [...porClave.values()];
    const g: Guardado = {
      catalogo: {
        estado: 'listo', origen: origen.origen, ...resumenDeFacturas(facturas.map(f => f.fecha)),
        productos: juntarCatalogo(manuales, armarCatalogo(facturas.flatMap(f => f.lineas))), actualizado: ahora().toISOString(),
      },
      facturas,
      manuales,
    };
    await persistir(p.id, g);
    cambiar(p.id, g);
    return { catalogo: g.catalogo, facturas: facturas.length - base.length, ...cuenta };
  }

  function armar(p: ProveedorCatalogo, origen = origenPorDefecto(p)): Promise<ResultadoCarga> {
    const previa = enCurso.get(p.id) ?? Promise.resolve(null);
    // Una carga por proveedor a la vez: la siguiente espera a la anterior y parte de lo que dejó.
    const siguiente = previa.catch(() => null).then(() => cargar(p, origen)).finally(() => {
      if (enCurso.get(p.id) === siguiente) enCurso.delete(p.id);
    });
    enCurso.set(p.id, siguiente);
    return siguiente;
  }

  function validado(escrito: ProductoEscrito, otros: readonly ProductoCatalogo[], clave?: string): ProductoCatalogo {
    const problema = errorDeProductoEscrito(escrito, otros);
    if (problema) throw new ErrorRed('datos_invalidos', problema);
    return productoManual(escrito, ahora().toISOString().slice(0, 10), clave);
  }

  /** Su lista, si el producto está en ella. */
  function deSuLista(id: string, clave: string): ProductoCatalogo[] {
    const manuales = guardados.get(id)?.manuales ?? [];
    if (!manuales.some(x => x.clave === clave)) throw new ErrorRed('no_encontrado', 'Ese producto no está en tu lista');
    return manuales;
  }

  const oyentesDeListas = new Set<(proveedorId: string) => void>();

  /** Cambia los productos a mano y vuelve a juntar el catálogo con lo de las facturas. */
  async function conManuales(p: ProveedorCatalogo, cambio: (manuales: ProductoCatalogo[]) => ProductoCatalogo[]) {
    const previo = guardados.get(p.id);
    const manuales = cambio(previo?.manuales ?? []);
    const deFacturas = (previo?.catalogo.productos ?? []).filter(x => !x.manual);
    const catalogo: CatalogoProveedor = previo
      ? { ...previo.catalogo, productos: juntarCatalogo(manuales, deFacturas), actualizado: ahora().toISOString() }
      : { estado: 'armando', origen: 'ejemplo', facturas: 0, productos: manuales, actualizado: ahora().toISOString() };
    const g: Guardado = { catalogo, facturas: previo?.facturas ?? [], manuales };
    await persistir(p.id, g);
    cambiar(p.id, g);
    for (const oyente of oyentesDeListas) oyente(p.id);
    if (!previo && !enCurso.has(p.id)) void armar(p).catch(() => {});
  }

  return {
    de: id => guardados.get(id)?.catalogo ?? null,
    asegurar(p) {
      const actual = guardados.get(p.id)?.catalogo;
      if (actual && actual.estado !== 'error') return actual;
      if (!enCurso.has(p.id)) void armar(p).catch(() => {});
      return guardados.get(p.id)?.catalogo ?? { estado: 'armando', origen: 'ejemplo', facturas: 0, productos: [], actualizado: ahora().toISOString() };
    },
    armar,
    producto: (id, clave) => guardados.get(id)?.catalogo.productos.find(x => x.clave === clave),
    async agregar(p, escrito) {
      const producto = validado(escrito, guardados.get(p.id)?.manuales ?? []);
      await conManuales(p, manuales => [producto, ...manuales]);
      return producto;
    },
    async editar(p, clave, escrito) {
      const manuales = deSuLista(p.id, clave);
      const producto = validado(escrito, manuales.filter(x => x.clave !== clave), clave);
      await conManuales(p, ms => ms.map(x => (x.clave === clave ? producto : x)));
      return producto;
    },
    listas: () => [...guardados].filter(([, g]) => g.manuales?.length).map(([proveedorId, g]) => ({ proveedorId, productos: g.manuales! })),
    alCambiarLista: oyente => { oyentesDeListas.add(oyente); },
    referencia(nombre, unidad) {
      const precios = [...guardados.values()].flatMap(g => g.manuales ?? []).filter(p => mismoProducto(p, { nombre, unidad })).map(p => p.tramos[0].precioUnitario);
      return precios.length ? Math.min(...precios) : undefined;
    },
    async quitar(id, clave) {
      deSuLista(id, clave);
      await conManuales({ id }, manuales => manuales.filter(x => x.clave !== clave));
    },
  };
}
