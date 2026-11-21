import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarConReglas } from '../server/agente/intencion.ts';

test('el parser de reglas entiende las frases de la demo', () => {
  assert.deepEqual(interpretarConReglas('Pide 4 sacos de harina'), { tipo: 'pedir', cantidad: 4, producto: 'sacos de harina' });
  assert.deepEqual(interpretarConReglas('pídeme cuatro sacos de harina'), { tipo: 'pedir', cantidad: 4, producto: 'sacos de harina' });
  assert.deepEqual(interpretarConReglas('Faltaron 2 sacos'), { tipo: 'faltante', cantidad: 2 });
  assert.deepEqual(interpretarConReglas('Sí, todo bien'), { tipo: 'conforme' });
  assert.deepEqual(interpretarConReglas('Sí, factura todo'), { tipo: 'si' });
  assert.deepEqual(interpretarConReglas('Sí, emítela'), { tipo: 'si' });
  assert.deepEqual(interpretarConReglas('emite la nota de crédito'), { tipo: 'si' });
  assert.deepEqual(interpretarConReglas('1'), { tipo: 'si' });
  assert.deepEqual(interpretarConReglas('No'), { tipo: 'no' });
  assert.deepEqual(interpretarConReglas('pedidos'), { tipo: 'ver_pedidos' });
  assert.deepEqual(interpretarConReglas('hola'), { tipo: 'otro' });
});
