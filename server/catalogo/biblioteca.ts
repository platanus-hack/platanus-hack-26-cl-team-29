// La biblioteca de productos de Bando: lo que existe en la plataforma, es decir, lo que algún proveedor tiene en su lista,
// con su unidad. Solo eso se puede comprar en grupo. Al escribir un producto nuevo, la web y el bot sugieren uno de aquí para no crear
// dos veces el mismo con otro nombre. Cada uno trae su mejor precio base y el pedido mínimo de ese proveedor.
import { sugerirProductos, type ProductoConocido } from '../../shared/productos.ts';
import { esUnidad } from '../../shared/unidades.ts';
import type { Catalogos } from './index.ts';

export interface Biblioteca {
  buscar(q: string): ProductoConocido[];
}

export function crearBiblioteca(catalogos: Pick<Catalogos, 'listas'>): Biblioteca {
  // Primero lo de las listas, del más barato al más caro: al no repetir, cada producto queda con su mejor precio base.
  const todos = (): ProductoConocido[] => catalogos.listas().flatMap(l => l.productos)
    .map(p => ({ nombre: p.nombre, unidad: p.unidad, precioBase: p.tramos[0]!.precioUnitario, ...(p.minimo ? { minimo: p.minimo } : {}) }))
    .sort((a, b) => a.precioBase - b.precioBase)
    .flatMap(p => (esUnidad(p.unidad) ? [{ ...p, unidad: p.unidad }] : []));
  return { buscar: q => sugerirProductos(q, todos()) };
}
