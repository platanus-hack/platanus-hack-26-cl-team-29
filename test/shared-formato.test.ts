import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dinero, miles, nota } from '../shared/formato.ts';

// Regla fija: todo monto lleva separador de miles, también los de cuatro dígitos (web, WhatsApp y PDF usan este).
test('montos con separador de miles y sin decimales', () => {
  assert.equal(dinero(950), '$950');
  assert.equal(dinero(6900), '$6.900');
  assert.equal(dinero(17200), '$17.200');
  assert.equal(dinero(1234567), '$1.234.567');
  assert.equal(dinero(1234.6), '$1.235');
  assert.equal(dinero(-8400), '-$8.400');
  assert.equal(miles(45000), '45.000');
});

test('nota con coma decimal', () => {
  assert.equal(nota(4.2), '4,2');
  assert.equal(nota(5), '5,0');
});
