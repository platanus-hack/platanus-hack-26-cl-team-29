// La biblioteca de productos de Bando: todo lo que existe en la plataforma (las listas de los proveedores y lo que se
// compra en grupo), con su unidad. Al escribir un producto nuevo, la web y el bot sugieren uno de aquí para no crear
// dos veces el mismo con otro nombre.
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
  const todos = () => [...catalogos.listas().flatMap(l => l.productos), ...red.estadoDeLaRed().licitaciones.flatMap(l => l.productos)]
    .flatMap(p => (esUnidad(p.unidad) ? [{ nombre: p.nombre, unidad: p.unidad }] : []));
  return { buscar: q => sugerirProductos(q, todos()) };
}
