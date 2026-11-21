import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { crearCertificados } from '../server/certificados/index.ts';
import { crearAlmacenMemoria, type AlmacenCertificados } from '../server/certificados/almacen.ts';
import { CLAVE_PFX, generarPfx, RUT_FIRMANTE } from './sii-apoyo.ts';

const silencio = { info() {}, warn() {}, error() {} };

async function montar(almacen?: AlmacenCertificados) {
  const env = { SII_LLAVE_CIFRADO: randomBytes(32).toString('base64'), PUBLIC_URL: 'https://bando.test' };
  const certificados = await crearCertificados({ env, log: silencio, ...(almacen ? { almacen } : {}) });
  const avisos: { telefono: string; rut: string }[] = [];
  certificados.alConectar((telefono, rut) => { avisos.push({ telefono, rut }); });
  const app = express();
  app.use(certificados.rutas);
  const server = app.listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const token = (url: string) => url.split('/certificado/')[1]!;
  const subir = (url: string, pfx: Buffer, clave: string) => fetch(`${base}/api/certificado/${token(url)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pfxBase64: pfx.toString('base64'), clave }),
  });
  return { certificados, avisos, base, token, subir, cerrar: () => server.close() };
}

test('un certificado válido se guarda cifrado, da el RUT del titular y avisa con el teléfono que pidió el link', async t => {
  const { certificados, avisos, base, token, subir, cerrar } = await montar();
  t.after(cerrar);
  const url = certificados.enlace('+56 9 1234 5678');
  assert.match(url, /^https:\/\/bando\.test\/certificado\/[\w-]{20,}$/);

  const pagina = await (await fetch(`${base}/certificado/${token(url)}`)).text();
  assert.match(pagina, /Conecta tu certificado digital/);

  const r = await subir(url, generarPfx(), CLAVE_PFX);
  assert.equal(r.status, 200);
  const cuerpo = await r.text();
  assert.doesNotMatch(cuerpo, new RegExp(CLAVE_PFX), 'la respuesta no devuelve la clave');
  assert.deepEqual(avisos, [{ telefono: '56912345678', rut: RUT_FIRMANTE }]);

  const guardado = await certificados.certificadoDe(RUT_FIRMANTE);
  assert.equal(guardado?.clave, CLAVE_PFX);
  assert.equal(guardado?.rut, RUT_FIRMANTE);

  assert.equal((await subir(url, generarPfx(), CLAVE_PFX)).status, 410, 'el link es de un solo uso');
  assert.match(await (await fetch(`${base}/certificado/${token(url)}`)).text(), /Este link ya no sirve/);
});

test('clave incorrecta o certificado vencido: error claro, nada guardado y el link sigue sirviendo', async t => {
  const { certificados, avisos, subir, cerrar } = await montar();
  t.after(cerrar);
  const url = certificados.enlace('56900000001');

  const malaClave = await subir(url, generarPfx(), 'otra-clave');
  assert.equal(malaClave.status, 400);
  assert.match((await malaClave.json()).mensaje, /Revisa que sea el \.pfx correcto y su clave/);

  const vencido = await subir(url, generarPfx(RUT_FIRMANTE, new Date(Date.now() - 86_400_000)), CLAVE_PFX);
  assert.equal(vencido.status, 400);
  assert.match((await vencido.json()).mensaje, /venció/);

  assert.equal(await certificados.certificadoDe(RUT_FIRMANTE), null);
  assert.equal(avisos.length, 0);
  assert.equal((await subir(url, generarPfx(), CLAVE_PFX)).status, 200, 'tras un error se puede reintentar con el mismo link');
});

test('dos subidas a la vez con el mismo link: solo una conecta y el aviso sale una vez', async t => {
  // Un almacén lento deja la primera subida esperando en el guardado: ahí entra la segunda.
  const memoria = crearAlmacenMemoria();
  let guardados = 0;
  const lento: AlmacenCertificados = {
    async guardar(c) { guardados++; await new Promise(r => setTimeout(r, 50)); await memoria.guardar(c); },
    buscar: rut => memoria.buscar(rut),
  };
  const { certificados, avisos, subir, cerrar } = await montar(lento);
  t.after(cerrar);
  const url = certificados.enlace('56900000002');
  const pfx = generarPfx();

  const estados = (await Promise.all([subir(url, pfx, CLAVE_PFX), subir(url, pfx, CLAVE_PFX)])).map(r => r.status).sort();
  assert.deepEqual(estados, [200, 409]);
  await new Promise(r => setImmediate(r));
  assert.equal(guardados, 1);
  assert.deepEqual(avisos, [{ telefono: '56900000002', rut: RUT_FIRMANTE }]);
  assert.equal((await subir(url, pfx, CLAVE_PFX)).status, 410);
});

test('el link muere tras 5 intentos fallidos y los links por teléfono tienen tope', async t => {
  const { certificados, subir, cerrar } = await montar();
  t.after(cerrar);
  const url = certificados.enlace('56900000003');
  for (let i = 1; i < 5; i++) assert.equal((await subir(url, generarPfx(), 'mala')).status, 400);
  const quinto = await subir(url, generarPfx(), 'mala');
  assert.equal(quinto.status, 410);
  assert.match((await quinto.json()).mensaje, /Revisa que sea el \.pfx correcto.*Pide otro en WhatsApp/);
  assert.equal((await subir(url, generarPfx(), CLAVE_PFX)).status, 410, 'ni con la clave buena');

  // Pasado el tope de links nuevos en 10 minutos, se repite el último que sigue vivo.
  const links = Array.from({ length: 7 }, () => certificados.enlace('56900000004'));
  assert.equal(new Set(links).size, 5);
  assert.equal(links[6], links[4]);
  assert.notEqual(certificados.enlace('56900000005'), links[4], 'otro teléfono no comparte el tope');
});
