import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangoDelCaf } from '../server/red/sii-real.ts';

const caf = (tipo: number, d: number, h: number) =>
  Buffer.from(`<AUTORIZACION><CAF><DA><TD>${tipo}</TD><RNG><D>${d}</D><H>${h}</H></RNG></DA></CAF></AUTORIZACION>`, 'latin1').toString('base64');

test('SII_FOLIO_DESDE adelanta el inicio del rango, pero nunca lo atrasa', () => {
  const base = { SII_CAF_33_BASE64: caf(33, 100, 200) };
  assert.deepEqual(rangoDelCaf(base, 33), { desde: 100, hasta: 200 });
  assert.deepEqual(rangoDelCaf({ ...base, SII_FOLIO_DESDE_33: '150' }, 33), { desde: 150, hasta: 200 });
  assert.deepEqual(rangoDelCaf({ ...base, SII_FOLIO_DESDE_33: '50' }, 33), { desde: 100, hasta: 200 });
});
