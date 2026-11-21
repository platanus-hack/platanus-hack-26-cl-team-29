import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { crearCertificados } from '../server/certificados/index.ts';
import { CLAVE_PFX, generarPfx, RUT_FIRMANTE } from './sii-apoyo.ts';

const silencio = { info() {}, warn() {}, error() {} };

async function montar() {
  const env = { SII_LLAVE_CIFRADO: randomBytes(32).toString('base64'), PUBLIC_URL: 'https://bando.test' };
  const certificados = await crearCertificados({ env, log: silencio });
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
