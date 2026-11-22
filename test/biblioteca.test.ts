import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearBiblioteca } from '../server/catalogo/biblioteca.ts';

// Dos proveedores venden la CocaCola 330ml con tramos distintos; uno vende otra unidad (no cuenta).
const listas = () => [
  { proveedorId: 'a', productos: [{ nombre: 'CocaCola 330ml', unidad: 'unidad', tramos: [{ desde: 1, precioUnitario: 10000 }, { desde: 12, precioUnitario: 2000 }, { desde: 1200, precioUnitario: 1500 }] }] },
  { proveedorId: 'b', productos: [{ nombre: 'Coca Cola 330 ml', unidad: 'unidad', tramos: [{ desde: 1, precioUnitario: 2200 }] }] },
  { proveedorId: 'c', productos: [{ nombre: 'CocaCola 330ml', unidad: 'caja', tramos: [{ desde: 1, precioUnitario: 100 }] }] },
] as never;

test('cotizar: el mejor precio de las listas para esa cantidad, con sus tramos, sin la lista excluida', () => {
  const b = crearBiblioteca({ listas });
  assert.deepEqual(b.cotizar('CocaCola 330ml', 'unidad', 200), { proveedores: 2, precio: 2000 });
  assert.deepEqual(b.cotizar('CocaCola 330ml', 'unidad', 5), { proveedores: 2, precio: 2200 });
  assert.deepEqual(b.cotizar('CocaCola 330ml', 'unidad', 200, 'a'), { proveedores: 1, precio: 2200 });
  assert.equal(b.cotizar('Pepsi', 'unidad', 10), undefined);
});
