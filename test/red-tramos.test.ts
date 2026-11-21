import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, COMPETIDORES_SALA, PROVEEDOR_SALA } from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { errorDeTramos } from '../shared/precios.ts';

const ENV = { DEMO_FICTICIOS: '1', DEMO_TELEFONO_PROVEEDOR: '+56 9 0000 0099' };
const t = (...p: [number, number][]) => p.map(([desde, precioUnitario]) => ({ desde, precioUnitario }));

/** La sala sembrada con un negocio que pide 12 cajas de rollos (tramo desde 10, a $29.900). */
async function salaCon12() {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), ENV);
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: ENV });
  await red.unirseALicitacion('L-1', { telefono: '56991000001', nombre: 'N1', cantidad: 12 });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos };
}

test('errorDeTramos: desde 1, sin repetidos, precios que no suben y sin subirle el precio al grupo', () => {
  assert.equal(errorDeTramos(t([1, 1000], [10, 900], [50, 800])), null);
  assert.match(errorDeTramos(t([5, 1000]))!, /desde 1/);
  assert.match(errorDeTramos(t([1, 1000], [10, 900], [10, 850]))!, /dos tramos/);
  assert.match(errorDeTramos(t([1, 1000], [10, 1100]))!, /no puede costar más/);
  assert.match(errorDeTramos(t([1, 0]))!, /entero positivo/);
  assert.match(errorDeTramos([])!, /entre 1/);
  // El grupo tiene 12 unidades a $900: subir ese tramo a $950 no se puede; bajarlo sí.
  assert.match(errorDeTramos(t([1, 1000], [10, 950]), { unidades: 12, precio: 900 })!, /no puede subir/);
  assert.equal(errorDeTramos(t([1, 1000], [10, 850]), { unidades: 12, precio: 900 }), null);
});

test('el dueño cambia los tramos de su producto: emite licitacion.producto y precio_bajo si baja', async () => {
  const { red, eventos } = await salaCon12();
  const nuevos = t([1, 32_000], [10, 28_000], [40, 24_000]);
  const { producto } = await red.fijarTramos('L-1', 'rollos', PROVEEDOR_SALA, nuevos);
  assert.deepEqual(producto.tramos, nuevos);
  assert.equal(producto.precioActual, 28_000);
  const cambio = eventos.find(e => e.tipo === 'licitacion.producto');
  assert.equal((cambio?.datos as { cambio?: string }).cambio, 'tramos');
  const baja = eventos.find(e => e.tipo === 'licitacion.precio_bajo');
  assert.deepEqual(baja?.datos, { licitacionId: 'L-1', productoId: 'rollos', precioAnterior: 29_900, precioNuevo: 28_000, totalUnidades: 12 });
});

test('otro proveedor no cambia los tramos y el dueño no le sube el precio al grupo', async () => {
  const { red } = await salaCon12();
  await assert.rejects(red.fijarTramos('L-1', 'rollos', COMPETIDORES_SALA[0].id, t([1, 32_000], [10, 29_000])), { codigo: 'prohibido' });
  await assert.rejects(red.fijarTramos('L-1', 'rollos', PROVEEDOR_SALA, t([1, 32_000], [10, 30_500])), { codigo: 'datos_invalidos' });
});
