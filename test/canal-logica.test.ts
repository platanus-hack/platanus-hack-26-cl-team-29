import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cicloDelPedido, confirmacion, estaFacturada, montoNotaCredito, normalizarTramos, precioDelGrupo, resumenFacturacion, SIN_CONFIRMACION,
  type Confirmacion,
} from '../client/src/canal/logica.ts';
import type { LicitacionCanal, OrdenCanal } from '../client/src/canal/tipos.ts';
import type { Documento } from '../client/src/red/tipos.ts';

const TRAMOS = [
  { desde: 1, precioUnitario: 32_000 },
  { desde: 10, precioUnitario: 29_900 },
  { desde: 25, precioUnitario: 27_900 },
];

const licitacion = (cantidades: number[], extra: Partial<LicitacionCanal> = {}): LicitacionCanal => ({
  id: 'L-1', producto: 'Caja', comuna: 'Santiago', cierraEn: new Date(Date.now() + 60_000).toISOString(), estado: 'abierta',
  ofertas: [], tramos: TRAMOS, participantes: cantidades.map((cantidad, i) => ({ negocioId: `n-${i}`, cantidad })), ...extra,
});

const orden = (estado: OrdenCanal['estado'], extra: Partial<OrdenCanal> = {}): OrdenCanal => ({
  id: 'o-1', compradorId: 'c', proveedorId: 'p', estado, creadaEn: '2026-11-21T12:00:00Z',
  items: [{ producto: 'Caja', cantidad: 8, precioUnitario: 29_900 }], ...extra,
});

const doc = (tipo: Documento['tipo'], extra: Partial<Documento> = {}): Documento => ({
  id: `d-${tipo}`, ordenId: 'o-1', tipo, folio: 100 + tipo, trackId: null, estadoSii: 'aceptado', ...extra,
});

test('el precio del grupo baja por tramos y dice cuánto falta para el siguiente', () => {
  assert.deepEqual(precioDelGrupo(licitacion([4, 2])), {
    unidades: 6, precio: 32_000, precioSolo: 32_000, siguiente: { faltan: 4, precio: 29_900 },
  });
  const g = precioDelGrupo(licitacion([10, 11]));
  assert.equal(g.precio, 29_900);
  assert.deepEqual(g.siguiente, { faltan: 4, precio: 27_900 });
  assert.equal(precioDelGrupo(licitacion([20, 20])).siguiente, undefined, 'en el último tramo no hay siguiente');
});

test('lee tramos con otros nombres de campo y sin tramos usa la mejor oferta', () => {
  assert.deepEqual(normalizarTramos([{ minimo: 10, precio: 2 }, { desde: 1, precioUnitario: 3 }, { nada: 1 }]), [
    { desde: 1, precioUnitario: 3 }, { desde: 10, precioUnitario: 2 },
  ]);
  const sinTramos = licitacion([3], { tramos: undefined, precioSolo: 21_500, ofertas: [
    { proveedorId: 'a', precioUnitario: 18_000, plazoDias: 1 }, { proveedorId: 'b', precioUnitario: 17_500, plazoDias: 2 },
  ] });
  assert.deepEqual(precioDelGrupo(sinTramos), { unidades: 3, precio: 17_500, precioSolo: 21_500 });
});

test('el ciclo del pedido pide la recepción solo cuando llegó la factura', () => {
  const facturada = cicloDelPedido(orden('facturada'), [doc(33, { estadoSii: 'recibido' }), doc(52)]);
  assert.equal(facturada.accion, 'recibir');
  assert.equal(facturada.resumen, '¿Recibiste todo?');
  assert.deepEqual(facturada.pasos.map(p => p.estado), ['hecho', 'hecho', 'hecho', 'actual', 'pendiente', 'pendiente']);
  assert.equal(facturada.pasos[2].detalle, 'Folio 133, recibido por el SII');
  assert.equal(cicloDelPedido(orden('enviada'), []).accion, 'ninguna');
});

