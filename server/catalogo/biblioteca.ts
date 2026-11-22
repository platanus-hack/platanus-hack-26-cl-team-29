// La biblioteca de productos de Bando: lo que existe en la plataforma, es decir, lo que algún proveedor tiene en su lista,
// con su unidad. Solo eso se puede comprar en grupo. Al escribir un producto nuevo, la web y el bot sugieren uno de aquí para no crear
// dos veces el mismo con otro nombre. Cada uno trae su mejor precio base y el pedido mínimo de ese proveedor.
import { mismoNombre, sugerirProductos, type ProductoConocido } from '../../shared/productos.ts';
import { precioPorVolumen } from '../../shared/precios.ts';
import { esUnidad } from '../../shared/unidades.ts';
import type { Catalogos } from './index.ts';

/** Lo que hoy cuesta un producto en las listas: cuántos proveedores lo venden y el mejor precio para esa cantidad. */
export interface Cotizacion {
  proveedores: number;
  precio: number;
}

export interface Biblioteca {
  buscar(q: string): ProductoConocido[];
  /** El mejor precio de las listas para `cantidad` (con sus tramos), sin la lista de `excluir`; undefined si nadie lo vende. */
  cotizar(nombre: string, unidad: string, cantidad: number, excluir?: string): Cotizacion | undefined;
}

export function crearBiblioteca(catalogos: Pick<Catalogos, 'listas'>): Biblioteca {
  // Primero lo de las listas, del más barato al más caro: al no repetir, cada producto queda con su mejor precio base.
  const todos = (): ProductoConocido[] => catalogos.listas().flatMap(l => l.productos)
    .map(p => ({ nombre: p.nombre, unidad: p.unidad, precioBase: p.tramos[0]!.precioUnitario, ...(p.minimo ? { minimo: p.minimo } : {}) }))
    .sort((a, b) => a.precioBase - b.precioBase)
    .flatMap(p => (esUnidad(p.unidad) ? [{ ...p, unidad: p.unidad }] : []));
  const cotizar = (nombre: string, unidad: string, cantidad: number, excluir?: string): Cotizacion | undefined => {
    const precios = catalogos.listas().filter(l => l.proveedorId !== excluir)
      .flatMap(l => l.productos.filter(p => p.unidad === unidad && mismoNombre(p.nombre, nombre) && p.tramos.length).slice(0, 1))
      .map(p => precioPorVolumen({ tramos: p.tramos, precioSolo: p.tramos[0]!.precioUnitario }, cantidad));
    return precios.length ? { proveedores: precios.length, precio: Math.min(...precios) } : undefined;
  };
  return { buscar: q => sugerirProductos(q, todos()), cotizar };
}
