import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aItems, carritoEnLaFoto, crearEnvio, fijar, pistaTramo, productosDe, proyectar, resumirCarrito, una, type Carrito,
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

test('totales y ahorro del carrito, con el precio proyectado', () => {
  const lic = licitacion();
  const productos = productosDe(lic);
  const guardado = carritoEnLaFoto(lic, 'yo')!;
  assert.deepEqual(guardado, { rollos: 15 });
  const r = resumirCarrito(productos, guardado);
  assert.deepEqual(r, { productos: 1, unidades: 15, total: 15 * 29_900, ahorro: 15 * 2_100 });
  // Subo a 19 cajas (el grupo llega a 25) y agrego 2 rollos de etiquetas.
  const nuevo = fijar(fijar(guardado, 'rollos', 19), 'etiquetas', 2);
  const r2 = resumirCarrito(productos, nuevo, guardado);
  assert.equal(r2.total, 19 * 27_900 + 2 * 6_900);
  assert.equal(r2.ahorro, 19 * 4_100);
  assert.equal(r2.productos, 2);
});

test('fijar limita entre 0 y 20, 0 quita el producto, e ítems en el orden de la canasta', () => {
  let c: Carrito = {};
  c = fijar(c, 'etiquetas', 3);
  c = fijar(c, 'rollos', 25);
  assert.deepEqual(aItems(c, ['rollos', 'etiquetas']), [{ productoId: 'rollos', cantidad: 20 }, { productoId: 'etiquetas', cantidad: 3 }]);
  assert.deepEqual(fijar(c, 'etiquetas', 0), { rollos: 20 });
});

test('envío diferido: toques seguidos se juntan en un solo PUT con el último carrito', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const enviados: Carrito[] = [];
    const e = crearEnvio({ inicial: {}, esperaMs: 400, enviar: async c => { enviados.push(c); } });
    e.cambiar({ rollos: 1 });
    mock.timers.tick(200);
    e.cambiar({ rollos: 2 });
    mock.timers.tick(200);
    e.cambiar({ rollos: 3 });
    assert.equal(enviados.length, 0);
    mock.timers.tick(400);
    await Promise.resolve();
    assert.deepEqual(enviados, [{ rollos: 3 }]);
    await Promise.resolve();
    assert.equal(e.pendiente(), false);
    assert.deepEqual(e.guardado(), { rollos: 3 });
  } finally {
    mock.timers.reset();
  }
});

test('envío diferido: si falla, vuelve a lo último guardado', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let fallos = 0;
    const e = crearEnvio({
      inicial: { rollos: 2 }, esperaMs: 400,
      enviar: async () => { throw new Error('sin conexión'); },
      alFallar: (c, err) => { fallos += 1; assert.deepEqual(c, { rollos: 2 }); assert.equal((err as Error).message, 'sin conexión'); },
    });
    e.cambiar({ rollos: 5 });
    mock.timers.tick(400);
    await new Promise(r => setImmediate(r));
    assert.equal(fallos, 1);
    assert.equal(e.pendiente(), false);
    assert.deepEqual(e.guardado(), { rollos: 2 });
    // Lo que llega del servidor solo se aplica sin cambios pendientes.
    assert.equal(e.sincronizar({ rollos: 4 }), true);
    e.cambiar({ rollos: 6 });
    assert.equal(e.sincronizar({ rollos: 1 }), false);
  } finally {
    mock.timers.reset();
  }
});

test('envío diferido: un cambio mientras viaja otro se manda al volver, nunca dos a la vez', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const enviados: Carrito[] = [];
    let soltar: () => void = () => {};
    let enVuelo = 0;
    const e = crearEnvio({
      inicial: {}, esperaMs: 400,
      enviar: c => { enviados.push(c); enVuelo += 1; assert.equal(enVuelo, 1); return new Promise<void>(r => { soltar = () => { enVuelo -= 1; r(); }; }); },
    });
    e.cambiar({ rollos: 1 });
    mock.timers.tick(400);
    e.cambiar({ rollos: 2 });
    mock.timers.tick(400);
    assert.equal(enviados.length, 1);
    soltar();
    await new Promise(r => setImmediate(r));
    assert.deepEqual(enviados, [{ rollos: 1 }, { rollos: 2 }]);
    soltar();
    await new Promise(r => setImmediate(r));
    assert.deepEqual(e.guardado(), { rollos: 2 });
    assert.equal(e.pendiente(), false);
  } finally {
    mock.timers.reset();
  }
});
