// Proveedores reales: la red sin datos ficticios, varios proveedores que compiten producto por producto,
// productos creados por un proveedor y la factura de cada ganador con su propio emisor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configDemo, crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

test('sin DEMO_FICTICIOS la red parte vacía: solo la compra conjunta abierta, sin proveedor fijo ni competencia', async () => {
  assert.equal(configDemo({}).ficticios, false);
  assert.equal(configDemo({ DEMO_COMPETENCIA: '1' }).competencia, false, 'los rivales ficticios necesitan DEMO_FICTICIOS');
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  await sembrarSiVacio(repo, new Date(), {}); // un segundo arranque no vuelve a sembrar
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const { negocios, licitaciones } = red.estadoDeLaRed();
  assert.deepEqual(negocios, []);
  assert.deepEqual(licitaciones.map(l => [l.id, l.estado, l.proveedorId]), [[LICITACION_SALA, 'abierta', undefined]]);
});
