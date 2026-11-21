// Tipos públicos del módulo. No mencionan a Kapso: quien consume el módulo
// trabaja con WhatsApp, no con el proveedor que hay detrás.

export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'sticker';

export type MessageContent =
  | { readonly kind: 'text'; readonly text: string }
  /** La persona apretó un botón que mandamos. `id` es el que le pusimos al botón. */
  | { readonly kind: 'reply'; readonly id: string; readonly title: string }
  | {
      readonly kind: 'media';
      readonly mediaType: MediaType;
      readonly url: string | null;
      readonly caption: string | null;
      /** Transcripción que Kapso genera para las notas de voz. */
      readonly transcript: string | null;
    }
  | { readonly kind: 'location'; readonly lat: number; readonly lng: number; readonly label: string | null }
  | { readonly kind: 'unsupported'; readonly type: string };

export interface InboundMessage {
  /** wamid de WhatsApp. Sirve para deduplicar y para marcar como leído. */
  readonly id: string;
  readonly conversationId: string;
  /** Teléfono del remitente, solo dígitos (el formato que pide WhatsApp para responder). */
  readonly from: string;
  readonly contactName: string | null;
  readonly sentAt: Date;
  /**
   * El texto legible del mensaje: cuerpo, caption, transcripción o el título
   * del botón apretado. Vacío para una ubicación. Para lógica fina usar `content`.
   */
  readonly text: string;
  readonly content: MessageContent;
}

export interface Button {
  /** Lo que vuelve en `content.id` cuando la persona lo aprieta. */
  readonly id: string;
  /** Máximo 20 caracteres (límite de WhatsApp). */
  readonly title: string;
}

/** Un mensaje saliente: texto, opcionalmente con hasta 3 botones de respuesta. */
export interface OutboundMessage {
  readonly body: string;
  readonly buttons?: readonly Button[];
}

/**
 * Resultado de `send`. `held` significa que la persona lleva más de 24 h sin
 * escribir (regla de Meta): el mensaje quedó guardado y sale solo apenas vuelva
 * a escribir. Si hay plantilla configurada, se le mandó para invitarla a hacerlo.
 */
export type SendOutcome =
  | { readonly status: 'sent'; readonly messageId: string }
  | { readonly status: 'held'; readonly messageId: string; readonly templateSent: boolean }
  | { readonly status: 'failed'; readonly messageId: string | null; readonly error: string };

/** Forma corta que devuelve `sendText`; `held` cuenta como aceptado. */
export type SendResult =
  | { readonly ok: true; readonly messageIds: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type MessageStatus = 'received' | 'held' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Un mensaje guardado, entrante o saliente. Lo que devuelve `history`. */
export interface StoredMessage {
  readonly id: string;
  readonly wamid: string | null;
  readonly direction: 'in' | 'out';
  readonly phone: string;
  readonly text: string;
  readonly status: MessageStatus;
  readonly error: string | null;
  /** Quién lo mandó (p. ej. `agente`); `null` para los entrantes. */
  readonly source: string | null;
  /** El `MessageContent` si es entrante, el `OutboundMessage` si es saliente. */
  readonly payload: unknown;
  readonly createdAt: Date;
}

/** Atajos para responder al mensaje recibido. Para botones, usar `whatsapp.send`. */
export interface MessageContext {
  /** Responde texto en la misma conversación. */
  reply(body: string): Promise<SendResult>;
  /** Marca el mensaje como leído y, si `typing`, muestra "escribiendo…" al usuario. */
  markRead(options?: { readonly typing?: boolean }): Promise<SendResult>;
}

export type MessageHandler = (message: InboundMessage, context: MessageContext) => void | Promise<void>;

/** Respuesta del proveedor. `windowClosed`: Meta rechazó texto libre por la regla de 24 h. */
export type TransportResult =
  | { readonly ok: true; readonly messageIds: readonly string[] }
  | { readonly ok: false; readonly error: string; readonly windowClosed: boolean };

/** El puerto hacia el proveedor (Kapso, o el de desarrollo). Nunca lanza. */
export interface WhatsAppSender {
  send(to: string, message: OutboundMessage): Promise<TransportResult>;
  sendTemplate(to: string, template: TemplateRef): Promise<TransportResult>;
  markRead(messageId: string, options?: { readonly typing?: boolean }): Promise<TransportResult>;
}

export interface TemplateRef {
  readonly name: string;
  readonly language: string;
}

export type Log = Pick<Console, 'info' | 'warn' | 'error'>;
