import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearRutasCatalogo, crearRutasOperacionCatalogo, iniciarCatalogos, origenArchivos } from '../server/catalogo/index.ts';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, PROVEEDOR_SALA } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { leerFacturas } from '../server/catalogo/xml.ts';
import { xmlsDeEjemplo } from '../server/catalogo/ejemplo.ts';
import { errorDeTramos, tramosSugeridos } from '../shared/precios.ts';
import type { EventoRed } from '../server/red/index.ts';
import { buzonDeCodigos, tokenConCodigo } from './acceso-apoyo.ts';

// XML ficticio: un EnvioDTE con una factura, una guía y una nota de crédito. Todos los RUT son de prueba.
const XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0"><SetDTE ID="S">
  <DTE><Documento ID="F1">
    <Encabezado>
      <IdDoc><TipoDTE>33</TipoDTE><Folio>10</Folio><FchEmis>2026-10-01</FchEmis></IdDoc>
      <Emisor><RUTEmisor>11111111-1</RUTEmisor></Emisor>
      <Receptor><RUTRecep>22222222-2</RUTRecep><RznSocRecep>Almacén Receptor SpA</RznSocRecep><DirRecep>Calle Falsa 123</DirRecep></Receptor>
    </Encabezado>
    <Detalle><CdgItem><VlrCodigo>R80</VlrCodigo></CdgItem><NmbItem>Rollo térmico 80 mm</NmbItem><QtyItem>10</QtyItem><UnmdItem>CJ</UnmdItem><PrcItem>3000</PrcItem><MontoItem>28000</MontoItem></Detalle>
    <Detalle><NmbItem>Cinta   de embalaje</NmbItem><PrcItem>1500</PrcItem></Detalle>
  </Documento></DTE>
  <DTE><Documento ID="G1"><Encabezado><IdDoc><TipoDTE>52</TipoDTE><Folio>5</Folio><FchEmis>2026-10-01</FchEmis></IdDoc></Encabezado>
    <Detalle><NmbItem>Rollo térmico 80 mm</NmbItem><QtyItem>10</QtyItem><PrcItem>3000</PrcItem></Detalle></Documento></DTE>
  <DTE><Documento ID="N1"><Encabezado><IdDoc><TipoDTE>61</TipoDTE><Folio>3</Folio><FchEmis>2026-10-02</FchEmis></IdDoc></Encabezado></Documento></DTE>
