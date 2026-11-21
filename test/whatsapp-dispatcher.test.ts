import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageDispatcher } from '../server/whatsapp/dispatcher.ts';
import { LogSender } from '../server/whatsapp/log-sender.ts';
import type { InboundMessage } from '../server/whatsapp/index.ts';

const silent = { info() {}, warn() {}, error() {} };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function message(id: string, conversationId: string): InboundMessage {
  return { id, conversationId, from: '569', contactName: null, sentAt: new Date(), text: id, content: { kind: 'text', text: id } };
}

test('los mensajes de una conversación se procesan en orden, aunque el primero tarde', async () => {
  const dispatcher = new MessageDispatcher(new LogSender(silent), silent);
  const log: string[] = [];
  dispatcher.onMessage(async m => {
    log.push(`start ${m.id}`);
    if (m.id === 'a1') await sleep(30);
    log.push(`end ${m.id}`);
  });

  await Promise.all([
    dispatcher.dispatch([message('a1', 'A')]),
    dispatcher.dispatch([message('a2', 'A'), message('b1', 'B')]),
  ]);
  assert.ok(log.indexOf('end a1') < log.indexOf('start a2'), 'a2 esperó a a1');
  assert.ok(log.indexOf('end b1') < log.indexOf('end a1'), 'B no esperó a A');
});

test('un handler que lanza no impide que corran los demás', async () => {
  const dispatcher = new MessageDispatcher(new LogSender(silent), silent);
  let reached = false;
  dispatcher.onMessage(() => { throw new Error('boom'); });
  dispatcher.onMessage(() => { reached = true; });

  await dispatcher.dispatch([message('x', 'A')]);
  assert.equal(reached, true);
});
