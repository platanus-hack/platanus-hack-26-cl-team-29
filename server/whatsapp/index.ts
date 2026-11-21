// API pública del módulo de WhatsApp. Fuera de server/whatsapp/ solo se importa este archivo.
import type { Router } from 'express';
import type { Log, MessageHandler, SendResult, WhatsAppSender } from './types.ts';
import { MessageDispatcher } from './dispatcher.ts';
import { LogSender } from './log-sender.ts';
import { KapsoSender } from './kapso/sender.ts';
import { createWebhookRouter } from './kapso/webhook.ts';

export type {
  InboundMessage,
  MediaType,
  MessageContent,
  MessageContext,
  MessageHandler,
  SendResult,
  WhatsAppSender,
} from './types.ts';

export interface WhatsApp {
  /** Montar en `/api/whatsapp`, ANTES de `express.json()`: necesita el body crudo. */
  readonly router: Router;
  onMessage(handler: MessageHandler): () => void;
  /** Envío iniciado por nosotros. Ojo: fuera de la ventana de 24 h Meta lo rechaza. */
  sendText(to: string, body: string): Promise<SendResult>;
}

export interface WhatsAppOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Para tests: reemplaza el envío real. */
  readonly sender?: WhatsAppSender;
  readonly log?: Log;
}

export function createWhatsApp(options: WhatsAppOptions = {}): WhatsApp {
  const env = options.env ?? process.env;
  const log = options.log ?? console;
  const sender = options.sender ?? senderFromEnv(env, log);
  const dispatcher = new MessageDispatcher(sender, log);

  return {
    router: createWebhookRouter({
      secret: env.KAPSO_WEBHOOK_SECRET || null,
      onMessages: messages => dispatcher.dispatch(messages),
      log,
    }),
    onMessage: handler => dispatcher.onMessage(handler),
    sendText: (to, body) => sender.sendText(to, body),
  };
}

function senderFromEnv(env: NodeJS.ProcessEnv, log: Log): WhatsAppSender {
  const apiKey = env.KAPSO_API_KEY;
  const phoneNumberId = env.KAPSO_PHONE_NUMBER_ID;
  if (apiKey && phoneNumberId) return new KapsoSender({ apiKey, phoneNumberId });
  log.warn('[whatsapp] sin KAPSO_API_KEY / KAPSO_PHONE_NUMBER_ID: los mensajes salientes solo se loguean');
  return new LogSender(log);
}
