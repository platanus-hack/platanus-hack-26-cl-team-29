import type { InboundMessage, Log, MessageContext, MessageHandler, WhatsAppSender } from './types.ts';
import { RecentIds } from './recent-ids.ts';

/**
 * Entrega cada mensaje entrante a los handlers registrados.
 *
 *  - **Una sola vez:** deduplica por wamid, así un reintento de Kapso (o un
 *    batch reenviado con otra idempotency key) no responde dos veces.
 *  - **En orden por conversación:** si el handler del mensaje 1 tarda (un LLM),
 *    el mensaje 2 del mismo usuario espera; conversaciones distintas corren en paralelo.
 *  - **Aislado:** un handler que lanza se loguea y no frena a los demás.
 */
export class MessageDispatcher {
  readonly #handlers = new Set<MessageHandler>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #seen = new RecentIds();
  readonly #sender: WhatsAppSender;
  readonly #log: Log;

  constructor(sender: WhatsAppSender, log: Log) {
    this.#sender = sender;
    this.#log = log;
  }

  /** Devuelve la función para desuscribirse. */
  onMessage(handler: MessageHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  /** Resuelve cuando todos los mensajes fueron procesados. Nunca rechaza. */
  dispatch(messages: readonly InboundMessage[]): Promise<void> {
    const fresh = messages.filter(m => this.#seen.add(m.id));
    return Promise.all(fresh.map(m => this.#enqueue(m))).then(() => undefined);
  }

  #enqueue(message: InboundMessage): Promise<void> {
    const key = message.conversationId;
    const next = (this.#queues.get(key) ?? Promise.resolve()).then(() => this.#run(message));
    this.#queues.set(key, next);
    void next.then(() => {
      if (this.#queues.get(key) === next) this.#queues.delete(key);
    });
    return next;
  }

  async #run(message: InboundMessage): Promise<void> {
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
      reply: body => this.#sender.sendText(message.from, body),
      markRead: options => this.#sender.markRead(message.id, options),
    };
  }
}
