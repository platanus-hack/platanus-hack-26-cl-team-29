import express, { type Router } from 'express';
import type { InboundMessage, Log } from '../types.ts';
import { parseDelivery } from './payload.ts';
import { EVENT_HEADER, SIGNATURE_HEADER, verifySignature } from './signature.ts';

/**
 * POST /webhook — el camino crítico: verificar, parsear, responder 200 y
 * recién después procesar. Kapso corta a los 10 s y pausa el webhook si
 * acumula fallas, así que nada lento (LLM, BD) ocurre antes del 200.
 *
 * Un evento que no nos interesa también responde 200: rechazarlo solo haría
 * que Kapso reintente y, eventualmente, desactive la conexión.
 */
export function createWebhookRouter(options: {
  readonly secret: string | null;
  readonly onMessages: (messages: InboundMessage[]) => Promise<void>;
  readonly log: Log;
}): Router {
  const { secret, onMessages, log } = options;
  const router = express.Router();

  // Body crudo: la firma es sobre los bytes, no sobre el JSON parseado.
  router.post('/webhook', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
    if (!secret) {
      res.status(503).json({ error: 'WhatsApp no está configurado (falta KAPSO_WEBHOOK_SECRET).' });
      return;
    }
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySignature(rawBody, req.get(SIGNATURE_HEADER), secret)) {
      log.warn('[whatsapp] entrega rechazada: firma inválida');
      res.status(401).json({ error: 'Firma inválida.' });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      log.warn('[whatsapp] entrega firmada pero no es JSON; se ignora');
      res.json({ received: true });
      return;
    }

    const delivery = parseDelivery(body, req.get(EVENT_HEADER));
    for (const failure of delivery.failures) log.warn(`[whatsapp] ${delivery.event} ${failure}`);
    res.json({ received: true });
    if (delivery.messages.length > 0) void onMessages(delivery.messages);
  });

  return router;
}
