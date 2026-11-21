import type { SendResult, WhatsAppSender } from '../types.ts';
import { splitText } from '../text-chunks.ts';

/**
 * Kapso hace de proxy de la Cloud API de Meta sin cambiarla:
 *   POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages
 * https://docs.kapso.ai/api/meta/whatsapp/messages/send-a-message
 *
 * Texto libre solo es válido dentro de la ventana de 24 h desde el último
 * mensaje del usuario. Fuera de ella Meta exige una plantilla aprobada.
 */
export interface KapsoSenderOptions {
  readonly apiKey: string;
  readonly phoneNumberId: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Espera antes del primer reintento; se duplica en cada uno. */
  readonly retryDelayMs?: number;
}

const GRAPH_VERSION = 'v24.0';
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

export class KapsoSender implements WhatsAppSender {
  readonly #url: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #retryDelayMs: number;

  constructor(options: KapsoSenderOptions) {
    const base = options.baseUrl ?? 'https://api.kapso.ai';
    this.#url = `${base}/meta/whatsapp/${GRAPH_VERSION}/${options.phoneNumberId}/messages`;
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#retryDelayMs = options.retryDelayMs ?? 500;
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const chunks = splitText(body);
    if (chunks.length === 0) return { ok: false, error: 'Mensaje vacío.' };

    const messageIds: string[] = [];
    for (const chunk of chunks) {
      const result = await this.#post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: { body: chunk },
      });
      if (!result.ok) return result;
      messageIds.push(...result.messageIds);
    }
    return { ok: true, messageIds };
  }

  markRead(messageId: string, options?: { readonly typing?: boolean }): Promise<SendResult> {
    return this.#post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      ...(options?.typing ? { typing_indicator: { type: 'text' } } : {}),
    });
  }

  /** Reintenta solo lo que puede salir bien al reintentar: red caída, 429 y 5xx. */
  async #post(payload: object): Promise<SendResult> {
    let lastError = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, this.#retryDelayMs * 2 ** (attempt - 1)));
      try {
        const response = await this.#fetch(this.#url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': this.#apiKey },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const json: unknown = await response.json().catch(() => null);
        if (response.ok) return { ok: true, messageIds: messageIdsIn(json) };
        lastError = `Kapso respondió ${response.status}: ${describeError(json)}`;
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Error de red.';
      }
    }
    return { ok: false, error: lastError };
  }
}

function messageIdsIn(json: unknown): string[] {
  const messages = (json as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap(m => (typeof m?.id === 'string' ? [m.id] : []));
}

function describeError(json: unknown): string {
  const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' ? message : JSON.stringify(json ?? 'sin body').slice(0, 200);
}
