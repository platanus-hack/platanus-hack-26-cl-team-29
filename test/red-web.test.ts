import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, PROVEEDOR_DEMO, PROVEEDOR_SALA } from '../server/red/index.ts';
import type { Red } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { buzonDeCodigos, tokenConCodigo } from './acceso-apoyo.ts';


const ENV = { DEMO_TOKEN: 'token-de-prueba', DEMO_WHATSAPP_NUMERO: '+56 9 0000 0000' };
const TELEFONO_SALA = '+56 9 7777 0000';

async function servidor(env: NodeJS.ProcessEnv = ENV, limitePorMinuto?: number) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), { DEMO_FICTICIOS: '1', DEMO_TELEFONO_PROVEEDOR: TELEFONO_SALA });
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const buzon = buzonDeCodigos();
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, env, { limitePorMinuto, enviarCodigo: buzon.enviarCodigo }));
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
  let compradores = 0;
  return {
    red, server, url, buzon,
    /** Un teléfono y un RUT nuevos por comprador: un RUT queda con el WhatsApp con que se registró. */
    siguiente: () => ++compradores,
    post: (ruta: string, body: unknown = {}, token?: string) => pedir('POST', ruta, body, token),
    get: (ruta: string, token?: string) => pedir('GET', ruta, undefined, token),
  };
}

function entrar(s: Awaited<ReturnType<typeof servidor>>, nombre: string): Promise<string> {
  const n = s.siguiente();
  return tokenConCodigo(s.post, s.buzon, `+56 9 5555 000${n}`, { nombre, rut: `${n}${n}.${n}${n}${n}.${n}${n}${n}-${n}` });
}

const entrarAlPanel = (s: Awaited<ReturnType<typeof servidor>>) => tokenConCodigo(s.post, s.buzon, TELEFONO_SALA);

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
    assert.equal((await s.get('/proveedor/yo', ana)).status, 403, 'quien solo compra no entra al panel del proveedor');

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

test('el panel del proveedor entra con el WhatsApp de la empresa y exige confirmado para facturar la compra conjunta', async () => {
  const s = await servidor();
  try {
    const prov = await entrarAlPanel(s);
    assert.equal((await s.get('/proveedor/yo', prov)).cuerpo.negocio.id, PROVEEDOR_SALA);

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
    s.server.close();
  }
});

test('config pública, confirmación de escenario con DEMO_TOKEN y límite por RUT (no por IP)', async () => {
  const s = await servidor(ENV, 3);
  try {
    const { productos, ...compat } = (await s.get('/config')).cuerpo;
    assert.deepEqual(compat, {
      whatsappNumero: '56900000000', proveedorLogoUrl: null, producto: 'Caja de rollos térmicos 80 mm (50 un.)', unidad: 'caja', unidadPlural: 'cajas',
    });
    assert.equal(productos.length, 4);
    const union = await s.post('/licitaciones/L-1/unirse', { nombre: 'Ana', rut: '22222222-2', cantidad: 2, telefono: '56911112222', negocioId: 'n-pica-nunoa' });
    assert.equal(union.status, 200);
    assert.notEqual(union.cuerpo.participante.negocioId, 'n-pica-nunoa', 'la página pública no acepta negocioId ni teléfono');
    assert.equal(s.red.negocioPorTelefono('56911112222'), null);

    await s.red.cerrarLicitacion('L-1');
    assert.equal((await s.post('/licitaciones/L-1/confirmar')).status, 403);
    const r = await fetch(`${s.url}/licitaciones/L-1/confirmar`, { method: 'POST', headers: { 'x-demo-token': 'token-de-prueba' } });
    assert.equal(r.status, 200);

    // El límite es por RUT, nunca por IP: toda la sala entra por el mismo wifi.
    const sumarse = (rut: string) => s.post('/licitaciones/L-2/unirse', { nombre: 'Vecino', rut, cantidad: 1 });
    for (const rut of ['44444444-4', '55555555-5', '66666666-6', '77777777-7']) assert.notEqual((await sumarse(rut)).status, 429);
    for (let i = 0; i < 3; i++) assert.notEqual((await sumarse('33.333.333-3')).status, 429);
    const tope = await sumarse('33333333-3');
    assert.equal(tope.status, 429);
    assert.match(tope.cuerpo.mensaje, /Espera un momento/);
  } finally {
    s.server.close();
  }
});

