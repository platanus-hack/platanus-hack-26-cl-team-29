// Stock declarado: al cerrar nunca se le asigna a un proveedor más que su stock (lo que sobra va a la siguiente mejor
// oferta), la pantalla sabe cuántas quedan y por WhatsApp se lee "tengo 200".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { leerStock, stockEnTexto, interpretarConReglas } from '../server/agente/intencion.ts';
import { errorDeProductoEscrito } from '../shared/catalogo.ts';
import { neto } from '../shared/precios.ts';

const TEL = { ana: '+56 9 1111 1111', beto: '+56 9 2222 2222', caro: '+56 9 3333 3333', dora: '+56 9 4444 4444' };

async function red() {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  return crearRed({ repo, sii: crearSiiFalso(), env: {} });
}

test('al cerrar, a quien tiene poco stock no se le asigna más: el resto va a la siguiente mejor oferta, y todos pagan el precio del grupo', async () => {
  const r = await red();
  const ana = await r.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1', nombre: 'Ana' });
  const beto = await r.registrarProveedor({ telefono: TEL.beto, rut: '22222222-2', nombre: 'Beto' });
  await r.ofertar(LICITACION_SALA, { proveedorId: ana.id, productoId: 'guantes', precioUnitario: 5_000, plazoDias: 1, stock: 4 });
  await r.ofertar(LICITACION_SALA, { proveedorId: beto.id, productoId: 'guantes', precioUnitario: 8_000, plazoDias: 1, stock: 10 });
  await r.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.caro, nombre: 'Kiosco Caro', rut: '33333333-3', productoId: 'guantes', cantidad: 6 });
  assert.equal(r.licitacionAbierta()!.productos.find(p => p.id === 'guantes')!.quedan, 8, 'quedan 14 - 6');
  const ordenes = await r.cerrarLicitacion(LICITACION_SALA);
  const porProveedor = Object.fromEntries(ordenes.map(o => [o.proveedorId, o.items.map(i => [i.cantidad, i.precioUnitario])]));
  assert.deepEqual(porProveedor, { [ana.id]: [[4, 8_000]], [beto.id]: [[2, 8_000]] });
});

test('el precio que ve el grupo con stock repartido es exactamente el que se factura', async () => {
  const r = await red();
  const ana = await r.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1', nombre: 'Ana' });
  const beto = await r.registrarProveedor({ telefono: TEL.beto, rut: '22222222-2', nombre: 'Beto' });
  await r.ofertar(LICITACION_SALA, { proveedorId: ana.id, productoId: 'guantes', precioUnitario: 5_000, plazoDias: 1, stock: 5 });
  await r.ofertar(LICITACION_SALA, { proveedorId: beto.id, productoId: 'guantes', precioUnitario: 7_000, plazoDias: 1 });
  const guantes = () => r.licitacionAbierta()!.productos.find(p => p.id === 'guantes')!;
  await r.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.caro, nombre: 'Kiosco Caro', rut: '33333333-3', productoId: 'guantes', cantidad: 4 });
  assert.equal(guantes().precioActual, 5_000, 'el stock de Ana alcanza');
  await r.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.dora, nombre: 'Almacén Dora', rut: '44444444-4', productoId: 'guantes', cantidad: 8 });
  const visto = guantes().precioActual;
  assert.equal(visto, 7_000, 'con 12 el stock de Ana no alcanza: el grupo paga lo de Beto');
  assert.equal(guantes().cubreElMejor, 5, 'la pantalla avisa cuántas cubre el mejor');
  const ordenes = await r.cerrarLicitacion(LICITACION_SALA);
  const lineas = ordenes.flatMap(o => o.items);
  assert.equal(lineas.reduce((s, i) => s + i.cantidad, 0), 12);
  assert.ok(lineas.every(i => i.precioUnitario === visto), 'cada línea al precio que vio el grupo');
  assert.equal(neto(lineas), 12 * visto);
});

test('sin stock declarado no hay tope ni "quedan"', async () => {
  const r = await red();
  const ana = await r.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1', nombre: 'Ana' });
  await r.ofertar(LICITACION_SALA, { proveedorId: ana.id, productoId: 'guantes', precioUnitario: 5_000, plazoDias: 1 });
  await r.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.caro, nombre: 'Kiosco Caro', rut: '33333333-3', productoId: 'guantes', cantidad: 30 });
  assert.equal(r.licitacionAbierta()!.productos.find(p => p.id === 'guantes')!.quedan, undefined);
  const [orden] = await r.cerrarLicitacion(LICITACION_SALA);
  assert.equal(orden!.items[0]!.cantidad, 30);
});

test('por WhatsApp: "tengo 200" junto al producto o solo, y el stock se valida', () => {
  const vendo = interpretarConReglas('vendo impresoras térmicas 58 mm a $15.000, tengo 200');
  assert.equal(vendo.tipo, 'crear_producto');
  assert.equal(vendo.tipo === 'crear_producto' && vendo.stock, 200);
  assert.doesNotMatch(vendo.tipo === 'crear_producto' ? vendo.nombre : '', /tengo/);
  assert.equal(stockEnTexto('vendo café a $12.000 la bolsa, tengo 1.500'), 1500);
  assert.deepEqual(leerStock('tengo 200 impresoras'), { cantidad: 200, producto: 'impresoras' });
  assert.deepEqual(leerStock('me quedan 50'), { cantidad: 50 });
  assert.equal(leerStock('vendo rollos a $5.000, tengo 20'), null, 'con precio es un producto nuevo, no solo stock');
  const base = { nombre: 'Rollos', unidad: 'caja', tramos: [{ desde: 1, precioUnitario: 5_000 }] };
  assert.equal(errorDeProductoEscrito({ ...base, stock: -1 }, []), 'El stock es una cantidad entera, 0 o más');
  assert.equal(errorDeProductoEscrito({ ...base, stock: 0 }, []), null);
});
