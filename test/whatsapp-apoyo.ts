// Piezas compartidas por los tests del módulo de WhatsApp.
import type { InboundMessage, OutboundMessage, WhatsAppSender } from '../server/whatsapp/index.ts';

export const silent = { info() {}, warn() {}, error() {} };

/** Sender falso: registra lo enviado y simula la ventana de 24 h por teléfono. */
export function fakeSender(options: { closedWindow?: Set<string> } = {}) {
  const closed = options.closedWindow ?? new Set<string>();
  const sent: { to: string; body: string; buttons?: readonly { id: string; title: string }[] }[] = [];
  const templates: string[] = [];
  let n = 0;
  const sender: WhatsAppSender = {
    async send(to: string, message: OutboundMessage) {
      if (closed.has(to)) return { ok: false, error: 'Kapso respondió 422: ventana', windowClosed: true };
      sent.push({ to, body: message.body, ...(message.buttons ? { buttons: message.buttons } : {}) });
      return { ok: true, messageIds: [`wamid.out.${++n}`] };
    },
    async sendTemplate(to: string) {
      templates.push(to);
      return { ok: true, messageIds: [`wamid.tpl.${++n}`] };
    },
    async markRead() {
      return { ok: true, messageIds: [] };
    },
  };
  return { sender, sent, templates, closed };
}

export function inbound(id: string, from: string, text = id): InboundMessage {
  return { id, conversationId: `conv_${from}`, from, contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } };
}
