import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KapsoSender } from '../server/whatsapp/kapso/sender.ts';
import { verifySignature, signPayload } from '../server/whatsapp/kapso/signature.ts';

function fakeFetch(statuses: number[], errorBody: unknown = { error: { message: 'nope' } }) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify(status < 300 ? { messages: [{ id: `wamid.${calls.length}` }] } : errorBody), { status });
  }) as typeof fetch;
  return { fn, calls };
}

const sender = (fetch: typeof globalThis.fetch) =>
  new KapsoSender({ apiKey: 'k', phoneNumberId: '123', fetch, retryDelayMs: 1 });

test('sendText llama a Kapso con la forma de la Cloud API', async () => {
  const { fn, calls } = fakeFetch([200]);
  const result = await sender(fn).send('+56 9 1111 2222', { body: 'hola' });

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
  const result = await sender(fn).send('569', { body: long });

  assert.ok(result.ok && result.messageIds.length > 1);
  assert.ok(calls.every(c => c.body.text.body.length <= 4096));
  assert.equal(calls.map(c => c.body.text.body).join(' '), long);
});

test('reintenta un 5xx pero no un 4xx', async () => {
  const retried = fakeFetch([503, 200]);
  assert.equal((await sender(retried.fn).send('569', { body: 'x' })).ok, true);
  assert.equal(retried.calls.length, 2);

  const rejected = fakeFetch([400]);
  assert.deepEqual(await sender(rejected.fn).send('569', { body: 'x' }), { ok: false, error: 'Kapso respondió 400: nope', windowClosed: false });
  assert.equal(rejected.calls.length, 1);
});

test('los botones van como mensaje interactivo de tipo button', async () => {
  const { fn, calls } = fakeFetch([200]);
  await sender(fn).send('569', { body: '¿Facturo?', buttons: [{ id: 'si', title: 'Sí, factura todo' }, { id: 'ver', title: 'Ver los pedidos' }] });
  assert.deepEqual(calls[0]!.body.interactive, {
    type: 'button',
    body: { text: '¿Facturo?' },
    action: { buttons: [{ type: 'reply', reply: { id: 'si', title: 'Sí, factura todo' } }, { type: 'reply', reply: { id: 'ver', title: 'Ver los pedidos' } }] },
  });
});

test('el 422 de Kapso por la ventana de 24 h se reconoce y no se reintenta', async () => {
  const { fn, calls } = fakeFetch([422], { error: 'Cannot send non-template messages outside the 24-hour window.' });
  const result = await sender(fn).send('569', { body: 'x' });
  assert.equal(!result.ok && result.windowClosed, true);
  assert.equal(calls.length, 1);
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

test('una lista va como mensaje interactivo de tipo list, con sus filas', async () => {
  const { fn, calls } = fakeFetch([200]);
  await sender(fn).send('569', { body: '¿Qué producto?', list: { button: 'Ver opciones', rows: [{ id: 'op1', title: 'Rollos', description: '$32.000 por caja' }, { id: 'op2', title: 'Guantes' }] } });
  assert.deepEqual(calls[0]!.body.interactive, {
    type: 'list',
    body: { text: '¿Qué producto?' },
    action: { button: 'Ver opciones', sections: [{ title: 'Ver opciones', rows: [{ id: 'op1', title: 'Rollos', description: '$32.000 por caja' }, { id: 'op2', title: 'Guantes' }] }] },
  });
});
