// Proveedores y precios de referencia desde Mercado Público (ChileCompra): API pública del módulo.
// Fuera de server/mercado-publico/ se importa solo este archivo.
// Fuentes: el dataset OCDS anual (sin ticket, ocds.ts) y, con MERCADO_PUBLICO_TICKET, la API del día a día (api.ts).
// Sin ninguna orden real guardada, la API responde con órdenes de ejemplo (`fuente: 'ejemplo'`).
//
// GET /api/fuentes/mercado-publico/proveedores        → { fuente, hasta, proveedores }
// GET /api/fuentes/mercado-publico/proveedores/:rut   → { fuente, hasta, proveedor, precios }
// GET /api/fuentes/mercado-publico/precios?producto=  → { fuente, hasta, producto, resumen, precios }
// Socket.io `red:evento` tipo `mercado_publico.actualizado` → { fuente: 'ocds' | 'api', hasta, ordenes, precios, proveedores }
import express from 'express';
import type pg from 'pg';
import { fechaEnChile } from '../../shared/fecha.ts';
import { formatearRut, validarRut } from '../../shared/rut.ts';
import { sinTildes } from '../../shared/texto.ts';
import type { EventoRed } from '../red/index.ts';
import { crearAlmacenMemoria, crearAlmacenPostgres, type AlmacenMercadoPublico } from './almacen.ts';
import { crearFuenteApi } from './api.ts';
import { ordenesDeEjemplo } from './falsa.ts';
import { limpiarOrdenes, type OrdenLimpia } from './limpieza.ts';
import type { OrdenMP, PrecioMP } from './normalizar.ts';
import { descargarOcds, leerOcds, urlOcds, versionOcds } from './ocds.ts';
import { pasada, sumarDias } from './sincronizar.ts';

export { limpiarOrdenes, normalizarUnidad, PRECIO_UNITARIO_MAXIMO } from './limpieza.ts';
export type { OrdenLimpia, PrecioLimpio, Unidad } from './limpieza.ts';

const HORAS_POR_DEFECTO = 6;
const DIAS_INICIALES = 3;
const MAX_POR_DIA = 100;
/** Pausa entre llamadas a la API real: ~100 detalles por día en un par de minutos, lejos de las 10.000 diarias. */
const ESPERA_MS = 1500;
const MAX_PRECIOS = 50;
/** Precios de más de un año no sirven como referencia. */
const DIAS_DE_REFERENCIA = 365;
/** La primera pasada espera un poco: no compite con el arranque del servidor. */
const PRIMERA_PASADA_MS = 5000;

/** La ficha del proveedor según Mercado Público. `clientes` va contado: nunca se listan compradores. */
export interface ProveedorConDatos {
  rut: string;
  nombre: string;
  comuna: string;
  region: string;
  rubros: string[];
  despacho: string[];
  clientes: number;
  ordenes: number;
  ultimaOrden: string;
}

/** Un precio como sale de la API de Bando: sin el organismo comprador. */
const precioPublico = ({ organismo: _organismo, ...p }: PrecioMP, o: OrdenMP) => ({ ...p, proveedor: { rut: o.proveedor.rut, nombre: o.proveedor.nombre } });

/** Map.groupBy, que el lib de TypeScript del repo todavía no tiene. */
function agrupar<T>(xs: T[], clave: (x: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const x of xs) {
    const grupo = grupos.get(clave(x));
    if (grupo) grupo.push(x);
    else grupos.set(clave(x), [x]);
  }
  return grupos;
}

const unicos = (valores: string[]) => [...new Set(valores.filter(Boolean))].sort();

export function proveedoresDe(ordenes: OrdenMP[]): ProveedorConDatos[] {
  const porRut = agrupar(ordenes, o => o.proveedor.rut);
  return [...porRut.values()].map(delProveedor => {
    const precios = delProveedor.flatMap(o => o.precios);
    return {
      ...delProveedor.reduce((a, b) => (b.fecha > a.fecha ? b : a)).proveedor, // los datos de la orden más reciente
      rubros: unicos(precios.map(p => p.rubro)),
      despacho: unicos(precios.map(p => p.despacho)),
      clientes: new Set(precios.map(p => p.organismo)).size,
      ordenes: delProveedor.length,
      ultimaOrden: delProveedor.map(o => o.fecha).sort().at(-1)!,
    };
  }).sort((a, b) => b.ordenes - a.ordenes || a.nombre.localeCompare(b.nombre));
}

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
};

