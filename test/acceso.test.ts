import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSesiones, crearSiiFalso, RUT_DE_OTRO_TELEFONO } from '../server/red/index.ts';
import { crearCodigosAcceso, DURACION_CODIGO_MS, INTENTOS_POR_CODIGO } from '../server/red/acceso.ts';
import { DURACION_SESION_MS } from '../server/red/sesiones.ts';
import type { EnvioCodigo } from '../server/red/rutas-web.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { telefonoParaWhatsapp } from '../shared/telefono.ts';
import { buzonDeCodigos, entrarConCodigo, tokenConCodigo } from './acceso-apoyo.ts';

const ANA = '+56 9 1111 1111';
const BETO = '9 2222 2222';

async function servidor(enviar?: (telefono: string, texto: string) => Promise<EnvioCodigo>) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), { DEMO_FICTICIOS: '1' });
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const buzon = buzonDeCodigos();
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, {}, { enviarCodigo: enviar ?? buzon.enviarCodigo }));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const pedir = async (metodo: string, ruta: string, body?: unknown, token?: string) => {
    const r = await fetch(url + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, cuerpo: r.status === 204 ? {} : await r.json() };
  };
  const post = (ruta: string, body: unknown, token?: string) => pedir('POST', ruta, body, token);
  return { red, server, buzon, post, get: (ruta: string, token?: string) => pedir('GET', ruta, undefined, token) };
}

test('el número de WhatsApp se entiende con o sin +56, y uno que no es teléfono no', () => {
  for (const t of ['+56 9 1234 5678', '56912345678', '9 1234 5678', '1234 5678']) assert.equal(telefonoParaWhatsapp(t), '56912345678', t);
  assert.equal(telefonoParaWhatsapp('+1 (208) 482-8247'), '12084828247');
  for (const t of ['', '123', '+56 2 2123 4567', 'hola']) assert.equal(telefonoParaWhatsapp(t), null, t);
});

test('un código vale una vez, vence a los 10 minutos y se anula tras varios intentos fallidos', () => {
  let ahora = 0;
  const codigos = crearCodigosAcceso(() => ahora);
  const tel = '56911111111';
  const codigo = codigos.generar(tel);
  assert.match(codigo, /^\d{6}$/);
  assert.equal(codigos.verificar('56922222222', codigo), 'vencido', 'es de un solo teléfono');
  assert.equal(codigos.verificar(tel, codigo), 'ok');
  codigos.consumir(tel);
  assert.equal(codigos.verificar(tel, codigo), 'vencido', 'no se reusa');

  const otro = codigos.generar(tel);
  const malo = otro === '000000' ? '111111' : '000000';
  for (let i = 1; i < INTENTOS_POR_CODIGO; i++) assert.equal(codigos.verificar(tel, malo), 'incorrecto');
  assert.equal(codigos.verificar(tel, malo), 'incorrecto');
  assert.equal(codigos.verificar(tel, otro), 'vencido', 'tras el último intento fallido, ni el correcto sirve');

  const tercero = codigos.generar(tel);
  ahora += DURACION_CODIGO_MS;
  assert.equal(codigos.verificar(tel, tercero), 'vencido');
});

test('la sesión dura 90 días desde el último uso y salir la revoca', () => {
  let ahora = 0;
  const sesiones = crearSesiones(() => ahora);
  const token = sesiones.crear({ negocioId: 'n-1' });
  ahora += DURACION_SESION_MS - 1;
  assert.deepEqual(sesiones.buscar(token), { negocioId: 'n-1' }, 'usarla la extiende');
  ahora += DURACION_SESION_MS - 1;
  assert.ok(sesiones.buscar(token));
  ahora += DURACION_SESION_MS;
  assert.equal(sesiones.buscar(token), null, 'sin uso, vence');

  const otra = sesiones.crear({ negocioId: 'n-1' });
  sesiones.revocar(otra);
  assert.equal(sesiones.buscar(otra), null);
});

