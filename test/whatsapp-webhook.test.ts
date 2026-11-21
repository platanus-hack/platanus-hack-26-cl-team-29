import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createWhatsApp, type InboundMessage, type WhatsAppSender } from '../server/whatsapp/index.ts';
import { signPayload } from '../server/whatsapp/kapso/signature.ts';

const SECRET = 'test-secret';
const silent = { info() {}, warn() {}, error() {} };

function fakeSender() {
  const sent: { to: string; body: string }[] = [];
  const sender: WhatsAppSender = {
    async sendText(to, body) { sent.push({ to, body }); return { ok: true, messageIds: ['x'] }; },
    async markRead() { return { ok: true, messageIds: [] }; },
  };
  return { sender, sent };
}

async function start(secret: string | null = SECRET) {
  const { sender, sent } = fakeSender();
  const whatsapp = createWhatsApp({ env: { KAPSO_WEBHOOK_SECRET: secret ?? undefined }, sender, log: silent });
  const app = express();
  app.use('/api/whatsapp', whatsapp.router);
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/whatsapp/webhook`;
  return { whatsapp, sent, url, close: () => server.close() };
}

function delivery(id: string, text: string, conversationId = 'conv_1') {
  return JSON.stringify({
    message: { id, timestamp: '1730092800', type: 'text', from: '56911112222', text: { body: text }, kapso: { direction: 'inbound' } },
    conversation: { id: conversationId, phone_number: '56911112222' },
  });
}

function post(url: string, body: string, signature = signPayload(body, SECRET)) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'whatsapp.message.received', 'X-Webhook-Signature': signature },
    body,
  });
}

function nextMessages(whatsapp: { onMessage: (h: (m: InboundMessage) => void) => unknown }, count: number) {
  const received: InboundMessage[] = [];
  return new Promise<InboundMessage[]>(resolve =>
    whatsapp.onMessage(m => { received.push(m); if (received.length === count) resolve(received); }));
}

test('un mensaje firmado llega al handler y ctx.reply responde al remitente', async () => {
  const { whatsapp, sent, url, close } = await start();
  const replied = new Promise<void>(resolve =>
    whatsapp.onMessage(async (m, ctx) => { await ctx.reply(`eco: ${m.text}`); resolve(); }));

  assert.equal((await post(url, delivery('w1', 'hola'))).status, 200);
  await replied;
  assert.deepEqual(sent, [{ to: '56911112222', body: 'eco: hola' }]);
  close();
});

test('una firma inválida se rechaza y no llega a ningún handler', async () => {
  const { whatsapp, url, close } = await start();
  let called = false;
  whatsapp.onMessage(() => { called = true; });

  assert.equal((await post(url, delivery('w1', 'hola'), 'deadbeef')).status, 401);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(called, false);
  close();
});

test('un reintento de Kapso con el mismo mensaje se procesa una sola vez', async () => {
  const { whatsapp, url, close } = await start();
  const texts: string[] = [];
  whatsapp.onMessage(m => { texts.push(m.text); });
  const done = nextMessages(whatsapp, 2);

  await post(url, delivery('w1', 'primero'));
  await post(url, delivery('w1', 'primero'));
  await post(url, delivery('w2', 'segundo'));
  await done;
  assert.deepEqual(texts, ['primero', 'segundo']);
  close();
});

test('sin secreto configurado el webhook responde 503', async () => {
  const { url, close } = await start(null);
  assert.equal((await post(url, delivery('w1', 'hola'))).status, 503);
  close();
});
