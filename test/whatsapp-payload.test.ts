import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelivery } from '../server/whatsapp/kapso/payload.ts';

// Forma documentada de Kapso v2 (message-events.md).
function item(message: Record<string, unknown>, conversationId = 'conv_1') {
  return {
    message: { id: 'wamid.1', timestamp: '1730092800', type: 'text', from: '16315551181', ...message },
    conversation: { id: conversationId, contact_name: 'John Doe', phone_number: '+1 631 555 1181' },
  };
}
const inbound = { direction: 'inbound' };

test('un mensaje de texto se convierte al tipo de dominio', () => {
  const { messages } = parseDelivery(
    item({ text: { body: 'Hola' }, kapso: { ...inbound, content: 'Hola' } }),
    'whatsapp.message.received',
  );
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    id: 'wamid.1',
    conversationId: 'conv_1',
    from: '16315551181',
    contactName: 'John Doe',
    sentAt: new Date(1730092800 * 1000),
    text: 'Hola',
    content: { kind: 'text', text: 'Hola' },
  });
});

test('nuestro propio mensaje saliente no vuelve como entrante', () => {
  const { messages } = parseDelivery(
    item({ text: { body: 'respuesta' }, kapso: { direction: 'outbound' } }),
    'whatsapp.message.received',
  );
  assert.equal(messages.length, 0);
});

test('eventos que no son message.received se ignoran sin fallar', () => {
  const delivery = parseDelivery(item({ text: { body: 'x' } }), 'whatsapp.message.delivered');
  assert.deepEqual([delivery.messages, delivery.failures], [[], []]);
});

test('un batch conserva el orden y un ítem roto no bota a los demás', () => {
  const delivery = parseDelivery({
    type: 'batch',
    batch: true,
    data: [
      item({ id: 'a', text: { body: 'uno' }, kapso: inbound }),
      { message: { id: 'roto' } },
      item({ id: 'b', text: { body: 'dos' }, kapso: inbound }),
    ],
  });
  assert.deepEqual(delivery.messages.map(m => m.text), ['uno', 'dos']);
  assert.equal(delivery.failures.length, 1);
});

test('una ubicación no usa el resumen sintético de Kapso como texto', () => {
  const { messages } = parseDelivery(
    item({
      type: 'location',
      location: { latitude: '-33.414', longitude: -70.59, name: 'Fundo El Roble' },
      kapso: { ...inbound, content: 'Lat: -33.414, Long: -70.59' },
    }),
    'whatsapp.message.received',
  );
  assert.equal(messages[0]!.text, '');
  assert.deepEqual(messages[0]!.content, { kind: 'location', lat: -33.414, lng: -70.59, label: 'Fundo El Roble' });
});

test('una coordenada sin su par no es una ubicación', () => {
  const { messages } = parseDelivery(
    item({ type: 'location', location: { latitude: -33.4, longitude: '' }, kapso: inbound }),
    'whatsapp.message.received',
  );
  assert.equal(messages[0]!.content.kind, 'unsupported');
});

test('una nota de voz expone su transcripción como texto', () => {
  const { messages } = parseDelivery(
    item({
      type: 'audio',
      kapso: { ...inbound, media_url: 'https://api.kapso.ai/media/a', transcript: { text: 'se rompió la bomba' } },
    }),
    'whatsapp.message.received',
  );
  assert.equal(messages[0]!.text, 'se rompió la bomba');
  assert.equal(messages[0]!.content.kind, 'media');
});

test('un evento de error trae el wamid y el motivo', () => {
  const { statuses, messages } = parseDelivery(
    item({ id: 'wamid.out', errors: [{ code: 131026, message: 'Message undeliverable' }], kapso: { direction: 'outbound' } }),
    'whatsapp.message.failed',
  );
  assert.deepEqual(statuses, [{ wamid: 'wamid.out', status: 'failed', error: 'Message undeliverable' }]);
  assert.equal(messages.length, 0);
});
