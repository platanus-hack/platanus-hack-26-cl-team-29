import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aItems, carritoEnLaFoto, fijar, pistaTramo, productosDe, proyectar, una, type Carrito,
} from '../client/src/canal/carrito.ts';
import type { LicitacionCanal } from '../client/src/canal/tipos.ts';

const tramos = (l: Array<[number, number]>) => l.map(([desde, precioUnitario]) => ({ desde, precioUnitario }));

/** Canasta de dos productos sin derivados: el carrito los calcula desde los tramos. */
const licitacion = (): LicitacionCanal => ({
  id: 'L-1', producto: 'Caja de rollos', comuna: 'Santiago', cierraEn: new Date(Date.now() + 60_000).toISOString(), estado: 'abierta', ofertas: [],
  productos: [
    { id: 'rollos', nombre: 'Caja de rollos', unidad: 'caja', unidadPlural: 'cajas', precioSolo: 32_000, tramos: tramos([[1, 32_000], [10, 29_900], [25, 27_900]]) },
    { id: 'etiquetas', nombre: 'Rollo de etiquetas', unidad: 'rollo', unidadPlural: 'rollos', precioSolo: 6_900, tramos: tramos([[1, 6_900], [10, 6_400]]) },
  ],
  participantes: [
    { negocioId: 'n-1', cantidad: 8, items: [{ productoId: 'rollos', cantidad: 6 }, { productoId: 'etiquetas', cantidad: 2 }] },
    { negocioId: 'yo', cantidad: 15, items: [{ productoId: 'rollos', cantidad: 15 }] },
  ],
});

test('productos de la canasta: unidades, precio y próximo tramo calculados desde los carritos', () => {
  const [rollos, etiquetas] = productosDe(licitacion());
  assert.equal(rollos.totalUnidades, 21);
  assert.equal(rollos.precioActual, 29_900);
  assert.deepEqual(rollos.siguienteTramo, { desde: 25, precioUnitario: 27_900, faltan: 4 });
  assert.equal(etiquetas.precioActual, 6_900);
  assert.equal(etiquetas.siguienteTramo?.faltan, 8);
});

test('pista del próximo tramo con plural y singular correctos', () => {
  const [rollos, etiquetas] = productosDe(licitacion());
  assert.equal(pistaTramo(rollos.siguienteTramo, rollos), 'Faltan 4 cajas para bajar a $27.900');
  assert.equal(pistaTramo({ desde: 10, precioUnitario: 6_400, faltan: 1 }, etiquetas), 'Falta 1 rollo para bajar a $6.400');
  assert.equal(pistaTramo(null, rollos), '');
  assert.equal(una(rollos), 'Una caja');
  assert.equal(una(etiquetas), 'Un rollo');
});

test('mi cambio sin guardar proyecta el precio del grupo y respeta una oferta bajo el tramo', () => {
  const [rollos] = productosDe(licitacion());
  const mas4 = proyectar(rollos, 4);
  assert.equal(mas4.precio, 27_900);
  assert.equal(mas4.unidades, 25);
  assert.equal(proyectar(rollos, -12).precio, 32_000);
  // El proveedor ofertó 29.000 (bajo el tramo de 29.900): quitar unidades no sube sobre esa oferta.
  const conOferta = { ...rollos, precioActual: 29_000 };
  assert.equal(proyectar(conOferta, -1).precio, 29_000);
  assert.equal(proyectar(conOferta, 4).precio, 27_900);
});

test('fijar no pone tope real (25 queda en 25), 0 quita el producto, e ítems en el orden de la canasta', () => {
  let c: Carrito = {};
  c = fijar(c, 'etiquetas', 3);
  c = fijar(c, 'rollos', 25);
  assert.deepEqual(aItems(c, ['rollos', 'etiquetas']), [{ productoId: 'rollos', cantidad: 25 }, { productoId: 'etiquetas', cantidad: 3 }]);
  assert.deepEqual(fijar(c, 'etiquetas', 0), { rollos: 25 });
});

