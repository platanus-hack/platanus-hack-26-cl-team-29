import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';

process.env.PORT = '0';
const { server } = await import('../server/index.ts');
const url = `http://localhost:${(server.address() as AddressInfo).port}`;

test('un evento de un cliente llega al otro', async () => {
  const a = io(url), b = io(url);
  await Promise.all([a, b].map(s => new Promise(r => s.on('connect', () => r(null)))));
  const recibido = new Promise(r => b.on('evento', r));
  a.emit('evento', 'hola');
  assert.equal(await recibido, 'hola');
  a.close(); b.close(); server.close(); await (await import('node:timers/promises')).setTimeout(0);
  process.exit(0);
});
