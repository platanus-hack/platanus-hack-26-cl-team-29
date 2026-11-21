import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { inflateSync } from 'node:zlib';
import bwipjs from 'bwip-js';
import express from 'express';
import { crearSiiEnMemoria, generarPdf, opcionesTimbre } from '../server/sii/index.ts';
import type { DocumentoImpreso } from '../server/sii/index.ts';
import { timbrar } from '../server/sii/timbre.ts';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, enlacePdf, PROVEEDOR_DEMO, tokenPdfValido } from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { generarCaf, RUT_EMPRESA, RUT_FIRMANTE } from './sii-apoyo.ts';


const ENV = { PDF_LLAVE: 'llave-de-prueba' };

/** Texto visible del PDF: pdfkit escribe cada cadena en hexadecimal (WinAnsi) dentro de streams comprimidos. */
function textoDelPdf(pdf: Buffer): string {
  const crudo = pdf.toString('latin1');
  let texto = '';
  for (const m of crudo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let contenido: string;
    try { contenido = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1'); } catch { continue; }
    for (const h of contenido.matchAll(/<([0-9a-fA-F]+)>/g)) texto += Buffer.from(h[1]!, 'hex').toString('latin1');
    texto += '\n';
  }
  return texto;
}

async function facturaSimulada(folio = 5190): Promise<DocumentoImpreso> {
  const r = await crearSiiEnMemoria().emitirFactura({
    folio, fechaEmision: '2026-11-21',
    receptor: { rut: '22222222-2', razonSocial: 'Almacén de Prueba', giro: 'Comercio', direccion: 'Calle 1', comuna: 'Ñuñoa' },
    items: [
      { nombre: 'Caja de rollos térmicos 80 mm', cantidad: 3, precioUnitario: 24500, unidad: 'UN' },
      { nombre: 'Despacho', cantidad: 1, precioUnitario: 3500 },
    ],
    ordenCompra: { folio: 'OC-1-ABCD', fecha: '2026-11-21' },
  });
  return r.documento.impreso;
}

test('el PDF de una factura es un PDF con folio, tipo, referencia, totales y la leyenda de certificación', async () => {
  const impreso = await facturaSimulada();
  const pdf = await generarPdf(impreso);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const texto = textoDelPdf(pdf);
  for (const esperado of ['5190', 'FACTURA ELECTR', 'S.I.I. - SANTIAGO', 'OC-1-ABCD', '$77.000', '$14.630', '$91.630',
    'Timbre Electr', 'Verifique documento: www.sii.cl', 'ambiente de certificaci', 'simulado']) {
    assert.ok(texto.includes(esperado), `falta "${esperado}" en el PDF`);
  }
});

test('la nota de crédito muestra su tipo y la factura que corrige', async () => {
  const r = await crearSiiEnMemoria().emitirNotaCredito({
    folio: 3001, fechaEmision: '2026-11-21',
    receptor: { rut: '22222222-2', razonSocial: 'Almacén', giro: 'Comercio', direccion: 'Calle 1', comuna: 'Santiago' },
    items: [{ nombre: 'Harina', cantidad: 2, precioUnitario: 1000 }],
    factura: { folio: 1001, fecha: '2026-11-21' },
  });
  const texto = textoDelPdf(await generarPdf(r.documento.impreso));
  assert.ok(texto.includes('NOTA DE CR') && texto.includes('3001'));
  assert.ok(texto.includes('Factura electr') && texto.includes('1001') && texto.includes('corrige montos'));
});

test('el PDF417 codifica los bytes Latin-1 exactos del TED, con nivel de seguridad 5', async () => {
  const { caf } = generarCaf(33);
  const ted = timbrar({
    tipo: 33, folio: 7, fechaEmision: '2026-11-21', rutEmisor: RUT_EMPRESA, rutReceptor: RUT_FIRMANTE,
    razonSocialReceptor: 'Comprador', montoTotal: 1190, primerItem: 'Harina', marca: '2026-11-21T10:00:00',
  }, caf);
  assert.ok(ted.includes('COMPAÑIA'), 'el CAF de prueba trae una Ñ: el TED tiene un byte fuera de ASCII');

  const llamada = mock.method(bwipjs, 'toBuffer');
  try {
    await generarPdf({ ...(await facturaSimulada(7)), ted });
    const opciones = llamada.mock.calls[0]!.arguments[0] as ReturnType<typeof opcionesTimbre>;
    assert.equal(opciones.bcid, 'pdf417');
    assert.equal(opciones.eclevel, 5);
    assert.equal(opciones.binarytext, true);
    assert.deepEqual(Buffer.from(opciones.text, 'latin1'), Buffer.from(ted, 'latin1'));
  } finally {
    llamada.mock.restore();
  }
  assert.throws(() => opcionesTimbre('<TED>€</TED>'), /Latin-1/);
});

async function servidor() {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), { DEMO_FICTICIOS: '1' });
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: ENV });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, ENV));
  const server = app.listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const json = async (ruta: string, init: { metodo?: string; body?: unknown; token?: string } = {}) => {
    const r = await fetch(`${base}/api/red${ruta}`, {
      method: init.metodo ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };
  const entrar = async (nombre: string): Promise<string> =>
    (await json('/sesion', { metodo: 'POST', body: { nombre, rut: '11111111-1' } })).cuerpo.token;
  return { red, server, base, eventos, json, entrar };
}

test('el enlace del PDF funciona solo con el token correcto del mismo documento', async () => {
  const s = await servidor();
  try {
    const ana = await s.entrar('Ana');
    const orden = await s.json('/yo/ordenes', { metodo: 'POST', token: ana, body: { proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'harina', cantidad: 2 }] } });
    await s.red.confirmarOrden(orden.cuerpo.id);
    const [factura, guia] = s.red.estadoDeLaRed().documentos.filter(d => d.ordenId === orden.cuerpo.id);
    assert.ok(factura && guia);

    const enlace = s.red.enlacePdf(factura);
    assert.ok(enlace?.startsWith(`/api/red/documentos/${factura.id}/pdf?t=`), 'sin PUBLIC_URL el enlace es relativo');
    assert.equal(enlacePdf(factura, { ...ENV, PUBLIC_URL: 'https://ejemplo.invalid/' }), `https://ejemplo.invalid${enlace}`);

    assert.ok(enlace);
    const ok = await fetch(s.base + enlace);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'application/pdf');
    assert.equal(ok.headers.get('content-disposition'), `inline; filename="factura-${factura.folio}.pdf"`);
    assert.equal(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

    const tokenGuia = new URL(s.red.enlacePdf(guia)!, s.base).searchParams.get('t');
    for (const malo of [`/api/red/documentos/${factura.id}/pdf`, `/api/red/documentos/${factura.id}/pdf?t=inventado`,
      `/api/red/documentos/${factura.id}/pdf?t=${tokenGuia}`, `/api/red/documentos/no-existe/pdf?t=${tokenGuia}`]) {
      assert.equal((await fetch(s.base + malo)).status, 404, malo);
    }
    assert.equal(tokenPdfValido(factura.id, new URL(enlace, s.base).searchParams.get('t'), { PDF_LLAVE: 'otra-llave' }), false);
  } finally {
    s.server.close();
  }
});

test('pdfUrl va solo en los documentos propios, nunca en la foto pública ni en eventos', async () => {
  const s = await servidor();
  try {
    const ana = await s.entrar('Ana');
    const beto = await s.entrar('Beto');
    const orden = await s.json('/yo/ordenes', { metodo: 'POST', token: ana, body: { proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'harina', cantidad: 2 }] } });
    await s.red.confirmarOrden(orden.cuerpo.id);

    const deAna = (await s.json('/yo', { token: ana })).cuerpo.documentos as { id: string; pdfUrl?: string }[];
    assert.equal(deAna.length, 2);
    for (const d of deAna) assert.equal(d.pdfUrl, s.red.enlacePdf(d));
    assert.deepEqual((await s.json('/yo', { token: beto })).cuerpo.documentos, []);

    const publico = JSON.stringify([(await s.json('/estado')).cuerpo, s.red.estadoPublico(), s.eventos]);
    for (const prohibido of ['pdfUrl', '/pdf?t=', '"impreso"', '<TED', '22222222-2']) {
      assert.ok(!publico.includes(prohibido), `apareció ${prohibido} en datos públicos`);
    }
  } finally {
    s.server.close();
  }
});
