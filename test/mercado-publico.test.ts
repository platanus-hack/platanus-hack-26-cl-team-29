import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { crearAlmacenMemoria } from '../server/mercado-publico/almacen.ts';
import type { FuenteOrdenes, OrdenApi } from '../server/mercado-publico/api.ts';
import { preciosDeReferencia, proveedoresDe } from '../server/mercado-publico/index.ts';
import { normalizarOrden, type OrdenMP } from '../server/mercado-publico/normalizar.ts';
import { leerOcds, normalizarRelease, type ReleaseOcds } from '../server/mercado-publico/ocds.ts';
import { pasada } from '../server/mercado-publico/sincronizar.ts';

// Forma de la API con ticket según el "Diccionario de Datos - Órdenes de Compra" de ChileCompra (valores de ejemplo).
const respuestaApi = JSON.parse(readFileSync('test/datos/mercado-publico-orden.json', 'utf8')) as { Listado: OrdenApi[] };
// Cuatro líneas reales del dataset OCDS 2026 de ChileCompra (CC0), sin contactos ni oferentes que no ganaron.
const MUESTRA_OCDS = 'test/datos/ocds-chilecompra-muestra.jsonl';
const releases = readFileSync(MUESTRA_OCDS, 'utf8').trim().split('\n').map(l => JSON.parse(l) as ReleaseOcds);

test('una orden de compra de la API queda como proveedor y precio unitario neto', () => {
  const orden = normalizarOrden(respuestaApi.Listado[0]!, '2026-11-19');
  assert.deepEqual(orden?.proveedor, { rut: '76.543.210-3', nombre: 'Distribuidora de Ejemplo SpA', comuna: 'San Bernardo', region: 'Región Metropolitana de Santiago' });
  assert.equal(orden?.precios.length, 1, 'el ítem con cantidad 0 no es un precio');
  assert.deepEqual(orden?.precios[0], {
    orden: '1234-56-SE26', producto: 'Arroz grado 2, bolsa 1 kg', codigoProducto: 50221101, rubro: 'Alimentos, bebidas y tabaco',
    categoria: 'Arroz', unidad: 'unidad', cantidad: 30, precioUnitario: 1090, fecha: '2026-11-19', despacho: 'Ñuñoa', organismo: 'Liceo de Ejemplo N° 1',
  });
  assert.equal(normalizarOrden({ ...respuestaApi.Listado[0]!, CodigoEstado: 9 }, '2026-11-19'), null, 'una orden cancelada no es referencia');
  const deUnaPersona = { ...respuestaApi.Listado[0]!, Proveedor: { ...respuestaApi.Listado[0]!.Proveedor, RutSucursal: '12.345.678-5' } };
  assert.equal(normalizarOrden(deUnaPersona, '2026-11-19'), null, 'no se guardan proveedores personas naturales');
});

test('del dataset OCDS quedan solo los alimentos con precio unitario, de empresas', () => {
  const ordenes = releases.flatMap(r => normalizarRelease(r, '2025-11-21'));
  assert.deepEqual(ordenes.map(o => o.proveedor.nombre), ['SOCIEDAD COMERCIAL CENTROPAN LTDA.', 'GRUPO SUPER FAMILIA SPA', 'CECINAS VENEZIA S A']);
  const pan = ordenes[1]!.precios.find(p => p.producto.startsWith('Pan corriente'));
  assert.deepEqual(
    { rut: ordenes[1]!.proveedor.rut, unidad: pan?.unidad, precio: pan?.precioUnitario, fecha: pan?.fecha, rubro: pan?.rubro, despacho: pan?.despacho },
    { rut: '77.559.426-8', unidad: 'kilogramo', precio: 1715, fecha: '2026-09-08', rubro: 'Alimentos, bebidas y tabaco', despacho: 'Región del Ñuble' },
  );
  assert.ok(ordenes[0]!.precios.every(p => String(p.codigoProducto).startsWith('50')), 'la jamonada y las bolsas de la misma compra no son UNSPSC 50');
  assert.equal(releases.flatMap(r => normalizarRelease(r, '2026-10-01')).length, 0, 'las adjudicaciones viejas no son referencia');
});

test('el .jsonl.gz se lee en streaming y entrega las órdenes en lotes', async () => {
  const lotes: OrdenMP[][] = [];
  const gz = Readable.from(gzipSync(readFileSync(MUESTRA_OCDS)));
  const leido = await leerOcds(gz, { desde: '2025-11-21', tamanoLote: 2, alLote: async l => { lotes.push(l); } });
  assert.deepEqual([leido.lineas, leido.ordenes, lotes.map(l => l.length)], [4, 3, [2, 1]]);
});

test('la pasada de la API retoma desde el último día guardado y no repite ese día', async () => {
  const almacen = crearAlmacenMemoria();
  const pedidos: string[] = [];
  const fuente: FuenteOrdenes = {
    async ordenesDelDia(dia) {
      pedidos.push(dia);
      return [{ Codigo: `OC-${dia}`, Nombre: 'Compra de abarrotes', CodigoEstado: 6 }, { Codigo: `X-${dia}`, Nombre: 'Mantención de ascensores', CodigoEstado: 6 }];
    },
    orden: async codigo => ({ ...respuestaApi.Listado[0]!, Codigo: codigo }),
  };
  const opciones = { fuente, almacen, diasIniciales: 2, maxPorDia: 10 };
  assert.equal((await pasada({ ...opciones, hoy: '2026-11-20' })).length, 2);
  assert.deepEqual(pedidos, ['2026-11-18', '2026-11-19'], 'la primera vez: los días completos anteriores a hoy');
  pedidos.length = 0;
  const nuevas = await pasada({ ...opciones, hoy: '2026-11-22' });
  assert.deepEqual(pedidos, ['2026-11-20', '2026-11-21'], 'después: desde el día siguiente al último guardado');
  assert.deepEqual(nuevas.map(o => o.codigo), ['OC-2026-11-20', 'OC-2026-11-21'], 'solo las de alimentos');
  assert.equal(await almacen.marca('api-ultimo-dia'), '2026-11-21');
});

test('la ficha cuenta clientes sin nombrarlos y los precios de referencia no traen al comprador', () => {
  const ordenes = releases.flatMap(r => normalizarRelease(r, '2025-11-21'));
  const [venezia] = proveedoresDe(ordenes).filter(p => p.nombre.startsWith('CECINAS'));
  assert.equal(venezia?.clientes, 1);
  const referencia = preciosDeReferencia(ordenes, 'pechuga');
  assert.ok(referencia.precios.length > 0 && referencia.resumen.length > 0);
  assert.ok(!JSON.stringify(referencia).includes('HOSPITAL'), 'el organismo comprador no sale en la respuesta');
});
