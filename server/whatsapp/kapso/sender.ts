import type { OutboundMessage, TemplateRef, TransportResult, WhatsAppSender } from '../types.ts';
import { splitText } from '../text-chunks.ts';

/**
 * Kapso hace de proxy de la Cloud API de Meta sin cambiarla:
 *   POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages
 * https://docs.kapso.ai/api/meta/whatsapp/messages/send-a-message
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
/** Meta: "re-engagement message", fuera de la ventana de 24 h. */
const META_WINDOW_ERROR = 131047;

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

  /** Texto largo se parte en varios mensajes; con botones, lista o documento va en uno solo (ya validado). */
  async send(to: string, message: OutboundMessage): Promise<TransportResult> {
    const recipient = { messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/\D/g, '') };
    if (message.document) {
      const { link, filename } = message.document;
      return this.#post({ ...recipient, type: 'document', document: { link, filename, ...(message.body ? { caption: message.body } : {}) } });
    }
    if (message.list) {
      return this.#post({
        ...recipient,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: message.body },
          action: {
            button: message.list.button,
            sections: [{ title: message.list.button, rows: message.list.rows.map(r => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) })) }],
          },
        },
      });
    }
    if (message.buttons?.length) {
      return this.#post({
        ...recipient,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.body },
          action: { buttons: message.buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      });
    }

    const messageIds: string[] = [];
    for (const chunk of splitText(message.body)) {
      const result = await this.#post({ ...recipient, type: 'text', text: { body: chunk } });
      if (!result.ok) return result;
      messageIds.push(...result.messageIds);
    }
    return { ok: true, messageIds };
  }

  sendTemplate(to: string, template: TemplateRef): Promise<TransportResult> {
    return this.#post({
      messaging_product: 'whatsapp',
      to: to.replace(/\D/g, ''),
      type: 'template',
      template: { name: template.name, language: { code: template.language } },
    });
  }

  markRead(messageId: string, options?: { readonly typing?: boolean }): Promise<TransportResult> {
    return this.#post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      ...(options?.typing ? { typing_indicator: { type: 'text' } } : {}),
    });
  }

  /** Reintenta solo lo que puede salir bien al reintentar: red caída, 429 y 5xx. */
  async #post(payload: object): Promise<TransportResult> {
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
        if (isWindowClosed(json)) return { ok: false, error: lastError, windowClosed: true };
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Error de red.';
      }
    }
    return { ok: false, error: lastError, windowClosed: false };
  }
}

/**
 * Kapso revisa la ventana antes de llamar a Meta y responde 422 con
 * "Cannot send non-template messages outside the 24-hour window" (visto en
 * el sandbox, 2026-11-21). Meta, si llega a responder, usa el código 131047.
 */
function isWindowClosed(json: unknown): boolean {
  const body = json as { error?: unknown } | null;
  if (typeof body?.error === 'string') return /24-hour window/i.test(body.error);
  const code = (body?.error as { code?: unknown } | undefined)?.code;
  return code === META_WINDOW_ERROR;
}

function messageIdsIn(json: unknown): string[] {
  const messages = (json as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap(m => (typeof m?.id === 'string' ? [m.id] : []));
}

function describeError(json: unknown): string {
  const error = (json as { error?: unknown } | null)?.error;
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : JSON.stringify(json ?? 'sin body').slice(0, 200);
}
