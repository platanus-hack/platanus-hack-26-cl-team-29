import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, COMPRADOR_DEMO, PROVEEDOR_DEMO } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

test('las rutas /api/red recorren el ciclo de la orden y traducen errores a HTTP', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo);
  const app = express().use(express.json()).use('/api/red', crearRutasRed(await crearRed({ repo, sii: crearSiiFalso() })));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const post = (ruta: string, body: unknown = {}) =>
    fetch(url + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  try {
    const creada = await post('/ordenes', {
      compradorId: COMPRADOR_DEMO, proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'Harina 25 kg', cantidad: 5, precioUnitario: 18000 }],
    });
    assert.equal(creada.status, 201);
    const { id } = await creada.json();

    assert.equal((await post(`/ordenes/${id}/recepcion`, { conforme: true })).status, 409);
    assert.equal((await post(`/ordenes/${id}/confirmar`)).status, 200);
    assert.equal((await (await post(`/ordenes/${id}/recepcion`, { faltante: 2 })).json()).estado, 'reclamada');
    assert.equal((await (await post(`/ordenes/${id}/nota-credito`)).json()).tipo, 61);
    assert.equal((await post('/ordenes', { compradorId: 'x' })).status, 404);
    assert.equal((await post('/licitaciones/L-1/unirse', { nombre: 'Ana', cantidad: 0 })).status, 400);

    const estado = await (await fetch(`${url}/estado`)).json();
    assert.equal(estado.ordenes[0].estado, 'corregida');
    assert.ok(estado.notas[PROVEEDOR_DEMO] < 4.7);
  } finally {
    server.close();
  }
});
