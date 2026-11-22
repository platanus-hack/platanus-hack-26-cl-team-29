// Los productos que ya existen en la plataforma (listas de los proveedores y compras en grupo), para sugerir un nombre
// y su unidad al escribir uno nuevo, y para saber si dos son el mismo: mismo nombre (sin tildes, mayúsculas ni espacios
// de más) y misma unidad.
import { sinTildes } from './texto.ts';
import type { IdUnidad } from './unidades.ts';

export interface ProductoConocido {
  nombre: string;
  unidad: IdUnidad;
  /** El precio base más bajo en las listas de los proveedores, si alguno lo vende. */
  precioBase?: number;
  /** El pedido mínimo (MOQ) de ese proveedor, si tiene. */
  minimo?: number;
}

/** Sin tildes, mayúsculas, espacios ni signos: "Coca-Cola 3 Lts" y "cocacola 3lts" quedan iguales. */
export const compacto = (texto: string): string => sinTildes(texto).replace(/[^a-z0-9]/g, '');

/** El mismo nombre escrito de otra forma (ver `compacto`). */
export const mismoNombre = (a: string, b: string): boolean => compacto(a) === compacto(b);

export const mismoProducto = (a: { nombre: string; unidad: string }, b: { nombre: string; unidad: string }): boolean =>
  mismoNombre(a.nombre, b.nombre) && a.unidad === b.unidad;

const MAXIMO_SUGERENCIAS = 8;

/**
 * Los que contienen todas las palabras escritas (sin importar espacios ni guiones), sin repetir; primero los que empiezan
 * así. Sin nada escrito, los primeros por nombre (para abrir un selector y ver qué hay).
 */
export function sugerirProductos(q: string, conocidos: readonly ProductoConocido[]): ProductoConocido[] {
  const palabras = sinTildes(q).split(/\s+/).map(compacto).filter(Boolean);
  const vistos = new Set<string>();
  const unicos = conocidos.filter(p => {
    const clave = `${compacto(p.nombre)}|${p.unidad}`;
    // "colas" también encuentra "Cola": cada palabra en singular si la escribió en plural.
    const nombre = compacto(p.nombre);
    if (vistos.has(clave) || !palabras.every(w => nombre.includes(w) || (w.length > 3 && nombre.includes(w.replace(/e?s$/, ''))))) return false;
    vistos.add(clave);
    return true;
  });
  const empieza = (p: ProductoConocido) => Number(!!palabras.length && compacto(p.nombre).startsWith(palabras[0]));
  return unicos.sort((a, b) => empieza(b) - empieza(a) || (palabras.length ? a.nombre.length - b.nombre.length : a.nombre.localeCompare(b.nombre)))
    .slice(0, MAXIMO_SUGERENCIAS);
}
