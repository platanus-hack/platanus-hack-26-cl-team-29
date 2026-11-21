import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaCorta, fechaEnChile, fechaLarga, horaEnChile, marcaEnChile } from '../shared/fecha.ts';

test('la fecha y la hora salen en Chile, con su horario de verano', () => {
  // 02:00 UTC del 21 es todavía el 20 en Chile (UTC-3 en noviembre).
  assert.equal(fechaEnChile('2026-11-21T02:00:00Z'), '2026-11-20');
  assert.equal(marcaEnChile(new Date('2026-07-01T12:00:00Z')), '2026-07-01T08:00:00');
  assert.equal(horaEnChile(Date.parse('2026-11-21T15:30:00Z')), '12:30');
});

test('fechas para leer: corta y larga', () => {
  assert.equal(fechaCorta('2026-01-15'), '15-01-2026', 'un día no se mueve de zona');
  assert.equal(fechaCorta('2026-11-21T02:00:00Z'), '20-11-2026');
  assert.equal(fechaCorta(''), '');
  assert.equal(fechaLarga('2026-03-05'), '5 de marzo de 2026');
  assert.equal(fechaLarga('mañana'), 'mañana');
});
