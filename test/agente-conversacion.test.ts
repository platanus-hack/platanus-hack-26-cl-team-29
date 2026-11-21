import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conectarAgente } from '../server/agente/index.ts';
import { interpreteDeReglas } from '../server/agente/intencion.ts';
import { crearRedFalsa } from '../server/agente/red-falsa.ts';
import type { Negocio } from '../server/agente/puerto.ts';
import type { MessageHandler } from '../server/whatsapp/index.ts';

const PICA: Negocio = { id: 'pica', nombre: 'La Picá', comuna: 'Maipú', rol: 'comprador', telefono: 'tel-pica' };
const MOLINOS: Negocio = { id: 'molinos', nombre: 'Molinos del Sur', comuna: 'Maipú', rol: 'proveedor', telefono: 'tel-molinos' };
const LEJANO: Negocio = { id: 'lejano', nombre: 'Harinas del Norte', comuna: 'Arica', rol: 'proveedor', telefono: 'tel-lejano' };

/** WhatsApp falso: guarda todo lo que el agente envía, por teléfono. */
function montar(opciones: { despachar?: (n: number) => number } = {}) {
  const red = crearRedFalsa([PICA, MOLINOS, LEJANO], { notas: { molinos: 4.4, lejano: 4.9 }, ...opciones });
  const enviados: { to: string; body: string }[] = [];
  let handler: MessageHandler = () => {};
  const whatsapp = {
    onMessage: (h: MessageHandler) => { handler = h; return () => {}; },
    sendText: async (to: string, body: string) => { enviados.push({ to, body }); return { ok: true as const, messageIds: [] }; },
  };
  conectarAgente(whatsapp, red, { interprete: interpreteDeReglas });
  let n = 0;
  const escribir = async (from: string, text: string) => {
    const id = `m${n++}`;
    await handler(
      { id, conversationId: from, from, contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } },
      {
        reply: async body => { enviados.push({ to: from, body }); return { ok: true, messageIds: [] }; },
        markRead: async () => ({ ok: true, messageIds: [] }),
      },
    );
  };
  const ultimo = (to: string) => enviados.filter(e => e.to === to).at(-1)?.body ?? '';
  return { red, escribir, ultimo, enviados };
}

test('un pedido se propone al mejor proveedor cercano y no se crea sin un sí', async () => {
  const { red, escribir, ultimo } = montar();
  await escribir('tel-pica', 'pide 4 sacos de harina');
  assert.match(ultimo('tel-pica'), /Molinos del Sur \(Maipú\), nota 4,4/);
  assert.deepEqual(red.llamadas, []);

  await escribir('tel-pica', 'no');
  assert.equal(ultimo('tel-pica'), 'Listo, no hice nada.');
  await escribir('tel-pica', 'sí');
  assert.deepEqual(red.llamadas, [], 'un sí después de cancelar no ejecuta nada');
});

test('un sí repetido no ejecuta la acción dos veces', async () => {
  const { red, escribir, enviados } = montar();
  await escribir('tel-pica', 'pide 4 sacos de harina');
  await Promise.all([escribir('tel-pica', 'sí'), escribir('tel-pica', 'sí')]);
  assert.deepEqual(red.llamadas, ['crearOrden']);
  assert.ok(enviados.some(e => e.to === 'tel-pica' && e.body === 'No tengo nada pendiente por confirmar.'));
});

test('flujo completo: pedido, factura, reclamo con aviso al proveedor y nota de crédito con aviso al comprador', async () => {
  const { red, escribir, ultimo } = montar({ despachar: n => n - 2 });

  await escribir('tel-pica', 'pide 4 sacos de harina');
  await escribir('tel-pica', 'sí');
  assert.match(ultimo('tel-molinos'), /Nuevo pedido de La Picá: 4 sacos de harina, \$68\.800/);

  await escribir('tel-molinos', 'Sí, factura todo');
  assert.equal(
    ultimo('tel-pica'),
    'Llegó la factura de Molinos del Sur. 4 sacos de harina, $68.800. Tu orden de compra decía 4 sacos, pero la guía de despacho dice 2. ¿Recibiste todo?\n1. Sí, todo bien\n2. No, faltó algo',
  );

  await escribir('tel-pica', 'Faltaron 2 sacos');
  assert.ok(!red.llamadas.some(l => l.startsWith('registrarRecepcion')), 'el reclamo espera confirmación');
  await escribir('tel-pica', 'sí');
  assert.ok(red.llamadas.includes('registrarRecepcion oc-1 faltante 2'));
  assert.match(ultimo('tel-pica'), /^Listo, la reclamé en el SII por falta parcial\. Te quedaban 8 días de plazo\. .*Su nota bajó a 4,2 para los 1 negocios/);
  assert.match(ultimo('tel-molinos'), /La Picá reclamó .*faltaron 2\. ¿Emito nota de crédito por \$34\.400\?/);

  await escribir('tel-molinos', 'Sí, emítela');
  assert.ok(red.llamadas.includes('emitirNotaCredito oc-1'));
  assert.equal(
    ultimo('tel-molinos'),
    'Nota de crédito emitida en el SII, amarrada a la factura original. Ya le avisé a La Picá. Lo resolviste el mismo día: tu nota sube de 4,2 a 4,4.',
  );
  assert.match(ultimo('tel-pica'), /Molinos del Sur emitió la nota de crédito por \$34\.400/);
});
