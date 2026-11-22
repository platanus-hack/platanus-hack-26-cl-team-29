import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarPorGrupo, grupoDe, largoDeBarras, ventasDeHoy } from '../client/src/proveedor/pedidos.ts';

const AHORA = Date.parse('2026-11-21T15:00:00');
const pedido = (estado: Parameters<typeof grupoDe>[0], creadaEn = '2026-11-21T10:00:00', cantidad = 2, precioUnitario = 10000) =>
  ({ estado, creadaEn, items: [{ cantidad, precioUnitario }] });

test('cada estado cae en un grupo de la cabecera de pedidos', () => {
  const cuenta = contarPorGrupo(['enviada', 'confirmada', 'facturada', 'recibida', 'corregida', 'reclamada'].map(e => pedido(e as never)));
  assert.deepEqual(cuenta, { confirmar: 2, camino: 1, recibidos: 2, reclamos: 1 });
});

test('lo vendido hoy cuenta solo pedidos de hoy ya confirmados', () => {
  const ventas = ventasDeHoy([
    pedido('enviada'), // todavía no es venta
    pedido('facturada'), pedido('recibida', '2026-11-21T08:00:00', 1, 5000),
    pedido('recibida', '2026-11-20T18:00:00'), // ayer
  ], AHORA);
  assert.deepEqual(ventas, { total: 25000, pedidos: 2, notasDeCredito: 0 });
});

test('lo vendido hoy descuenta las notas de crédito de esos pedidos', () => {
  const pedidos = [{ ...pedido('reclamada'), id: 'oc-1' }, { ...pedido('facturada'), id: 'oc-2' }];
  const documentos = [{ tipo: 33 as const, ordenId: 'oc-1', monto: 20000 }, { tipo: 61 as const, ordenId: 'oc-1', monto: -5000 }];
  assert.deepEqual(ventasDeHoy(pedidos, AHORA, documentos), { total: 35000, pedidos: 2, notasDeCredito: 5000 });
});

test('la barra más cara se llena, la más barata queda en un tercio y un solo precio llena la suya', () => {
  assert.deepEqual(largoDeBarras([30000, 25000, 20000]).map(x => Math.round(x * 100)), [100, 67, 33]);
  assert.deepEqual(largoDeBarras([5000]), [1]);
});
