import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageDispatcher } from '../server/whatsapp/dispatcher.ts';
import { Outbox } from '../server/whatsapp/outbox.ts';
import { createMemoryStore } from '../server/whatsapp/store.ts';
import { fakeSender, inbound, silent } from './whatsapp-apoyo.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function setup(options: { template?: boolean } = {}) {
  const fake = fakeSender();
  const store = createMemoryStore();
  const outbox = new Outbox({ store, sender: fake.sender, template: options.template ? { name: 'novedades', language: 'es' } : null, log: silent });
  const dispatcher = new MessageDispatcher({ store, outbox, sender: fake.sender, log: silent });
  return { ...fake, store, outbox, dispatcher };
}

test('los mensajes de una persona se procesan en orden, aunque el primero tarde', async () => {
  const { dispatcher } = setup();
  const log: string[] = [];
  dispatcher.onMessage(async m => {
    log.push(`start ${m.id}`);
    if (m.id === 'a1') await sleep(30);
    log.push(`end ${m.id}`);
  });

  await Promise.all([
    dispatcher.dispatch([inbound('a1', '561')]),
    dispatcher.dispatch([inbound('a2', '561'), inbound('b1', '562')]),
  ]);
  assert.ok(log.indexOf('end a1') < log.indexOf('start a2'), 'a2 esperó a a1');
  assert.ok(log.indexOf('end b1') < log.indexOf('end a1'), 'el otro teléfono no esperó');
});

test('un handler que lanza no impide que corran los demás', async () => {
  const { dispatcher } = setup();
  let reached = false;
  dispatcher.onMessage(() => { throw new Error('boom'); });
  dispatcher.onMessage(() => { reached = true; });

  await dispatcher.dispatch([inbound('x', '561')]);
  assert.equal(reached, true);
});

test('el mismo wamid se procesa una sola vez, aunque llegue en otra entrega', async () => {
  const { dispatcher } = setup();
  let calls = 0;
  dispatcher.onMessage(() => { calls++; });

  await dispatcher.dispatch([inbound('w1', '561')]);
  await dispatcher.dispatch([inbound('w1', '561'), inbound('w1', '561')]);
  assert.equal(calls, 1);
});

test('fuera de la ventana el mensaje queda retenido y la plantilla sale una sola vez', async () => {
  const { outbox, closed, templates, store } = setup({ template: true });
  closed.add('561');

  const first = await outbox.send('561', 'Te llegó un pedido', 'agente');
  const second = await outbox.send('561', 'Te llegó otro pedido', 'agente');
  assert.deepEqual([first.status, second.status], ['held', 'held']);
  assert.equal(first.status === 'held' && first.templateSent, true);
  assert.equal(second.status === 'held' && second.templateSent, false);
  assert.deepEqual(templates, ['561']);
  assert.equal((await store.heldFor('561')).length, 2);
});

test('cuando la persona escribe, primero le llegan los retenidos en orden y después la respuesta', async () => {
  const { dispatcher, outbox, closed, sent } = setup();
  closed.add('561');
  await outbox.send('561', 'pendiente 1', 'agente');
  await outbox.send('561', 'pendiente 2', 'agente');
  dispatcher.onMessage(async (m, ctx) => { await ctx.reply(`respuesta a ${m.text}`); });

  closed.delete('561'); // escribir reabre la ventana
  await dispatcher.dispatch([inbound('w1', '561', 'hola')]);
  assert.deepEqual(sent.map(s => s.body), ['pendiente 1', 'pendiente 2', 'respuesta a hola']);
});

test('un mensaje con botones inválidos se rechaza sin llamar al proveedor', async () => {
  const { outbox, sent } = setup();
  const result = await outbox.send('561', { body: 'elige', buttons: [{ id: 'a', title: 'Un título demasiado largo' }] }, null);
  assert.equal(result.status, 'failed');
  assert.equal(sent.length, 0);
});