/** Mínimo, mediana y máximo de unos precios (al menos uno). */
export const rangoDe = (valores: number[]) => ({ minimo: Math.min(...valores), mediana: mediana(valores), maximo: Math.max(...valores) });

/** Precios de referencia de un producto (búsqueda por texto en el producto y su categoría), resumidos por unidad. */
export function preciosDeReferencia(ordenes: OrdenMP[], producto: string) {
  const buscado = sinTildes(producto.trim());
  const precios = ordenes
    .flatMap(o => o.precios.map(p => ({ p, o })))
    .filter(({ p }) => sinTildes(`${p.producto} ${p.categoria}`).includes(buscado))
    .sort((a, b) => b.p.fecha.localeCompare(a.p.fecha));
  const resumen = buscado
    ? [...agrupar(precios, x => x.p.unidad)].map(([unidad, xs]) => {
      return { unidad, cantidad: xs.length, ...rangoDe(xs.map(x => x.p.precioUnitario)) };
    })
    : [];
  return { producto, resumen, precios: precios.slice(0, MAX_PRECIOS).map(({ p, o }) => precioPublico(p, o)) };
}

/** Lo que se muestra de Mercado Público en un momento: órdenes ya limpias (limpieza.ts) y de dónde salen. */
export interface FotoMercadoPublico {
  ordenes: OrdenLimpia[];
  fuente: 'mercado_publico' | 'ejemplo';
  /** Día de la orden más reciente, `AAAA-MM-DD`. */
  hasta: string | null;
}

export interface MercadoPublicoDelServidor {
  rutas: express.Router;
  /** La foto vigente; es el mismo objeto mientras no llegan órdenes nuevas (sirve de clave de cache). */
  foto(): FotoMercadoPublico;
  /** Corre una pasada ahora (la misma que corre el intervalo). */
  actualizar(): Promise<void>;
  detener(): void;
}

/**
 * Una pasada al arrancar y otra cada `MERCADO_PUBLICO_INTERVALO_HORAS` (6 por defecto): el archivo OCDS del año, solo si
 * cambió, y la API con ticket si hay. `MERCADO_PUBLICO=0` apaga las pasadas (la API de Bando sigue respondiendo).
 */
