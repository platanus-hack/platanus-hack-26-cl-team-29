import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unidadDeTexto } from '../shared/unidades.ts';
import { mismoProducto, sugerirProductos } from '../shared/productos.ts';

test('lo que escribe la persona se traduce a una unidad de la lista', () => {
  assert.deepEqual(['kg', 'Kilos', 'la bolsa', 'bidones', 'lt', 'cc', 'docena'].map(unidadDeTexto), ['kilo', 'kilo', 'bolsa', 'bidon', 'litro', 'mililitro', 'docena']);
  assert.equal(unidadDeTexto('tarro'), undefined);
});

test('mismo producto es mismo nombre normalizado y misma unidad; la búsqueda no repite y prefiere los que empiezan así', () => {
  assert.ok(mismoProducto({ nombre: 'Café  molido 1 KG', unidad: 'bolsa' }, { nombre: 'cafe molido 1 kg', unidad: 'bolsa' }));
  assert.ok(!mismoProducto({ nombre: 'Café molido 1 kg', unidad: 'bolsa' }, { nombre: 'Café molido 1 kg', unidad: 'kilo' }));
  const conocidos = [
    { nombre: 'Harina de café', unidad: 'saco' as const }, { nombre: 'Café molido 1 kg', unidad: 'bolsa' as const },
    { nombre: 'cafe molido 1 kg', unidad: 'bolsa' as const }, { nombre: 'Té verde', unidad: 'caja' as const },
  ];
  assert.deepEqual(sugerirProductos('cafe', conocidos).map(p => p.nombre), ['Café molido 1 kg', 'Harina de café']);
  assert.deepEqual(sugerirProductos('molido kg', conocidos).map(p => p.nombre), ['Café molido 1 kg']);
  assert.deepEqual(sugerirProductos(' ', conocidos).map(p => p.nombre), ['Café molido 1 kg', 'Harina de café', 'Té verde'], 'sin nada escrito, los primeros por nombre');
});

test('"cocacola" encuentra "Coca-Cola 3 lts" y "Coca Cola lata 330 ml", sin importar guiones ni espacios', () => {
  const conocidos = [{ nombre: 'Coca-Cola 3 lts', unidad: 'botella' as const }, { nombre: 'Coca Cola lata 330 ml', unidad: 'unidad' as const }, { nombre: 'Fanta 3 lts', unidad: 'botella' as const }];
  assert.deepEqual(sugerirProductos('cocacola', conocidos).map(p => p.nombre), ['Coca-Cola 3 lts', 'Coca Cola lata 330 ml']);
});
