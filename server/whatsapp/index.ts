// API pública del módulo de WhatsApp. Fuera de server/whatsapp/ solo se importa este archivo.
import type { Router } from 'express';
import type pg from 'pg';
import type {
  Log, MessageHandler, OutboundDocument, OutboundMessage, SendOutcome, SendResult, StoredMessage, TemplateRef, WhatsAppSender,
} from './types.ts';
import { createMemoryStore, type WhatsAppStore } from './store.ts';
import { createPostgresStore } from './store-postgres.ts';
import { MessageDispatcher, toSendResult } from './dispatcher.ts';
import { Outbox } from './outbox.ts';
import { LogSender } from './log-sender.ts';
import { KapsoSender } from './kapso/sender.ts';
import { createWebhookRouter } from './kapso/webhook.ts';

export type {
  Button,
  InboundMessage,
  ListMenu,
  ListRow,
  MediaType,
  MessageContent,
  MessageContext,
  MessageHandler,
  MessageStatus,
  OutboundDocument,
  OutboundMessage,
  SendOutcome,
  SendResult,
  StoredMessage,
  WhatsAppSender,
} from './types.ts';

export interface WhatsApp {
  /** Montar en `/api/whatsapp`, ANTES de `express.json()`: necesita el body crudo. */
  readonly router: Router;
  onMessage(handler: MessageHandler): () => void;
  /**
   * Manda un mensaje (texto, con botones, con lista o con un documento). Nunca lanza. Si la persona lleva
   * más de 24 h sin escribir, queda `held` y sale solo cuando vuelva a escribir.
   * `source` identifica al módulo que lo manda (queda guardado), p. ej. `'agente'`.
   */
  send(to: string, message: string | OutboundMessage, options?: { readonly source?: string }): Promise<SendOutcome>;
  /** Atajo de `send` con texto y resultado corto; un mensaje `held` cuenta como aceptado. */
  sendText(to: string, body: string): Promise<SendResult>;
  /**
   * Atajo de `send` con un documento adjunto (p. ej. el PDF de una factura) descargado desde `link`,
   * que debe ser una URL pública. Mismo resultado corto que `sendText`.
   */
  sendDocument(to: string, document: OutboundDocument & { readonly caption?: string }, options?: { readonly source?: string }): Promise<SendResult>;
  /** Los últimos mensajes con ese teléfono (entrantes y salientes), del más antiguo al más nuevo. */
  history(phone: string, options?: { readonly limit?: number }): Promise<StoredMessage[]>;
}

export interface WhatsAppOptions {
  /** Postgres para guardar contactos y mensajes. Sin BD (o si falla), todo queda en memoria. */
  readonly db?: pg.Pool | null;
  readonly env?: NodeJS.ProcessEnv;
  /** Para tests: reemplazan el envío real y la persistencia. */
  readonly sender?: WhatsAppSender;
  readonly store?: WhatsAppStore;
  readonly log?: Log;
}

export async function createWhatsApp(options: WhatsAppOptions = {}): Promise<WhatsApp> {
  const env = options.env ?? process.env;
  const log = options.log ?? console;
  const sender = options.sender ?? senderFromEnv(env, log);
  const store = options.store ?? (await storeFor(options.db ?? null, log));
  const outbox = new Outbox({ store, sender, template: templateFromEnv(env), log });
  const dispatcher = new MessageDispatcher({ store, outbox, sender, log });

  return {
    router: createWebhookRouter({
      secret: env.KAPSO_WEBHOOK_SECRET || null,
      log,
      async onDelivery(delivery) {
        for (const s of delivery.statuses) {
          await store.updateStatusByWamid(s.wamid, s.status, s.error).catch(error => log.error('[whatsapp] estado no guardado:', error));
        }
        await dispatcher.dispatch(delivery.messages);
      },
    }),
    onMessage: handler => dispatcher.onMessage(handler),
    send: (to, message, sendOptions) => outbox.send(to, message, sendOptions?.source ?? null),
    sendText: async (to, body) => toSendResult(await outbox.send(to, body, null)),
    sendDocument: async (to, { link, filename, caption }, sendOptions) =>
      toSendResult(await outbox.send(to, { body: caption ?? '', document: { link, filename } }, sendOptions?.source ?? null)),
    history: (phone, historyOptions) => store.history(phone.replace(/\D/g, ''), historyOptions?.limit ?? 20),
  };
}

async function storeFor(db: pg.Pool | null, log: Log): Promise<WhatsAppStore> {
  if (db) {
    try {
      return await createPostgresStore(db);
    } catch (error) {
      log.error('[whatsapp] no se pudo usar Postgres, sigo en memoria', error);
    }
  }
  return createMemoryStore();
}

function senderFromEnv(env: NodeJS.ProcessEnv, log: Log): WhatsAppSender {
  const apiKey = env.KAPSO_API_KEY;
  const phoneNumberId = env.KAPSO_PHONE_NUMBER_ID;
  if (apiKey && phoneNumberId) return new KapsoSender({ apiKey, phoneNumberId });
  log.warn('[whatsapp] sin KAPSO_API_KEY / KAPSO_PHONE_NUMBER_ID: los mensajes salientes solo se loguean');
  return new LogSender(log);
}

/** Plantilla aprobada por Meta para reabrir la ventana de 24 h. Sin ella, los mensajes solo esperan. */
function templateFromEnv(env: NodeJS.ProcessEnv): TemplateRef | null {
  const name = env.KAPSO_TEMPLATE_NAME;
  return name ? { name, language: env.KAPSO_TEMPLATE_LANGUAGE || 'es' } : null;
}
