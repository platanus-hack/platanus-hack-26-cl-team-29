import type { Log, SendResult, WhatsAppSender } from './types.ts';

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

  async sendText(to: string, body: string): Promise<SendResult> {
    this.#log.info(`[whatsapp:dev] → ${to}: ${body}`);
    return { ok: true, messageIds: [`dev.${++this.#count}`] };
  }

  async markRead(messageId: string, options?: { readonly typing?: boolean }): Promise<SendResult> {
    this.#log.info(`[whatsapp:dev] leído ${messageId}${options?.typing ? ' (escribiendo…)' : ''}`);
    return { ok: true, messageIds: [] };
  }
}
