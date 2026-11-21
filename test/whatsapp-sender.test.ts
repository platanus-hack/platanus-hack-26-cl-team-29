import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KapsoSender } from '../server/whatsapp/kapso/sender.ts';
import { verifySignature, signPayload } from '../server/whatsapp/kapso/signature.ts';

function fakeFetch(statuses: number[]) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify(status < 300 ? { messages: [{ id: `wamid.${calls.length}` }] } : { error: { message: 'nope' } }), { status });
  }) as typeof fetch;
  return { fn, calls };
}

const sender = (fetch: typeof globalThis.fetch) =>
  new KapsoSender({ apiKey: 'k', phoneNumberId: '123', fetch, retryDelayMs: 1 });

test('sendText llama a Kapso con la forma de la Cloud API', async () => {
  const { fn, calls } = fakeFetch([200]);
  const result = await sender(fn).sendText('+56 9 1111 2222', 'hola');

  assert.deepEqual(result, { ok: true, messageIds: ['wamid.1'] });
  assert.equal(calls[0]!.url, 'https://api.kapso.ai/meta/whatsapp/v24.0/123/messages');
  assert.equal(calls[0]!.headers['X-API-Key'], 'k');
  assert.deepEqual(calls[0]!.body, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '56911112222', type: 'text', text: { body: 'hola' },
  });
});

test('un texto más largo que el límite se manda en varios mensajes, sin perder nada', async () => {
  const { fn, calls } = fakeFetch([]);
  const long = Array.from({ length: 1200 }, (_, i) => `palabra${i}`).join(' ');
  const result = await sender(fn).sendText('569', long);

  assert.ok(result.ok && result.messageIds.length > 1);
  assert.ok(calls.every(c => c.body.text.body.length <= 4096));
  assert.equal(calls.map(c => c.body.text.body).join(' '), long);
});

test('reintenta un 5xx pero no un 4xx', async () => {
  const retried = fakeFetch([503, 200]);
  assert.equal((await sender(retried.fn).sendText('569', 'x')).ok, true);
  assert.equal(retried.calls.length, 2);

  const rejected = fakeFetch([400]);
  assert.deepEqual(await sender(rejected.fn).sendText('569', 'x'), { ok: false, error: 'Kapso respondió 400: nope' });
  assert.equal(rejected.calls.length, 1);
});

test('la firma se verifica sobre los bytes crudos', () => {
  const body = Buffer.from('{"a":1}');
  assert.equal(verifySignature(body, signPayload(body, 's'), 's'), true);
  assert.equal(verifySignature(body, `sha256=${signPayload(body, 's')}`, 's'), true);
  assert.equal(verifySignature(Buffer.from('{"a":2}'), signPayload(body, 's'), 's'), false);
});

test('fuera de server/whatsapp nadie importa el adaptador de Kapso', () => {
  const offenders = [...filesIn('server'), ...filesIn('client')]
    .filter(f => !f.startsWith(join('server', 'whatsapp')))
    .filter(f => /from ['"][^'"]*whatsapp\/(?!index\.ts)/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && /\.tsx?$/.test(e.name))
    .map(e => join(e.parentPath, e.name));
}