test('un número nuevo entra con el código y se registra con su nombre y RUT; el código no sirve dos veces', async () => {
  const s = await servidor();
  try {
    assert.equal((await s.post('/acceso/codigo', { telefono: 'hola' })).status, 400);
    const sinDatos = await entrarConCodigo(s.post, s.buzon, ANA);
    assert.deepEqual([sinDatos.status, sinDatos.cuerpo], [200, { registro: true }], 'pide registrarse sin gastar el código');
    const malo = await s.post('/acceso/entrar', { telefono: ANA, codigo: s.buzon.ultimo(ANA) === '000000' ? '111111' : '000000', nombre: 'Ana', rut: '11.111.111-1' });
    assert.equal(malo.status, 401);

    const entrada = await s.post('/acceso/entrar', { telefono: ANA, codigo: s.buzon.ultimo(ANA), nombre: 'Almacén Ana', rut: '11.111.111-1' });
    assert.equal(entrada.status, 201);
    assert.equal(entrada.cuerpo.negocio.nombre, 'Almacén Ana');
    assert.equal(entrada.cuerpo.negocio.telefono, undefined, 'el teléfono no vuelve en la respuesta');
    assert.equal(s.red.negocioPorTelefono(ANA)?.id, entrada.cuerpo.negocio.id, 'el negocio queda con su WhatsApp');
    assert.equal((await s.get('/yo', entrada.cuerpo.token)).status, 200);
    assert.equal((await s.post('/acceso/entrar', { telefono: ANA, codigo: s.buzon.ultimo(ANA) })).status, 401, 'el código ya se usó');

    // Con otro código entra al mismo negocio, sin volver a registrarse; salir revoca solo esa sesión.
    const otra = await tokenConCodigo(s.post, s.buzon, ANA);
    assert.equal((await s.get('/yo', otra)).cuerpo.negocio.id, entrada.cuerpo.negocio.id);
    assert.equal((await s.post('/acceso/salir', {}, otra)).status, 204);
    assert.equal((await s.get('/yo', otra)).status, 401);
    assert.equal((await s.get('/yo', entrada.cuerpo.token)).status, 200);
  } finally {
    s.server.close();
  }
});

test('antes de registrarse, el RUT trae sus datos del SII con el código vigente, sin gastarlo ni mostrar teléfonos', async () => {
  const s = await servidor();
  try {
    await tokenConCodigo(s.post, s.buzon, BETO, { nombre: 'Almacén Beto', rut: '22.222.222-2' });
    assert.equal((await s.post('/acceso/codigo', { telefono: ANA })).status, 200);
    const codigo = s.buzon.ultimo(ANA);
    assert.equal((await s.post('/acceso/rut', { telefono: ANA, codigo: codigo === '000000' ? '111111' : '000000', rut: '11.111.111-1' })).status, 401, 'sin el código correcto no consulta');

    const datos = await s.post('/acceso/rut', { telefono: ANA, codigo, rut: '11111111-1' });
    assert.equal(datos.status, 200, JSON.stringify(datos.cuerpo));
    assert.equal(datos.cuerpo.rut, '11.111.111-1');
    assert.ok(datos.cuerpo.razonSocial, 'trae la razón social');
    assert.ok(!JSON.stringify(datos.cuerpo).includes('569'), 'sin teléfonos en la respuesta');

    const ajeno = await s.post('/acceso/rut', { telefono: ANA, codigo, rut: '22.222.222-2' });
    assert.equal(ajeno.status, 400);
    assert.equal(ajeno.cuerpo.mensaje, RUT_DE_OTRO_TELEFONO);

    assert.equal((await s.post('/acceso/entrar', { telefono: ANA, codigo, nombre: 'Almacén Ana', rut: '11.111.111-1' })).status, 201, 'el código sigue sirviendo para entrar');
  } finally {
    s.server.close();
  }
});

test('el mismo negocio compra y vende con una sola sesión; quien solo compra no entra al panel del proveedor', async () => {
  const s = await servidor();
  try {
    await s.red.registrarComprador({ nombre: 'Almacén Ana', telefono: ANA, rut: '11111111-1' });
    await s.red.registrarProveedor({ telefono: ANA, rut: '11111111-1' });
    const ana = await tokenConCodigo(s.post, s.buzon, ANA);
    assert.equal((await s.get('/yo', ana)).status, 200);
    assert.equal((await s.get('/proveedor/yo', ana)).status, 200);

    const beto = await tokenConCodigo(s.post, s.buzon, BETO, { nombre: 'Beto', rut: '22.222.222-2' });
    const panel = await s.get('/proveedor/yo', beto);
    assert.deepEqual([panel.status, panel.cuerpo.error], [403, 'prohibido']);
  } finally {
    s.server.close();
  }
});

test('cada teléfono pide pocos códigos por hora, y si WhatsApp falla se avisa', async () => {
  const s = await servidor();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await s.post('/acceso/codigo', { telefono: ANA })).status, 200);
    assert.equal((await s.post('/acceso/codigo', { telefono: ANA })).status, 429);
    assert.equal((await s.post('/acceso/codigo', { telefono: BETO })).status, 200, 'otro teléfono no comparte el límite');
  } finally {
    s.server.close();
  }
  const sinWhatsapp = await servidor(async () => 'fallido');
  try {
    assert.equal((await sinWhatsapp.post('/acceso/codigo', { telefono: ANA })).status, 503);
  } finally {
    sinWhatsapp.server.close();
  }
});
