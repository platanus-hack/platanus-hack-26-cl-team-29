import type { InboundMessage, MediaType, MessageContent, MessageStatus } from '../types.ts';

/**
 * Body de un webhook de Kapso (v2) → mensajes de dominio.
 * Docs: docs.kapso.ai/docs/platform/webhooks/message-events.md y advanced.md.
 *
 * Reglas aprendidas en producción (kanbot):
 *  - Con buffering activo TODA entrega viene como batch (`{ batch: true, data: [...] }`),
 *    aunque traiga un solo mensaje. Por eso siempre se devuelve una lista.
 *  - Solo `whatsapp.message.received` trae mensajes. Los otros 9 eventos se aceptan y se ignoran.
 *  - `direction: 'outbound'` es nuestra propia respuesta volviendo: procesarla crea un loop.
 *  - En una ubicación, `kapso.content` es un resumen sintético ("Lat: …, Long: …"),
 *    no palabras del usuario: no se usa como texto.
 *  - Una coordenada sin su par se descarta; nunca se rellena con 0.
 */

export const MESSAGE_RECEIVED = 'whatsapp.message.received';

/** Cambio de estado de un mensaje que nosotros mandamos. */
export interface StatusUpdate {
  readonly wamid: string;
  readonly status: MessageStatus;
  readonly error: string | null;
}

/** Eventos de estado → nuestro estado. Hay que suscribirlos en el webhook de Kapso. */
const STATUS_EVENTS: Record<string, MessageStatus> = {
  'whatsapp.message.sent': 'sent',
  'whatsapp.message.delivered': 'delivered',
  'whatsapp.message.read': 'read',
  'whatsapp.message.failed': 'failed',
};

export interface ParsedDelivery {
  readonly event: string;
  readonly messages: InboundMessage[];
  readonly statuses: StatusUpdate[];
  /** Una línea por ítem ilegible. Nunca el payload crudo. */
  readonly failures: string[];
}

const MEDIA_TYPES: readonly MediaType[] = ['image', 'audio', 'video', 'document', 'sticker'];

const CONVERSATION_PATHS = ['conversation.id'];
const FROM_PATHS = ['conversation.phone_number', 'message.from', 'contact.wa_id'];
const NAME_PATHS = ['conversation.contact_name', 'contact.profile_name', 'message.username'];
const ID_PATHS = ['message.id'];
const TYPE_PATHS = ['message.type', 'message.kapso.message_type'];
const DIRECTION_PATHS = ['message.kapso.direction', 'message.direction'];
const SENT_AT_PATHS = ['message.timestamp', 'message.created_at'];
const REPLY_ID_PATHS = ['message.interactive.button_reply.id', 'message.interactive.list_reply.id', 'message.button.payload'];
const REPLY_TITLE_PATHS = ['message.interactive.button_reply.title', 'message.interactive.list_reply.title', 'message.button.text'];
const ERROR_PATHS = ['message.errors.0.message', 'message.errors.0.title', 'message.kapso.error', 'error.message'];
const TEXT_PATHS = [
  'message.text.body',
  'message.kapso.content',
  'message.content',
];
const CAPTION_PATHS = [
  'message.kapso.message_type_data.caption',
  'message.image.caption',
  'message.video.caption',
  'message.document.caption',
];
const TRANSCRIPT_PATHS = ['message.kapso.transcript.text'];
const MEDIA_URL_PATHS = ['message.kapso.media_url', 'message.kapso.media_data.url'];
const LAT_PATHS = ['message.location.latitude', 'message.kapso.message_type_data.latitude', 'message.latitude'];
const LNG_PATHS = ['message.location.longitude', 'message.kapso.message_type_data.longitude', 'message.longitude'];
const LABEL_PATHS = [
  'message.location.name',
  'message.kapso.message_type_data.name',
  'message.location.address',
  'message.kapso.message_type_data.address',
];

export function parseDelivery(body: unknown, eventHeader?: string): ParsedDelivery {
  const event = resolveEvent(body, eventHeader);
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const failures: string[] = [];
  const status = Object.hasOwn(STATUS_EVENTS, event) ? STATUS_EVENTS[event] : undefined;
  if (status) {
    for (const item of unwrapItems(body)) {
      const wamid = firstString(item, ID_PATHS);
      if (wamid) statuses.push({ wamid, status, error: status === 'failed' ? firstString(item, ERROR_PATHS) : null });
      else failures.push('evento de estado sin message.id');
    }
    return { event, messages, statuses, failures };
  }
  if (event !== MESSAGE_RECEIVED) return { event, messages, statuses, failures };

  for (const [index, item] of unwrapItems(body).entries()) {
    try {
      const message = parseItem(item);
      if (message) messages.push(message);
    } catch (error) {
      failures.push(`item ${index + 1}: ${error instanceof Error ? error.message : 'ilegible'}`);
    }
  }
  return { event, messages, statuses, failures };
}

