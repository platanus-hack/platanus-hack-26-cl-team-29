import type { Log, OutboundMessage, TemplateRef, TransportResult, WhatsAppSender } from './types.ts';

/**
 * Sender de desarrollo: cuando no hay credenciales de Kapso, los mensajes se
 * loguean en vez de enviarse. Así cualquiera puede correr el server y probar
 * un handler con `scripts/whatsapp-simulate.ts` sin tocar WhatsApp real.
 */
export class LogSender implements WhatsAppSender {
  readonly #log: Log;
  #count = 0;

  constructor(log: Log) {
    this.#log = log;
  }

  async send(to: string, message: OutboundMessage): Promise<TransportResult> {
    const opciones = message.list?.rows ?? message.buttons ?? [];
    const buttons = opciones.length ? ` [${opciones.map(b => b.title).join(' | ')}]` : '';
    const document = message.document ? ` [documento ${message.document.filename}: ${message.document.link}]` : '';
    this.#log.info(`[whatsapp:dev] → ${to}: ${message.body}${buttons}${document}`);
    return { ok: true, messageIds: [`dev.${++this.#count}`] };
  }

  async sendTemplate(to: string, template: TemplateRef): Promise<TransportResult> {
    this.#log.info(`[whatsapp:dev] → ${to}: plantilla ${template.name}`);
    return { ok: true, messageIds: [`dev.${++this.#count}`] };
  }

  async markRead(messageId: string, options?: { readonly typing?: boolean }): Promise<TransportResult> {
    this.#log.info(`[whatsapp:dev] leído ${messageId}${options?.typing ? ' (escribiendo…)' : ''}`);
    return { ok: true, messageIds: [] };
  }
}
