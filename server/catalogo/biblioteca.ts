// La biblioteca de productos de Bando: todo lo que existe en la plataforma (las listas de los proveedores y lo que se
// compra en grupo), con su unidad. Al escribir un producto nuevo, la web y el bot sugieren uno de aquí para no crear
// dos veces el mismo con otro nombre. Cada uno trae su mejor precio base y el pedido mínimo de ese proveedor.
import { sugerirProductos, type ProductoConocido } from '../../shared/productos.ts';
import { esUnidad } from '../../shared/unidades.ts';
import type { Catalogos } from './index.ts';

export interface Biblioteca {
  buscar(q: string): ProductoConocido[];
}

interface ConProductos {
  estadoDeLaRed(): { licitaciones: readonly { productos: readonly { nombre: string; unidad: string }[] }[] };
}

export function crearBiblioteca(red: ConProductos, catalogos: Pick<Catalogos, 'listas'>): Biblioteca {
  // Primero lo de las listas, del más barato al más caro: al no repetir, cada producto queda con su mejor precio base.
  const todos = (): ProductoConocido[] => [
    ...catalogos.listas().flatMap(l => l.productos)
      .map(p => ({ nombre: p.nombre, unidad: p.unidad, precioBase: p.tramos[0]!.precioUnitario, ...(p.minimo ? { minimo: p.minimo } : {}) }))
      .sort((a, b) => a.precioBase - b.precioBase),
    ...red.estadoDeLaRed().licitaciones.flatMap(l => l.productos).map(p => ({ nombre: p.nombre, unidad: p.unidad })),
  ].flatMap(p => (esUnidad(p.unidad) ? [{ ...p, unidad: p.unidad }] : []));
  return { buscar: q => sugerirProductos(q, todos()) };
}
