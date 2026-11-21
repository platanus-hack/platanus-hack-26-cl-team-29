import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, PROVEEDOR_DEMO, PROVEEDOR_SALA } from '../server/red/index.ts';
import type { Red } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

const ENV = { PROVEEDOR_CODIGO: 'codigo-de-prueba', DEMO_TOKEN: 'token-de-prueba', DEMO_WHATSAPP_NUMERO: '+56 9 0000 0000' };

async function servidor(env: NodeJS.ProcessEnv = ENV, limitePorMinuto?: number) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, env, { limitePorMinuto }));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const pedir = async (metodo: string, ruta: string, body?: unknown, token?: string) => {
    const r = await fetch(url + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };
  return {
    red, server, url,
    post: (ruta: string, body: unknown = {}, token?: string) => pedir('POST', ruta, body, token),
    get: (ruta: string, token?: string) => pedir('GET', ruta, undefined, token),
  };
}

async function entrar(s: Awaited<ReturnType<typeof servidor>>, nombre: string): Promise<string> {
  const r = await s.post('/sesion', { nombre });
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.negocio.telefono, undefined);
  return r.cuerpo.token;
}

test('sin sesión o con un token falso la web no deja hacer nada, y nadie actúa sobre órdenes ajenas', async () => {
  const s = await servidor();
  try {
    assert.equal((await s.get('/yo')).status, 401);
    assert.equal((await s.get('/yo', 'inventado')).status, 401);
    assert.equal((await s.post('/yo/unirse', { licitacionId: 'L-1', cantidad: 1 })).status, 401);

    const ana = await entrar(s, 'Ana');
    const beto = await entrar(s, 'Beto');
    const creada = await s.post('/yo/ordenes', { proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'harina', cantidad: 2 }] }, ana);
    assert.equal(creada.status, 201);
    const ordenId = creada.cuerpo.id;
    await s.red.confirmarOrden(ordenId);

    assert.equal((await s.post(`/yo/ordenes/${ordenId}/recepcion`, { faltante: 1, confirmado: true }, beto)).status, 403);
    assert.equal((await s.post('/yo/ordenes/OC-NO-EXISTE/recepcion', { conforme: true, confirmado: true }, ana)).status, 404);
    assert.equal((await s.get('/proveedor/yo', ana)).status, 401, 'un comprador no entra al panel del proveedor');

    const sinConfirmar = await s.post(`/yo/ordenes/${ordenId}/recepcion`, { faltante: 1 }, ana);
    assert.deepEqual([sinConfirmar.status, sinConfirmar.cuerpo.error], [400, 'confirmacion_requerida']);
    assert.equal(s.red.estadoDeLaRed().ordenes.find(o => o.id === ordenId)?.estado, 'facturada', 'sin confirmación no se toca el SII');
    const reclamo = await s.post(`/yo/ordenes/${ordenId}/recepcion`, { faltante: 1, confirmado: true }, ana);
    assert.equal(reclamo.cuerpo.estado, 'reclamada');

    const mio = await s.get('/yo', ana);
    assert.deepEqual([mio.cuerpo.ordenes.length, mio.cuerpo.documentos.length], [1, 2]);
    assert.equal((await s.get('/yo', beto)).cuerpo.ordenes.length, 0);
  } finally {
    s.server.close();
  }
});

test('paridad: sumarse por la web y por WhatsApp deja el mismo estado, y volver a sumarse cambia la cantidad', async () => {
  const s = await servidor();
  try {
    const ana = await entrar(s, 'Ana');
    await s.post('/yo/unirse', { licitacionId: 'L-1', cantidad: 2 }, ana);
    const web = await s.post('/yo/unirse', { licitacionId: 'L-1', cantidad: 4 }, ana);
    const whatsapp = async (red: Red) => {
      await red.unirseALicitacion('L-1', { telefono: '56911112222', nombre: 'Beto', cantidad: 2 });
      return red.unirseALicitacion('L-1', { telefono: '56911112222', nombre: 'Beto', cantidad: 4 });
    };
    const porWhatsapp = await whatsapp(s.red);

    const forma = (p: Record<string, unknown>) => Object.keys(p).sort();
    assert.deepEqual(forma(web.cuerpo.participante), forma(porWhatsapp.participante as never));
    assert.equal(web.cuerpo.participante.cantidad, 4);
    const l = s.red.licitacionAbierta()!;
    assert.deepEqual(l.participantes.map(p => [p.nombre, p.cantidad, typeof p.negocioId]), [['Ana', 4, 'string'], ['Beto', 4, 'string']]);
    assert.deepEqual((await s.get('/yo', ana)).cuerpo.participaciones.map((p: { cantidad: number }) => p.cantidad), [4]);
  } finally {
    s.server.close();
  }
});

