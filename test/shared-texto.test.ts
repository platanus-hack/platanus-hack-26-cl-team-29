import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contar, cuantos, mayuscula, pluralDe, segun, sinTildes } from '../shared/texto.ts';

test('plural en español, o el que ya se conoce', () => {
  assert.equal(pluralDe('saco'), 'sacos');
  assert.equal(pluralDe('bidón'), 'bidones');
  assert.equal(pluralDe('unidad'), 'unidades');
  assert.equal(pluralDe('caja', 'cajitas'), 'cajitas');
});

test('conteos con la palabra según la cantidad y miles con punto', () => {
  assert.equal(contar(1, 'negocio'), '1 negocio');
  assert.equal(contar(3, 'día'), '3 días');
  assert.equal(contar(2, 'proveedor'), '2 proveedores');
  assert.equal(contar(1200, 'unidad'), '1.200 unidades');
  assert.equal(contar(2, 'folio libre', 'folios libres'), '2 folios libres');
  assert.equal(segun(2, 'Falta', 'Faltan'), 'Faltan');
});

test('género de la pregunta, mayúscula inicial y comparación sin tildes', () => {
  assert.equal(cuantos('cajas'), 'Cuántas');
  assert.equal(cuantos('unidades'), 'Cuántas');
  assert.equal(cuantos('sacos'), 'Cuántos');
  assert.equal(mayuscula('rollos'), 'Rollos');
  assert.equal(sinTildes('Ñuñoa Panadería'), 'nunoa panaderia');
});