test('recibido conforme salta el reclamo; con faltante pasa por el SII hasta la nota de crédito', () => {
  const conforme = cicloDelPedido(orden('recibida'), [doc(33)]);
  assert.deepEqual(conforme.pasos.map(p => p.estado), ['hecho', 'hecho', 'hecho', 'hecho', 'omitido', 'omitido']);

  const reclamo = { producto: 'Caja', faltante: 2, en: '2026-11-21T13:00:00Z', estadoSii: 'recibido' };
  const reclamada = cicloDelPedido(orden('reclamada', { reclamo }), [doc(33)]);
  assert.equal(reclamada.resumen, 'Reclamado en el SII');
  assert.equal(reclamada.pasos[3].detalle, 'Faltaron 2');
  assert.equal(reclamada.pasos[4].estado, 'hecho');
  assert.equal(reclamada.pasos[5].estado, 'actual', 'espera la nota de crédito');

  const corregida = cicloDelPedido(orden('corregida', { reclamo }), [doc(33), doc(61)]);
  assert.equal(corregida.resumen, 'Nota de crédito recibida');
  assert.ok(corregida.pasos.every(p => p.estado === 'hecho'));
});

test('la nota de crédito vale lo que faltó, o el monto del documento si ya se emitió', () => {
  const o = orden('reclamada', { reclamo: { producto: 'Caja', faltante: 2, en: '', estadoSii: 'recibido' } });
  assert.equal(montoNotaCredito(o, []), 59_800);
  assert.equal(montoNotaCredito(o, [doc(61, { monto: 50_000 })]), 50_000);
});

test('el paso de confirmación solo envía tras el sí y no se puede cancelar a medio envío', () => {
  type A = { faltante: number };
  let e: Confirmacion<A> = SIN_CONFIRMACION;
  e = confirmacion(e, { tipo: 'confirmar' });
  assert.equal(e.fase, 'nada', 'sin pregunta no hay nada que confirmar');
  e = confirmacion(e, { tipo: 'pedir', accion: { faltante: 2 } });
  assert.deepEqual(e, { fase: 'preguntando', accion: { faltante: 2 } });
  e = confirmacion(e, { tipo: 'confirmar' });
  assert.equal(e.fase, 'enviando');
  assert.equal(confirmacion(e, { tipo: 'cancelar' }).fase, 'enviando');
  assert.equal(confirmacion(e, { tipo: 'pedir', accion: { faltante: 9 } }).fase, 'enviando');
  e = confirmacion(e, { tipo: 'fallo', mensaje: 'El SII no responde' });
  assert.deepEqual(e, { fase: 'error', accion: { faltante: 2 }, mensaje: 'El SII no responde' });
  e = confirmacion(e, { tipo: 'confirmar' });
  assert.equal(e.fase, 'enviando', 'desde el error se puede reintentar');
  assert.equal(confirmacion(e, { tipo: 'listo' }).fase, 'nada');
});

test('facturar todo cuenta una factura por orden pendiente de la compra conjunta', () => {
  const lic = licitacion([4, 6], { estado: 'cerrada' });
  const ordenes = [
    orden('confirmada', { id: 'a', licitacionId: 'L-1', items: [{ producto: 'Caja', cantidad: 4, precioUnitario: 29_900 }] }),
    orden('confirmada', { id: 'b', licitacionId: 'L-1', items: [{ producto: 'Caja', cantidad: 6, precioUnitario: 29_900 }] }),
    orden('enviada', { id: 'c' }),
  ];
  assert.deepEqual(resumenFacturacion(lic, ordenes), { facturas: 2, total: 299_000 });
  assert.deepEqual(resumenFacturacion(lic, []), { facturas: 2, total: 299_000 }, 'sin licitacionId, estima con los participantes');
});

test('la compra conjunta queda facturada cuando todas sus órdenes (ordenIds) pasaron por el SII', () => {
  const lic = licitacion([4, 6], { estado: 'cerrada', ordenIds: ['a', 'b'] });
  const enviadas = [orden('enviada', { id: 'a' }), orden('enviada', { id: 'b' }), orden('facturada', { id: 'otra' })];
  assert.equal(estaFacturada(lic, enviadas), false);
  assert.deepEqual(resumenFacturacion(lic, enviadas), { facturas: 2, total: 2 * 8 * 29_900 });
  assert.equal(estaFacturada(lic, [orden('facturada', { id: 'a' }), orden('recibida', { id: 'b' })]), true);
  assert.equal(estaFacturada(licitacion([4]), []), false, 'abierta no está facturada');
});