test('el carrito y las acciones del proveedor tienen tope por sesión, y un negocio no frena a otro', async () => {
  const s = await servidor();
  try {
    const ana = await entrar(s, 'Ana');
    const beto = await entrar(s, 'Beto');
    const items = [{ productoId: 'rollos', cantidad: 1 }];
    let ultimo = 0;
    for (let i = 0; i < 301; i++) ultimo = (await pedirPut(s, '/yo/carrito', { licitacionId: 'L-1', items }, ana)).status;
    assert.equal(ultimo, 429);
    assert.notEqual((await pedirPut(s, '/yo/carrito', { licitacionId: 'L-1', items }, beto)).status, 429);

    const prov = await entrarAlPanel(s);
    const estados: number[] = [];
    for (let i = 0; i < 31; i++) estados.push((await s.post('/proveedor/ordenes/no-existe/confirmar', { confirmado: true }, prov)).status);
    assert.equal(estados[0], 404);
    assert.equal(estados.at(-1), 429);
  } finally {
    s.server.close();
  }
});

const pedirPut = async (s: Awaited<ReturnType<typeof servidor>>, ruta: string, body: unknown, token: string) =>
  fetch(s.url + ruta, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

test('el proveedor suma un producto a la compra en grupo desde la web, con tramos que salen del precio', async () => {
  const s = await servidor();
  try {
    const prov = await entrarAlPanel(s);
    const r = await s.post('/proveedor/licitacion/L-1/productos', { nombre: 'Café molido 1 kg', unidad: 'Bolsa', precio: 12000 }, prov);
    assert.equal(r.status, 201);
    assert.deepEqual([r.cuerpo.producto.nombre, r.cuerpo.producto.unidad, r.cuerpo.producto.tramos[0].precioUnitario], ['Café molido 1 kg', 'bolsa', 12000]);
    assert.equal((await s.post('/proveedor/licitacion/L-1/productos', { nombre: 'cafe molido 1 kg', unidad: 'bolsa', precio: 11000 }, prov)).status, 400);
    const ana = await entrar(s, 'Ana');
    assert.equal((await s.post('/proveedor/licitacion/L-1/productos', { nombre: 'Té verde', unidad: 'caja', precio: 5000 }, ana)).status, 403);
  } finally {
    s.server.close();
  }
});

test('sin compra abierta, el proveedor abre una nueva desde la web con su producto y su duración', async () => {
  const s = await servidor();
  try {
    const prov = await entrarAlPanel(s);
    const cuerpo = { nombre: 'Etiquetas adhesivas', unidad: 'rollo', precio: 2000, minutos: 60 };
    assert.equal((await s.post('/proveedor/compras', cuerpo, prov)).status, 400, 'con una abierta, se suma a ella');
    await s.post('/proveedor/licitacion/L-1/cerrar', {}, prov);
    const antes = Date.now();
    const r = await s.post('/proveedor/compras', cuerpo, prov);
    assert.equal(r.status, 201);
    assert.deepEqual([r.cuerpo.id, r.cuerpo.estado, r.cuerpo.productos[0].nombre], ['L-2', 'abierta', 'Etiquetas adhesivas']);
    assert.ok(Math.abs(Date.parse(r.cuerpo.cierraEn) - antes - 60 * 60_000) < 5000);
    assert.equal(s.red.licitacionAbierta()?.id, 'L-2');
  } finally {
    s.server.close();
  }
});
