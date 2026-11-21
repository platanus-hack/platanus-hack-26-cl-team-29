// Catálogo del proveedor armado desde sus facturas: qué vende, en qué unidad, a qué precio y cuánto, con los tramos
// que sugiere su propio historial. Del XML solo se guarda esto; nunca a quién le vendió.
// Decisión: docs/decisiones/20261121-1941-catalogo-desde-facturas.md
import { CANASTA_DEMO } from './canasta-demo.ts';
import { aCentena, tramosAutomaticos, tramosSugeridos, type Tramo } from './precios.ts';
import { sinTildes } from './texto.ts';

/** Una línea de detalle de una factura de venta, sin datos del receptor. */
export interface LineaVendida {
  codigo?: string;
  nombre: string;
  /** Unidad tal como viene en la factura, en minúsculas ("caja", "un", "kg"). */
  unidad: string;
  cantidad: number;
  /** Neto por unidad: el monto de la línea dividido por la cantidad (incluye su descuento). */
  precioUnitario: number;
  /** AAAA-MM-DD, la fecha de emisión. */
  fecha: string;
}

export interface ProductoCatalogo {
  /** Identifica el producto en el catálogo: su código si la factura lo trae o su nombre normalizado. */
  clave: string;
  nombre: string;
  codigo?: string;
  unidad: string;
  /** El de la última venta, a la centena. */
  ultimoPrecio: number;
  precioMinimo: number;
  precioMaximo: number;
  unidadesVendidas: number;
  /** Líneas de factura con este producto. */
  ventas: number;
  ultimaVenta: string;
  tramos: Tramo[];
  /** `historial` si el historial muestra bajas por volumen; si no, `automaticos` (5, 10 y 15 % desde el último precio). */
  tramosDe: 'historial' | 'automaticos';
}

/**
 * De dónde salieron las facturas. `ejemplo`: el historial simulado de la demo. `archivos`: XML que el equipo recibió
 * del facturador del proveedor (o de su casilla de intercambio) y cargó por la ruta de operación.
 */
export type OrigenCatalogo = 'ejemplo' | 'archivos';

export interface CatalogoProveedor {
  estado: 'armando' | 'listo' | 'error';
  origen: OrigenCatalogo;
  /** Facturas de venta leídas. */
  facturas: number;
  /** Primera y última fecha de esas facturas (AAAA-MM-DD). */
  desde?: string;
  hasta?: string;
  productos: ProductoCatalogo[];
  actualizado: string;
  mensaje?: string;
}