test('el panel del proveedor exige su código y confirmado para facturar la compra conjunta', async () => {
  const sinCodigo = await servidor({});
  const s = await servidor();
  try {
    assert.equal((await sinCodigo.post('/proveedor/sesion', { codigo: 'x' })).status, 404);
    assert.equal((await s.post('/proveedor/sesion', { codigo: 'otro' })).status, 401);
    const entrada = await s.post('/proveedor/sesion', { codigo: 'codigo-de-prueba' });
    assert.equal(entrada.cuerpo.negocio.id, PROVEEDOR_SALA);
    const prov = entrada.cuerpo.token;

    const ana = await entrar(s, 'Ana');
    await s.post('/yo/unirse', { licitacionId: 'L-1', cantidad: 10 }, ana);
    const panel = await s.get('/proveedor/yo', prov);
    assert.deepEqual([panel.cuerpo.compraAbierta.totalUnidades, panel.cuerpo.compraAbierta.precioActual], [10, 29900]);

    const ordenes = await s.post('/proveedor/licitacion/L-1/cerrar', {}, prov);
    assert.equal(ordenes.cuerpo.length, 1);
    assert.equal((await s.post('/proveedor/licitacion/L-1/facturar', {}, prov)).status, 400);
    const facturas = await s.post('/proveedor/licitacion/L-1/facturar', { confirmado: true }, prov);
    assert.deepEqual(facturas.cuerpo.map((d: { tipo: number }) => d.tipo), [33]);
    assert.equal((await s.get('/yo', ana)).cuerpo.documentos.length, 1);

    const ajena = await s.red.crearOrden({ compradorId: 'n-pica-nunoa', proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'harina', cantidad: 1 }] });
    assert.equal((await s.post(`/proveedor/ordenes/${ajena.id}/confirmar`, { confirmado: true }, prov)).status, 403);
  } finally {
    sinCodigo.server.close();
    s.server.close();
  }
});

test('config pública, confirmación de escenario con DEMO_TOKEN y límite por IP', async () => {
  const s = await servidor(ENV, 3);
  try {
    assert.deepEqual((await s.get('/config')).cuerpo, {
      whatsappNumero: '56900000000', producto: 'Caja de rollos térmicos 80 mm (50 un.)', unidad: 'caja', unidadPlural: 'cajas',
    });
    const union = await s.post('/licitaciones/L-1/unirse', { nombre: 'Ana', cantidad: 2, telefono: '56911112222', negocioId: 'n-pica-nunoa' });
    assert.equal(union.status, 200);
    assert.equal(union.cuerpo.participante.negocioId, undefined, 'la página pública no acepta negocioId ni teléfono');
    assert.equal(s.red.negocioPorTelefono('56911112222'), null);

    await s.red.cerrarLicitacion('L-1');
    assert.equal((await s.post('/licitaciones/L-1/confirmar')).status, 403);
    const r = await fetch(`${s.url}/licitaciones/L-1/confirmar`, { method: 'POST', headers: { 'x-demo-token': 'token-de-prueba' } });
    assert.equal(r.status, 200);

    await s.post('/sesion', { nombre: 'B' });
    await s.post('/sesion', { nombre: 'C' });
    assert.equal((await s.post('/sesion', { nombre: 'D' })).status, 429);
  } finally {
    s.server.close();
  }
});
