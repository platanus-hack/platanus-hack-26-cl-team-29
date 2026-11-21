// Corre solo con DATABASE_URL (una BD desechable: crea y vacía tablas whatsapp_*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostgresStore } from '../server/whatsapp/store-postgres.ts';
import { inbound } from './whatsapp-apoyo.ts';

const url = process.env.DATABASE_URL;

test('el store de Postgres deduplica, retiene, avanza estados y arma el historial', { skip: !url && 'sin DATABASE_URL' }, async () => {
  const db = new pg.Pool({ connectionString: url });
  try {
    const store = await createPostgresStore(db);
    await db.query('truncate whatsapp_messages, whatsapp_contacts');

    assert.equal(await store.recordInbound({ ...inbound('w1', '561', 'hola'), contactName: 'Ana' }), true);
    assert.equal(await store.recordInbound(inbound('w1', '561', 'hola')), false);
    assert.equal((await store.contact('561'))?.name, 'Ana');

    const held = await store.createOutbound({ phone: '561', text: 'pendiente', payload: { body: 'pendiente' }, source: 'agente', status: 'held' });
    assert.deepEqual((await store.heldFor('561')).map(m => m.payload), [{ body: 'pendiente' }]);

    await store.updateOutbound(held.id, { status: 'sent', wamid: 'wamid.out' });
    await store.updateStatusByWamid('wamid.out', 'read', null);
    await store.updateStatusByWamid('wamid.out', 'delivered', null); // tardío: no retrocede
    await store.markTemplateSent('561', new Date());

    const history = await store.history('561', 10);
    assert.deepEqual(history.map(m => [m.direction, m.text, m.status]), [['in', 'hola', 'received'], ['out', 'pendiente', 'read']]);
    assert.ok((await store.contact('561'))?.lastTemplateAt);
  } finally {
    await db.end();
  }
});
