// Catálogo de la demo: nombre canónico de cada producto, palabras con que la gente lo pide
// por WhatsApp ("sacos de harina", "azucar") y precio neto de referencia. Cada proveedor
// aplica su factor sobre ese precio.

interface Producto {
  nombre: string;
  claves: string[];
  precio: number;
}

const PRODUCTOS: Producto[] = [
  { nombre: 'Harina 25 kg', claves: ['harina'], precio: 18000 },
  { nombre: 'Levadura 500 g', claves: ['levadura'], precio: 3500 },
  { nombre: 'Azúcar 25 kg', claves: ['azucar'], precio: 24000 },
  { nombre: 'Manteca 10 kg', claves: ['manteca'], precio: 21000 },
  { nombre: 'Sal 25 kg', claves: ['sal'], precio: 9000 },
];

const FACTOR_PROVEEDOR: Record<string, number> = {
  'n-panificadora-nuble': 1,
  'n-molinos-del-sur': 0.95,
  'n-harinas-andes': 1.05,
  'n-distribuidora-sur': 1,
};

export const PRODUCTOS_DISPONIBLES = PRODUCTOS.map(p => p.nombre);

const palabras = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** "sacos de harina" → "Harina 25 kg". Sin coincidencia devuelve undefined. */
export function normalizarProducto(texto: string): string | undefined {
  const dichas = palabras(texto);
  const coincide = (clave: string) => dichas.some(p => p === clave || p === `${clave}s` || p === `${clave}es`);
  return PRODUCTOS.find(p => p.claves.some(coincide))?.nombre;
}

/** Precio neto por unidad que cobra un proveedor por un producto del catálogo, redondeado a $10. */
export function precioDe(proveedorId: string, producto: string): number | undefined {
  const p = PRODUCTOS.find(x => x.nombre === producto);
  return p && Math.round((p.precio * (FACTOR_PROVEEDOR[proveedorId] ?? 1)) / 10) * 10;
}
