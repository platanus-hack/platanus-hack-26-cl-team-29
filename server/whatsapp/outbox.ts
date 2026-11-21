import type { Log, OutboundMessage, SendOutcome, StoredMessage, TemplateRef, WhatsAppSender } from './types.ts';
import type { WhatsAppStore } from './store.ts';
import { invalidReason, toOutbound } from './outbound-message.ts';

/**
 * Todo envío pasa por acá: se guarda, se manda y queda con su estado.
 *
 * La regla de 24 h de Meta no se puede saltar: fuera de la ventana WhatsApp
 * rechaza el texto libre. Entonces, en vez de perder el mensaje:
 *  1. se intenta siempre (no adivinamos la ventana: así funciona aunque la BD esté vacía);
 *  2. si Meta dice "ventana cerrada", el mensaje queda `held`;
 *  3. si hay plantilla aprobada configurada, se manda UNA vez por ventana para invitar a escribir;
 *  4. cuando la persona vuelve a escribir, `flush` manda los retenidos en orden.
 */
export class Outbox {
  readonly #store: WhatsAppStore;
  readonly #sender: WhatsAppSender;
  readonly #template: TemplateRef | null;
  readonly #log: Log;

  constructor(options: { store: WhatsAppStore; sender: WhatsAppSender; template: TemplateRef | null; log: Log }) {
    this.#store = options.store;
    this.#sender = options.sender;
    this.#template = options.template;
    this.#log = options.log;
  }

  async send(to: string, input: string | OutboundMessage, source: string | null): Promise<SendOutcome> {
    const message = toOutbound(input);
    const invalid = invalidReason(message);
    if (invalid) return { status: 'failed', messageId: null, error: invalid };

    const phone = to.replace(/\D/g, '');
    if (!phone) return { status: 'failed', messageId: null, error: 'Falta el teléfono del destinatario.' };
    const row = await this.#store.createOutbound({ phone, text: message.body || (message.document?.filename ?? ''), payload: message, source, status: 'sending' });
    return this.#deliver(row, message);
  }

  /** Manda los retenidos de esa persona, en orden. Se detiene si la ventana sigue cerrada. */
  async flush(phone: string): Promise<void> {
    for (const row of await this.#store.heldFor(phone)) {
      await this.#store.updateOutbound(row.id, { status: 'sending' });
      const outcome = await this.#deliver(row, row.payload as OutboundMessage);
      if (outcome.status === 'held') return;
    }
  }

  async #deliver(row: StoredMessage, message: OutboundMessage): Promise<SendOutcome> {
    const result = await this.#sender.send(row.phone, message);
    if (result.ok) {
      await this.#store.updateOutbound(row.id, { status: 'sent', wamid: result.messageIds[0] ?? null, error: null });
      return { status: 'sent', messageId: row.id };
    }
    if (result.windowClosed) {
      await this.#store.updateOutbound(row.id, { status: 'held', error: null });
      return { status: 'held', messageId: row.id, templateSent: await this.#nudge(row.phone) };
    }
    await this.#store.updateOutbound(row.id, { status: 'failed', error: result.error.slice(0, 500) });
    this.#log.warn(`[whatsapp] no se pudo enviar a ${row.phone}: ${result.error}`);
    return { status: 'failed', messageId: row.id, error: result.error };
  }

  /** Plantilla para reabrir la ventana, como máximo una vez desde el último mensaje de la persona. */
  async #nudge(phone: string): Promise<boolean> {
    if (!this.#template) return false;
    const contact = await this.#store.contact(phone);
    const lastTemplate = contact?.lastTemplateAt?.getTime() ?? -Infinity;
    const lastInbound = contact?.lastInboundAt?.getTime() ?? -Infinity;
    if (lastTemplate > lastInbound) return false;

    const result = await this.#sender.sendTemplate(phone, this.#template);
    if (!result.ok) {
      this.#log.warn(`[whatsapp] la plantilla ${this.#template.name} no salió a ${phone}: ${result.error}`);
      return false;
    }
    await this.#store.markTemplateSent(phone, new Date());
    return true;
  }
}
