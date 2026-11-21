import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESPERAS_SEGUIMIENTO_MS } from '../server/red/sii-real.ts';

test('el veredicto del SII se consulta rápido al principio y sin insistir después', () => {
  const primerMedioMinuto = ESPERAS_SEGUIMIENTO_MS.reduce((acc, ms) => (acc.t + ms <= 30_000 ? { t: acc.t + ms, n: acc.n + 1 } : acc), { t: 0, n: 0 });
  assert.equal(ESPERAS_SEGUIMIENTO_MS[0], 2_000);
  assert.ok(primerMedioMinuto.n <= 7, 'no más de 7 consultas en el primer medio minuto');
  assert.ok(ESPERAS_SEGUIMIENTO_MS.every(ms => ms >= 2_000), 'nunca más de una consulta cada 2 s');
  const total = ESPERAS_SEGUIMIENTO_MS.reduce((a, b) => a + b, 0);
  assert.ok(total >= 4 * 60_000 && total <= 6 * 60_000, 'sigue esperando unos 5 minutos en total');
});