export async function iniciarMercadoPublico(
  db: pg.Pool | null,
  emitir: (evento: EventoRed) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MercadoPublicoDelServidor> {
  let almacen: AlmacenMercadoPublico | null = null;
  if (db) {
    try {
      almacen = await crearAlmacenPostgres(db);
    } catch (error) {
      console.error('[mercado-publico] no se pudo usar Postgres, las órdenes quedan en memoria', error);
    }
  }
  if (!almacen) {
    console.warn('[mercado-publico] órdenes en memoria: tras un reinicio se vuelven a traer. Configura DATABASE_URL.');
    almacen = crearAlmacenMemoria();
  }
  const guardadas = almacen;
  const cache = new Map((await guardadas.todas()).map(o => [o.codigo, o]));
  const ticket = env.MERCADO_PUBLICO_TICKET?.trim();
  if (!ticket) console.warn('[mercado-publico] sin MERCADO_PUBLICO_TICKET: solo el dataset OCDS anual (sin las órdenes de los últimos días).');
  const api = ticket ? crearFuenteApi(ticket, { esperaMs: ESPERA_MS }) : null;

  let ultimaFoto: { clave: string; foto: FotoMercadoPublico } | null = null;
  const avisar = (fuente: 'ocds' | 'api') => (nuevas: OrdenMP[]) => {
    for (const o of nuevas) cache.set(o.codigo, o);
    if (!nuevas.length) return;
    ultimaFoto = null;
    const datos = {
      fuente, hasta: nuevas.map(o => o.fecha).sort().at(-1), ordenes: nuevas.length,
      precios: nuevas.reduce((n, o) => n + o.precios.length, 0), proveedores: new Set(nuevas.map(o => o.proveedor.rut)).size,
    };
    emitir({ tipo: 'mercado_publico.actualizado', datos, en: new Date().toISOString() });
  };

  async function pasadaOcds(hoy: string) {
    const url = urlOcds(hoy.slice(0, 4));
    const clave = `ocds-${hoy.slice(0, 4)}`;
    const version = await versionOcds(url);
    if (version === await guardadas.marca(clave)) return;
    const alGuardar = avisar('ocds');
    const leido = await leerOcds(await descargarOcds(url), {
      desde: sumarDias(hoy, -DIAS_DE_REFERENCIA),
      alLote: async lote => alGuardar(await guardadas.guardar(lote)),
    });
    await guardadas.fijarMarca(clave, version);
    console.warn(`[mercado-publico] OCDS ${hoy.slice(0, 4)}: ${leido.lineas} licitaciones leídas, ${leido.ordenes} adjudicaciones de alimentos`);
  }

  let corriendo = false;
  async function actualizar() {
    if (corriendo) return;
    corriendo = true;
    const hoy = fechaEnChile(new Date());
    try {
      await pasadaOcds(hoy).catch(error => console.error('[mercado-publico] el dataset OCDS falló; se reintenta en la próxima pasada', error));
      if (api) {
        await pasada({ fuente: api, almacen: guardadas, hoy, diasIniciales: DIAS_INICIALES, maxPorDia: MAX_POR_DIA, alGuardar: avisar('api') })
          .catch(error => console.error('[mercado-publico] la API se cortó; la próxima pasada sigue desde el último día guardado', error));
      }
    } finally {
      corriendo = false;
    }
  }

  const temporizadores: NodeJS.Timeout[] = [];
  if (env.MERCADO_PUBLICO !== '0') {
    const horas = Number(env.MERCADO_PUBLICO_INTERVALO_HORAS) || HORAS_POR_DEFECTO;
    temporizadores.push(setTimeout(() => void actualizar(), PRIMERA_PASADA_MS), setInterval(() => void actualizar(), horas * 3_600_000));
    for (const t of temporizadores) t.unref();
  }

  /** Las órdenes guardadas, limpias; sin ninguna, las de ejemplo, avisando que lo son. Se recalcula solo si cambiaron. */
  const foto = (): FotoMercadoPublico => {
    const clave = cache.size ? 'guardadas' : fechaEnChile(new Date());
    if (ultimaFoto?.clave === clave) return ultimaFoto.foto;
    const ordenes = limpiarOrdenes(cache.size ? [...cache.values()] : ordenesDeEjemplo(clave));
    const nueva: FotoMercadoPublico = { ordenes, fuente: cache.size ? 'mercado_publico' : 'ejemplo', hasta: ordenes.map(o => o.fecha).sort().at(-1) ?? null };
    ultimaFoto = { clave, foto: nueva };
    return nueva;
  };
  const rutas = express.Router();
  rutas.get('/proveedores', (_req, res) => {
    const { ordenes, ...meta } = foto();
    res.json({ ...meta, proveedores: proveedoresDe(ordenes) });
  });
  rutas.get('/proveedores/:rut', (req, res) => {
    const rut = validarRut(req.params.rut);
    const { ordenes, ...meta } = foto();
    const suyas = rut ? ordenes.filter(o => o.proveedor.rut === formatearRut(rut)) : [];
    if (!suyas.length) return void res.status(404).json({ error: 'Ese proveedor no tiene ventas en Mercado Público.' });
    const precios = suyas.flatMap(o => o.precios.map(p => precioPublico(p, o))).sort((a, b) => b.fecha.localeCompare(a.fecha));
    res.json({ ...meta, proveedor: proveedoresDe(suyas)[0], precios: precios.slice(0, MAX_PRECIOS) });
  });
  rutas.get('/precios', (req, res) => {
    const { ordenes, ...meta } = foto();
    res.json({ ...meta, ...preciosDeReferencia(ordenes, String(req.query.producto ?? '')) });
  });
  return { rutas, foto, actualizar, detener: () => temporizadores.forEach(clearTimeout) };
}
