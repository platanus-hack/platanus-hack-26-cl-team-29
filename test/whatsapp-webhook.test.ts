import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createWhatsApp, type WhatsApp } from '../server/whatsapp/index.ts';
import { signPayload } from '../server/whatsapp/kapso/signature.ts';
import { fakeSender, silent } from './whatsapp-apoyo.ts';

const SECRET = 'test-secret';

async function start(secret: string | null = SECRET) {
  const fake = fakeSender();
  const whatsapp = await createWhatsApp({ env: { KAPSO_WEBHOOK_SECRET: secret ?? undefined }, sender: fake.sender, log: silent });
  const app = express();
  app.use('/api/whatsapp', whatsapp.router);
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/whatsapp/webhook`;
  return { whatsapp, sent: fake.sent, url, close: () => server.close() };
}

function delivery(id: string, message: Record<string, unknown>) {
  return JSON.stringify({
    message: { id, timestamp: '1730092800', from: '56911112222', kapso: { direction: 'inbound' }, ...message },
    conversation: { id: 'conv_1', phone_number: '56911112222' },
  });
}
const text = (id: string, body: string) => delivery(id, { type: 'text', text: { body } });

function post(url: string, body: string, event = 'whatsapp.message.received', signature = signPayload(body, SECRET)) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': event, 'X-Webhook-Signature': signature },
    body,
  });
}

function nextMessage(whatsapp: WhatsApp) {
  return new Promise<Parameters<Parameters<WhatsApp['onMessage']>[0]>[0]>(resolve => whatsapp.onMessage(m => resolve(m)));
}

test('un mensaje firmado llega al handler y ctx.reply responde al remitente', async () => {
  const { whatsapp, sent, url, close } = await start();
  const replied = new Promise<void>(resolve =>
    whatsapp.onMessage(async (m, ctx) => { await ctx.reply(`eco: ${m.text}`); resolve(); }));

  assert.equal((await post(url, text('w1', 'hola'))).status, 200);
  await replied;
  assert.deepEqual(sent, [{ to: '56911112222', body: 'eco: hola' }]);
  close();
});

test('una firma inválida se rechaza y no llega a ningún handler', async () => {
  const { whatsapp, url, close } = await start();
  let called = false;
  whatsapp.onMessage(() => { called = true; });

  assert.equal((await post(url, text('w1', 'hola'), undefined, 'deadbeef')).status, 401);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(called, false);
  close();
});

test('apretar un botón llega como reply con el id que le pusimos', async () => {
  const { whatsapp, url, close } = await start();
  const received = nextMessage(whatsapp);
  await post(url, delivery('w1', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'facturar', title: 'Sí, factura todo' } } }));

  const m = await received;
  assert.deepEqual(m.content, { kind: 'reply', id: 'facturar', title: 'Sí, factura todo' });
  assert.equal(m.text, 'Sí, factura todo');
  close();
});

test('entrantes y salientes quedan en el historial, y el estado avanza con los eventos de Kapso', async () => {
  const { whatsapp, url, close } = await start();
  const replied = new Promise<void>(resolve => whatsapp.onMessage(async (_m, ctx) => { await ctx.reply('ok'); resolve(); }));
  await post(url, text('w1', 'hola'));
  await replied;

  await post(url, delivery('wamid.out.1', { kapso: { direction: 'outbound' } }), 'whatsapp.message.read');
  await post(url, delivery('wamid.out.1', { kapso: { direction: 'outbound' } }), 'whatsapp.message.delivered');
  await new Promise(r => setTimeout(r, 20));

  const history = await whatsapp.history('+56 9 1111 2222');
  assert.deepEqual(history.map(h => [h.direction, h.text, h.status]), [['in', 'hola', 'received'], ['out', 'ok', 'read']]);
  close();
});

test('sin secreto configurado el webhook responde 503', async () => {
  const { url, close } = await start(null);
  assert.equal((await post(url, text('w1', 'hola'))).status, 503);
  close();
});

test('sendDocument manda el adjunto con la leyenda, lo guarda con su source y no lanza si es inválido', async () => {
  const { whatsapp, sent, close } = await start();
  try {
    const document = { link: 'https://demo.invalid/pdf/doc-5190', filename: 'factura-5190.pdf' };
    const result = await whatsapp.sendDocument('+56 9 1111 2222', { ...document, caption: 'Tu factura folio 5190' }, { source: 'agente' });
    assert.equal(result.ok, true);
    assert.deepEqual(sent, [{ to: '56911112222', body: 'Tu factura folio 5190', document }]);
    const [stored] = await whatsapp.history('56911112222');
    assert.deepEqual([stored!.source, stored!.payload], ['agente', { body: 'Tu factura folio 5190', document }]);

    assert.equal((await whatsapp.sendDocument('569', { link: '/relativo.pdf', filename: 'f.pdf' })).ok, false);
    assert.equal(sent.length, 1);
  } finally {
    close();
  }
});