</SetDTE></EnvioDTE>`;

test('lee solo las facturas de venta, con el precio neto de cada línea y sin el receptor', () => {
  const lectura = leerFacturas(Buffer.from(XML, 'latin1'));
  assert.equal(lectura.omitidos, 2);
  assert.equal(lectura.facturas.length, 1);
  const f = lectura.facturas[0];
  assert.deepEqual({ tipo: f.tipo, folio: f.folio, rutEmisor: f.rutEmisor, fecha: f.fecha }, { tipo: 33, folio: 10, rutEmisor: '11111111-1', fecha: '2026-10-01' });
  assert.deepEqual(f.lineas, [
    { codigo: 'R80', nombre: 'Rollo térmico 80 mm', unidad: 'caja', cantidad: 10, precioUnitario: 2800, fecha: '2026-10-01' },
    { nombre: 'Cinta de embalaje', unidad: 'unidad', cantidad: 1, precioUnitario: 1500, fecha: '2026-10-01' },
  ]);
  const todo = JSON.stringify(lectura);
  for (const dato of ['22222222', 'Receptor SpA', 'Calle Falsa']) assert.ok(!todo.includes(dato), `se filtró ${dato}`);
});

test('tramos sugeridos: un tramo por cada baja real del precio según la cantidad, a la centena, y nunca suben', () => {
  const ventas = [
    { cantidad: 1, precioUnitario: 10_000 }, { cantidad: 2, precioUnitario: 9_950 }, { cantidad: 1, precioUnitario: 10_100 },
    { cantidad: 10, precioUnitario: 9_400 }, { cantidad: 12, precioUnitario: 9_390 }, { cantidad: 50, precioUnitario: 8_200 },
    { cantidad: 30, precioUnitario: 9_600 },
  ];
  assert.deepEqual(tramosSugeridos(ventas), [
    { desde: 1, precioUnitario: 10_100 }, { desde: 10, precioUnitario: 9_400 }, { desde: 50, precioUnitario: 8_200 },
  ]);
  assert.deepEqual(tramosSugeridos([{ cantidad: 3, precioUnitario: 5_000 }, { cantidad: 9, precioUnitario: 4_990 }]), [{ desde: 1, precioUnitario: 5_000 }]);
  assert.equal(errorDeTramos(tramosSugeridos(ventas)), null, 'pasan la misma validación que los tramos que fija el proveedor');
});

test('el catálogo se arma solo desde el historial de ejemplo, avisa en vivo y no guarda receptores', async () => {
  const eventos: EventoRed[] = [];
  const catalogos = await iniciarCatalogos({ emitir: e => eventos.push(e), ahora: () => new Date('2026-11-21T12:00:00Z') });
  assert.equal(catalogos.asegurar({ id: 'p1' }).estado, 'armando');
  const r = await catalogos.armar({ id: 'p1' });
  assert.equal(r.catalogo.estado, 'listo');
  assert.equal(r.catalogo.origen, 'ejemplo');
  assert.ok(r.catalogo.facturas >= 150);
  assert.ok(r.catalogo.productos.length >= 6);
  // El proveedor de ejemplo da descuento por volumen: su historial sugiere tramos propios que bajan.
  const rollos = r.catalogo.productos.find(p => p.nombre.startsWith('Caja de rollos térmicos 80'))!;
  assert.equal(rollos.tramosDe, 'historial');
  assert.ok(rollos.tramos.length >= 3 && rollos.tramos.at(-1)!.precioUnitario < rollos.tramos[0].precioUnitario);
  assert.ok(eventos.some(e => e.tipo === 'catalogo.actualizado' && (e.datos as { estado: string }).estado === 'listo'));
  assert.ok(!JSON.stringify(eventos).includes('precio'), 'los eventos no llevan precios');
  assert.ok(!/RUTRecep|Comercial de ejemplo|77\d{6}/.test(JSON.stringify(r)), 'el catálogo no guarda receptores');
});

test('los XML cargados por el equipo se suman sin contar dos veces y descartan los de otra empresa', async () => {
  const catalogos = await iniciarCatalogos({ emitir: () => {} });
  const proveedor = { id: 'p2', rut: '11111111-1' };
  const primera = await catalogos.armar(proveedor, origenArchivos([XML, 'no es xml']));
  assert.deepEqual([primera.facturas, primera.ilegibles, primera.catalogo.origen], [1, 1, 'archivos']);
  const repetida = await catalogos.armar(proveedor, origenArchivos([XML]));
  assert.equal(repetida.catalogo.facturas, 1);
  const ajena = await catalogos.armar(proveedor, origenArchivos(xmlsDeEjemplo(new Date('2026-11-21'))));
  assert.ok(ajena.deOtraEmpresa > 0);
  assert.equal(ajena.catalogo.facturas, 1);
});

test('el proveedor ve su catálogo armado solo y suma un producto a la compra con los tramos de su historial', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), { DEMO_FICTICIOS: '1', DEMO_TELEFONO_PROVEEDOR: '+56 9 7777 0000' });
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const catalogos = await iniciarCatalogos({ emitir: () => {} });
  const env = { DEMO_TOKEN: 'token-de-prueba' };
  const catalogo = { proveedor: crearRutasCatalogo(catalogos, red), operacion: crearRutasOperacionCatalogo(catalogos, red) };
  const buzon = buzonDeCodigos();
  const server = express().use(express.json()).use('/api/red', crearRutasRed(red, env, { catalogo, enviarCodigo: buzon.enviarCodigo })).listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const pedir = async (ruta: string, init: RequestInit = {}) => {
    const r = await fetch(url + ruta, init);
    return { status: r.status, cuerpo: await r.json() };
  };
  try {
    assert.equal((await pedir('/proveedor/catalogo')).status, 401);
    const json = { 'content-type': 'application/json' };
    const post = (ruta: string, body: unknown) => pedir(ruta, { method: 'POST', headers: json, body: JSON.stringify(body) });
    const auth = { authorization: `Bearer ${await tokenConCodigo(post, buzon, '+56 9 7777 0000')}` };
    assert.equal((await pedir('/proveedor/catalogo', { headers: auth })).cuerpo.estado, 'armando');
    await catalogos.armar({ id: PROVEEDOR_SALA });
    const listo = (await pedir('/proveedor/catalogo', { headers: auth })).cuerpo;
    assert.equal(listo.estado, 'listo');
    const nuevo = listo.productos.find((p: { nombre: string }) => p.nombre.startsWith('Ribbon'));
    const sumar = () => pedir(`/proveedor/catalogo/productos/${nuevo.clave}/sumar`, { method: 'POST', headers: auth });
    assert.equal((await sumar()).status, 201);
    assert.deepEqual(red.licitacionAbierta()!.productos.find(p => p.nombre === nuevo.nombre)!.tramos, nuevo.tramos);
    assert.equal((await sumar()).status, 400, 'no se suma dos veces');

    // La carga de XML es del equipo: sin el token de operación no entra.
    const xml = { method: 'POST', body: XML };
    assert.equal((await pedir(`/operacion/catalogo/${PROVEEDOR_SALA}/xml`, { ...xml, headers: { 'content-type': 'application/xml' } })).status, 403);
    const cargada = await pedir(`/operacion/catalogo/${PROVEEDOR_SALA}/xml`, { ...xml, headers: { 'content-type': 'application/xml', 'x-demo-token': env.DEMO_TOKEN } });
    assert.equal(cargada.status, 200);
    assert.equal(cargada.cuerpo.catalogo.origen, 'archivos');
  } finally {
    server.close();
  }
});
