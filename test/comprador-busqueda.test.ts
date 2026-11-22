import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarEnApp, type FuentesBusqueda } from '../client/src/comprador/busqueda.ts';

const FUENTES: FuentesBusqueda = {
  productos: [{ id: 'rollos', nombre: 'Caja de rollos térmicos 80 mm', licitacionId: 'L-1' }, { id: 'guantes', nombre: 'Guantes de nitrilo', licitacionId: 'L-1' }],
  ordenes: [{ id: 'o1', proveedorId: 'p1', compradorId: 'c1', items: [{ producto: 'Harina 25 kg' }] }],
  documentos: [{ tipo: 33, folio: 5190, ordenId: 'o1' }, { tipo: 61, folio: null, ordenId: 'o1' }],
  negocios: [{ id: 'p1', nombre: 'Molinos del Sur' }, { id: 'c1', nombre: 'Panadería El Trigal' }],
  secciones: [{ id: 'credito', titulo: 'Crédito' }, { id: 'facturas', titulo: 'Facturas' }],
};

test('la búsqueda encuentra productos, pedidos, facturas y secciones, sin importar tildes ni mayúsculas', () => {
  assert.deepEqual(buscarEnApp('TERMICOS', FUENTES).map(r => r.href), ['#compra/L-1/rollos']);
  assert.deepEqual(buscarEnApp('molinos', FUENTES), [], 'sin sección Pedidos (el comprador), no se buscan pedidos');
  const conPedidos = { ...FUENTES, secciones: [...FUENTES.secciones, { id: 'pedidos', titulo: 'Pedidos' }] };
  assert.deepEqual(buscarEnApp('molinos', conPedidos).map(r => [r.tipo, r.titulo]), [['pedido', 'Harina 25 kg']]);
  assert.deepEqual(buscarEnApp('5190', FUENTES).map(r => [r.titulo, r.detalle]), [['Factura folio 5190', 'Molinos del Sur']]);
  assert.deepEqual(buscarEnApp('credito', FUENTES).map(r => r.href), ['#credito']);
});

test('todas las palabras tienen que aparecer, y con menos de 2 letras no busca', () => {
  assert.deepEqual(buscarEnApp('rollos 80', FUENTES).map(r => r.href), ['#compra/L-1/rollos']);
  assert.deepEqual(buscarEnApp('rollos nitrilo', FUENTES), []);
  assert.deepEqual(buscarEnApp('g', FUENTES), []);
});

test('desde el panel del proveedor, los pedidos se buscan por el comprador y la compra en grupo lleva a /app', () => {
  const vendiendo = { ...FUENTES, secciones: [{ id: 'pedidos', titulo: 'Pedidos' }], contraparte: 'compradorId' as const, rutaCompra: '/app#compra' };
  assert.deepEqual(buscarEnApp('trigal', vendiendo).map(r => [r.tipo, r.detalle]), [['pedido', 'Panadería El Trigal']]);
  assert.deepEqual(buscarEnApp('termicos', vendiendo).map(r => r.href), ['/app#compra/L-1/rollos']);
});