const claveDe = (l: Pick<LineaVendida, 'codigo' | 'nombre'>): string =>
  l.codigo ? `c-${sinTildes(l.codigo).replace(/[^a-z0-9]+/g, '')}` : sinTildes(l.nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const masFrecuente = (xs: readonly string[]): string => {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

/** Agrupa las líneas por producto. Ordena de mayor a menor venta (unidades por último precio). */
export function armarCatalogo(lineas: readonly LineaVendida[]): ProductoCatalogo[] {
  const grupos = new Map<string, LineaVendida[]>();
  for (const l of lineas) {
    const clave = claveDe(l);
    if (clave) grupos.set(clave, [...(grupos.get(clave) ?? []), l]);
  }
  const productos = [...grupos].map(([clave, ls]): ProductoCatalogo => {
    const porFecha = [...ls].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const ultima = porFecha.at(-1)!;
    const precios = ls.map(l => l.precioUnitario);
    const historial = tramosSugeridos(ls);
    const conBajas = historial.length > 1;
    const ultimoPrecio = aCentena(ultima.precioUnitario);
    return {
      clave, nombre: ultima.nombre, ...(ultima.codigo ? { codigo: ultima.codigo } : {}), unidad: masFrecuente(ls.map(l => l.unidad)) || 'unidad',
      ultimoPrecio, precioMinimo: Math.min(...precios), precioMaximo: Math.max(...precios),
      unidadesVendidas: ls.reduce((s, l) => s + l.cantidad, 0), ventas: ls.length, ultimaVenta: ultima.fecha,
      tramos: conBajas ? historial : tramosAutomaticos(ultimoPrecio), tramosDe: conBajas ? 'historial' : 'automaticos',
    };
  });
  return productos.sort((a, b) => b.unidadesVendidas * b.ultimoPrecio - a.unidadesVendidas * a.ultimoPrecio);
}

/** Lo que resume un catálogo listo: cuántas facturas y entre qué fechas. */
export function resumenDeFacturas(fechas: readonly string[]): Pick<CatalogoProveedor, 'facturas' | 'desde' | 'hasta'> {
  const o = [...fechas].sort();
  return { facturas: o.length, ...(o.length ? { desde: o[0], hasta: o.at(-1) } : {}) };
}

// ---------- Historial de ejemplo (demo) ----------

/** Una factura de venta del historial de ejemplo: folio, fecha y líneas. El receptor lo pone quien arma el XML. */
export interface VentaDeEjemplo {
  folio: number;
  fecha: string;
  lineas: Omit<LineaVendida, 'fecha'>[];
}

// Los cuatro de la canasta de la demo, con su nombre y precio, más otros que el proveedor también vende.
const PRODUCTOS_EJEMPLO: readonly { codigo: string; nombre: string; unidad: string; precio: number }[] = [
  ...CANASTA_DEMO.map((p, i) => ({ codigo: `PRD-${101 + i}`, nombre: p.nombre, unidad: p.unidad, precio: p.precioSolo })),
  { codigo: 'PRD-201', nombre: 'Caja de rollos térmicos 57 mm (50 un.)', unidad: 'caja', precio: 24_000 },
  { codigo: 'PRD-202', nombre: 'Caja de cintas de embalaje 48 mm (36 un.)', unidad: 'caja', precio: 19_900 },
  { codigo: 'PRD-203', nombre: 'Ribbon de cera 110 mm x 300 m', unidad: 'rollo', precio: 7_900 },
  { codigo: 'PRD-204', nombre: 'Paquete de servilletas de papel (500 un.)', unidad: 'paquete', precio: 4_500 },
];

const CANTIDADES: readonly [cantidad: number, peso: number][] = [
  [1, 14], [2, 10], [3, 8], [5, 8], [6, 4], [8, 4], [10, 9], [12, 5], [15, 4], [20, 5], [25, 5], [30, 3], [40, 2], [50, 3], [60, 1], [100, 2],
];
/** Descuento por volumen que el proveedor de ejemplo da de hecho en sus facturas. */
const descuento = (q: number): number => (q >= 100 ? 0.78 : q >= 50 ? 0.82 : q >= 25 ? 0.88 : q >= 10 ? 0.94 : 1);

/** Números pseudoaleatorios repetibles (mulberry32): el mismo historial en cada corrida. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seis meses de facturas de venta verosímiles hasta `hoy`: 1 a 3 productos por factura, más compras chicas que
 * grandes, el descuento por volumen que el proveedor da de hecho y precios que suben un poco con el tiempo.
 */
export function historialDeEjemplo(hoy: Date, facturas = 180): VentaDeEjemplo[] {
  const r = azar(26);
  const pesoTotal = CANTIDADES.reduce((s, [, p]) => s + p, 0);
  const cantidad = () => {
    let x = r() * pesoTotal;
    for (const [q, p] of CANTIDADES) if ((x -= p) < 0) return q;
    return 1;
  };
  const DIA = 86_400_000;
  const dias = 182;
  const ventas: VentaDeEjemplo[] = [];
  for (let i = 0; i < facturas; i++) {
    const atras = Math.round(dias - (i * dias) / facturas);
    const fecha = new Date(hoy.getTime() - atras * DIA).toISOString().slice(0, 10);
    const alza = 1 - 0.03 * (atras / dias);
    // Fisher-Yates con el azar repetible: el mismo orden en el servidor y en el navegador.
    const mezcla = [...PRODUCTOS_EJEMPLO];
    for (let k = mezcla.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [mezcla[k], mezcla[j]] = [mezcla[j], mezcla[k]];
    }
    const elegidos = mezcla.slice(0, 1 + Math.floor(r() * 3));
    const lineas = elegidos.map(p => {
      const q = cantidad();
      const precio = Math.round((p.precio * descuento(q) * alza * (0.99 + r() * 0.02)) / 10) * 10;
      return { codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: q, precioUnitario: precio };
    });
    ventas.push({ folio: 1001 + i, fecha, lineas });
  }
  return ventas;
}

/** Las líneas del historial de ejemplo, como las dejaría leer el XML. */
export const lineasDeEjemplo = (ventas: readonly VentaDeEjemplo[]): LineaVendida[] =>
  ventas.flatMap(v => v.lineas.map(l => ({ ...l, fecha: v.fecha })));
