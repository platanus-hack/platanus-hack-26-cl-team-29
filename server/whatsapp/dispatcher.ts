import type { InboundMessage, Log, MessageContext, MessageHandler, SendOutcome, SendResult, WhatsAppSender } from './types.ts';
import type { WhatsAppStore } from './store.ts';
import type { Outbox } from './outbox.ts';

/**
 * Entrega cada mensaje entrante a los handlers registrados.
 *
 *  - **Una sola vez:** el wamid se guarda en la BD; un reintento de Kapso (o un
 *    batch reenviado) no vuelve a correr los handlers, ni siquiera tras reiniciar.
 *  - **Primero lo pendiente:** antes de los handlers se mandan los mensajes que
 *    estaban retenidos por la ventana de 24 h, que acaba de reabrirse.
 *  - **En orden por persona:** si el handler del mensaje 1 tarda (un LLM), el
 *    mensaje 2 del mismo teléfono espera; teléfonos distintos corren en paralelo.
 *  - **Aislado:** un handler que lanza se loguea y no frena a los demás.
 */
export class MessageDispatcher {
  readonly #handlers = new Set<MessageHandler>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #store: WhatsAppStore;
  readonly #outbox: Outbox;
  readonly #sender: WhatsAppSender;
  readonly #log: Log;

  constructor(options: { store: WhatsAppStore; outbox: Outbox; sender: WhatsAppSender; log: Log }) {
    this.#store = options.store;
    this.#outbox = options.outbox;
    this.#sender = options.sender;
    this.#log = options.log;
  }

  /** Devuelve la función para desuscribirse. */
  onMessage(handler: MessageHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  /** Resuelve cuando todos los mensajes fueron procesados. Nunca rechaza. */
  async dispatch(messages: readonly InboundMessage[]): Promise<void> {
    const runs: Promise<void>[] = [];
    for (const message of messages) {
      try {
        if (await this.#store.recordInbound(message)) runs.push(this.#enqueue(message));
      } catch (error) {
        this.#log.error(`[whatsapp] no se pudo guardar ${message.id}:`, error);
      }
    }
    await Promise.all(runs);
  }

  #enqueue(message: InboundMessage): Promise<void> {
    const key = message.from;
    const next = (this.#queues.get(key) ?? Promise.resolve()).then(() => this.#run(message));
    this.#queues.set(key, next);
    void next.then(() => {
      if (this.#queues.get(key) === next) this.#queues.delete(key);
    });
    return next;
  }

  async #run(message: InboundMessage): Promise<void> {
    try {
      await this.#outbox.flush(message.from);
    } catch (error) {
      this.#log.error(`[whatsapp] falló el envío de retenidos a ${message.from}:`, error);
    }
    if (this.#handlers.size === 0) {
      this.#log.info(`[whatsapp] mensaje ${message.id} sin handlers registrados`);
      return;
    }
    const context = this.#contextFor(message);
    for (const handler of this.#handlers) {
      try {
        await handler(message, context);
      } catch (error) {
        this.#log.error(`[whatsapp] un handler falló con ${message.id}:`, error);
      }
    }
  }

  #contextFor(message: InboundMessage): MessageContext {
    return {
      reply: async body => toSendResult(await this.#outbox.send(message.from, body, 'reply')),
      markRead: async options => {
        const result = await this.#sender.markRead(message.id, options);
        if (result.ok) return result;
        this.#log.warn(`[whatsapp] no se pudo marcar como leído ${message.id}: ${result.error}`);
        return { ok: false, error: result.error };
      },
    };
  }
}

/** Forma corta de un `SendOutcome`; `held` cuenta como aceptado. */
export function toSendResult(outcome: SendOutcome): SendResult {
  return outcome.status === 'failed' ? { ok: false, error: outcome.error } : { ok: true, messageIds: [outcome.messageId] };
}
