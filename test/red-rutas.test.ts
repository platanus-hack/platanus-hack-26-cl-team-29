import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, COMPRADOR_DEMO, PROVEEDOR_DEMO } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

// Estos tests recorren la demo con sus negocios ficticios (sin DEMO_FICTICIOS la red parte vacía).
process.env.DEMO_FICTICIOS = '1';

test('sin sesión no se cambian datos: las rutas viejas no existen y cerrar exige DEMO_TOKEN', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo);
  const red = await crearRed({ repo, sii: crearSiiFalso() });
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, { DEMO_TOKEN: 'secreto-de-prueba' }));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const post = (ruta: string, body: unknown = {}, token?: string) => fetch(url + ruta, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-demo-token': token } : {}) }, body: JSON.stringify(body),
  });

  try {
    const orden = await red.crearOrden({
      compradorId: COMPRADOR_DEMO, proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'Harina 25 kg', cantidad: 5, precioUnitario: 18000 }],
    });
    for (const ruta of ['/ordenes', `/ordenes/${orden.id}/despacho`, `/ordenes/${orden.id}/confirmar`, `/ordenes/${orden.id}/recepcion`,
      `/ordenes/${orden.id}/nota-credito`, '/licitaciones/L-1/ofertas', '/licitaciones/L-1/unirse']) {
      assert.equal((await post(ruta, { conforme: true, nombre: 'Ana', rut: '22222222-2', cantidad: 1 })).status, 404, ruta);
    }
    assert.equal(red.estadoPublico().ordenes.find(o => o.id === orden.id)?.estado, orden.estado, 'nada cambió la orden');

    assert.equal((await post('/licitaciones/L-1/cerrar')).status, 403);
    assert.equal((await post('/licitaciones/L-1/cerrar', {}, 'otro')).status, 403);
    assert.equal(red.estadoPublico().licitaciones[0].estado, 'abierta');
    assert.equal((await post('/licitaciones/L-1/cerrar', {}, 'secreto-de-prueba')).status, 200);
    assert.equal(red.estadoPublico().licitaciones[0].estado, 'cerrada');
  } finally {
    server.close();
  }
});

test('el reinicio de la demo no existe sin DEMO_TOKEN y exige el token correcto', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo);
  const red = await crearRed({ repo, sii: crearSiiFalso() });
  const conToken = express().use(express.json()).use('/api/red', crearRutasRed(red, { DEMO_TOKEN: 'secreto-de-prueba' }));
  const sinToken = express().use(express.json()).use('/api/red', crearRutasRed(red, {}));
  const servidores = [conToken.listen(0), sinToken.listen(0)];
  const [urlCon, urlSin] = servidores.map(s => `http://localhost:${(s.address() as AddressInfo).port}/api/red/demo/reiniciar`);
  const reiniciar = (url: string, token?: string) => fetch(url, { method: 'POST', headers: token ? { 'x-demo-token': token } : {} });

  try {
    await red.unirseALicitacion('L-1', { nombre: 'Ana', cantidad: 1 });
    assert.equal((await reiniciar(urlSin, 'secreto-de-prueba')).status, 404);
    assert.equal((await reiniciar(urlCon)).status, 403);
    assert.equal((await reiniciar(urlCon, 'otro')).status, 403);
    const ok = await reiniciar(urlCon, 'secreto-de-prueba');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).licitaciones[0].participantes.length, 0);
  } finally {
    for (const s of servidores) s.close();
  }
});

test('operación con DEMO_TOKEN: abre una sesión como un negocio y nada sin el token', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo);
  const red = await crearRed({ repo, sii: crearSiiFalso() });
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, { DEMO_TOKEN: 'secreto-de-prueba' }));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const sesion = (body: unknown, token?: string) => fetch(`${url}/operacion/sesion`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-demo-token': token } : {}) }, body: JSON.stringify(body),
  });

  try {
    assert.equal((await sesion({ negocioId: PROVEEDOR_DEMO })).status, 403);
    assert.equal((await sesion({ negocioId: PROVEEDOR_DEMO }, 'otro')).status, 403);
    assert.equal((await sesion({ negocioId: 'no-existe' }, 'secreto-de-prueba')).status, 404);
    const r = await sesion({ negocioId: PROVEEDOR_DEMO }, 'secreto-de-prueba');
    assert.equal(r.status, 201);
    const { token } = await r.json() as { token: string };
    const yo = await fetch(`${url}/proveedor/yo`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(yo.status, 200, 'la sesión sirve para la API del proveedor');
  } finally {
    server.close();
  }
});