/** El header es la fuente autoritativa; el `type` del body solo existe en batches. */
function resolveEvent(body: unknown, eventHeader?: string): string {
  const fromHeader = eventHeader?.trim();
  if (fromHeader) return fromHeader;
  const fromBody = firstString(body, ['type']);
  // "batch" es un marcador de sobre; el buffering solo existe para message.received.
  return fromBody === 'batch' ? MESSAGE_RECEIVED : (fromBody ?? 'unknown');
}

function unwrapItems(body: unknown): unknown[] {
  if (isRecord(body) && (body.batch === true || Array.isArray(body.data))) {
    return Array.isArray(body.data) ? body.data : [];
  }
  return [body];
}

/** `null` cuando el ítem es nuestro propio mensaje saliente. */
function parseItem(item: unknown): InboundMessage | null {
  if (!isRecord(item)) throw new Error('no es un objeto JSON');
  if (firstString(item, DIRECTION_PATHS) === 'outbound') return null;

  const conversationId = firstString(item, CONVERSATION_PATHS);
  const from = firstString(item, FROM_PATHS)?.replace(/\D/g, '');
  if (!conversationId) throw new Error('falta conversation.id');
  if (!from) throw new Error('falta el teléfono del remitente');

  const sentAt = parseTimestamp(firstString(item, SENT_AT_PATHS)) ?? new Date();
  const content = parseContent(item);
  return {
    // Sin wamid (payload legacy) se usa una clave determinística, para que un reintento igual se deduplique.
    id: firstString(item, ID_PATHS) ?? `${conversationId}:${sentAt.getTime()}`,
    conversationId,
    from,
    contactName: firstString(item, NAME_PATHS),
    sentAt,
    text: readableText(item, content),
    content,
  };
}

function parseContent(item: unknown): MessageContent {
  const type = firstString(item, TYPE_PATHS) ?? 'text';
  const location = parseLocation(item);
  if (location) return location;
  if (type === 'location') return { kind: 'unsupported', type };

  const replyId = firstString(item, REPLY_ID_PATHS);
  const replyTitle = firstString(item, REPLY_TITLE_PATHS);
  if (replyId && replyTitle) return { kind: 'reply', id: replyId, title: replyTitle };

  const mediaType = MEDIA_TYPES.find(t => t === type);
  if (mediaType) {
    return {
      kind: 'media',
      mediaType,
      url: firstString(item, MEDIA_URL_PATHS),
      caption: firstString(item, CAPTION_PATHS),
      transcript: firstString(item, TRANSCRIPT_PATHS),
    };
  }

  const text = firstString(item, TEXT_PATHS);
  return text ? { kind: 'text', text } : { kind: 'unsupported', type };
}

function readableText(item: unknown, content: MessageContent): string {
  switch (content.kind) {
    case 'text': return content.text;
    case 'reply': return content.title;
    case 'media': return content.caption ?? content.transcript ?? '';
    case 'location': return '';
    case 'unsupported': return content.type === 'location' ? '' : (firstString(item, TEXT_PATHS) ?? '');
  }
}

function parseLocation(item: unknown): MessageContent | null {
  const lat = firstNumber(item, LAT_PATHS);
  const lng = firstNumber(item, LNG_PATHS);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { kind: 'location', lat, lng, label: firstString(item, LABEL_PATHS) };
}

/** Kapso manda segundos unix como string; a veces ms o ISO-8601. */
function parseTimestamp(raw: string | null): Date | null {
  if (!raw) return null;
  if (/^\d{9,10}$/.test(raw)) return new Date(Number(raw) * 1000);
  if (/^\d{12,13}$/.test(raw)) return new Date(Number(raw));
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ── lectura tolerante de JSON ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(root: unknown, path: string): unknown {
  let current = root;
  for (const key of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(key)) current = current[Number(key)];
    else if (isRecord(current)) current = current[key];
    else return undefined;
  }
  return current;
}

function firstString(root: unknown, paths: readonly string[]): string | null {
  for (const path of paths) {
    const value = at(root, path);
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Acepta números como string ("-33.43"), pero "" no es 0. */
function firstNumber(root: unknown, paths: readonly string[]): number | null {
  for (const path of paths) {
    const value = at(root, path);
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
  }
  return null;
}
