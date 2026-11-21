import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precioAjustado, precioDelProducto, precioPorVolumen, siguienteTramo, totalesDeCanasta, unidadesDe } from '../shared/precios.ts';

// Desordenados a propósito: el cálculo no depende del orden en que lleguen.
const tramos = [{ desde: 25, precioUnitario: 27_900 }, { desde: 1, precioUnitario: 32_000 }, { desde: 10, precioUnitario: 29_900 }];
const rollos = { tramos, precioSolo: 32_500, ofertas: [{ proveedorId: 'p', precioUnitario: 29_000 }] };

test('el precio por volumen es el del tramo alcanzado o, sin unidades, el de comprar solo', () => {
  assert.equal(precioPorVolumen(rollos, 0), 32_500);
  assert.equal(precioPorVolumen(rollos, 9), 32_000);
  assert.equal(precioPorVolumen(rollos, 10), 29_900);
  assert.equal(precioPorVolumen(rollos, 400), 27_900);
  assert.equal(precioPorVolumen({ tramos: [], precioSolo: undefined }, 3), undefined);
});

test('el siguiente tramo dice cuánto falta y puede exigir que baje el precio', () => {
  assert.deepEqual(siguienteTramo(tramos, 12), { desde: 25, precioUnitario: 27_900, faltan: 13 });
  assert.equal(siguienteTramo(tramos, 25), null);
  assert.deepEqual(siguienteTramo(tramos, 0, 32_000), { desde: 10, precioUnitario: 29_900, faltan: 10 });
});

test('la oferta del proveedor de la compra baja el precio, nunca lo sube, y solo con unidades', () => {
  assert.equal(precioDelProducto(rollos, 12, 'p'), 29_000);
  assert.equal(precioDelProducto(rollos, 30, 'p'), 27_900);
  assert.equal(precioDelProducto(rollos, 0, 'p'), 32_500);
  assert.equal(precioDelProducto(rollos, 12, 'otro'), 29_900);
});

test('unidades por producto y totales de la canasta', () => {
  const l = { participantes: [{ items: [{ productoId: 'a', cantidad: 2 }, { productoId: 'b', cantidad: 1 }] }, { items: [{ productoId: 'a', cantidad: 3 }] }, {}] };
  assert.equal(unidadesDe(l, 'a'), 5);
  assert.deepEqual(totalesDeCanasta([{ totalUnidades: 5, precioActual: 900, precioSolo: 1000 }, { totalUnidades: 1, precioActual: 500, precioSolo: 500 }]),
    { totalUnidades: 6, montoTotal: 5000, ahorroTotal: 500 });
});

test('el precio ajustado castiga la mala nota y el plazo largo', () => {
  assert.equal(precioAjustado({ precioUnitario: 17900, plazoDias: 2 }, 3.9), Math.round(17900 * 1.11 * 1.02));
  assert.equal(precioAjustado({ precioUnitario: 10000, plazoDias: 0 }, 5), 10000);
});
