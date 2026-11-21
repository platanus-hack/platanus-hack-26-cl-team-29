import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aparicionVideo, guionVideo, MAX_NEGOCIOS, negociosEn } from '../client/src/mapa/video.ts';
import { MAX_TARJETAS, VIDA_TARJETA } from '../client/src/mapa/crece.ts';

test('video: crece de 1 a 2.000 negocios y negociosEn es la inversa de aparicionVideo', () => {
  assert.equal(negociosEn(2000), 1);
  assert.equal(negociosEn(60_000), MAX_NEGOCIOS);
  for (const i of [1, 10, 119, 999, 1999]) assert.ok(negociosEn(aparicionVideo(i) + 1) >= i + 1);
});

test('video: nunca hay más tarjetas vivas que MAX_TARJETAS', () => {
  const ts = guionVideo().map(p => p.t);
  for (const t of ts) assert.ok(ts.filter(x => x <= t && t - x < VIDA_TARJETA).length <= MAX_TARJETAS);
});
