// Tipos públicos del módulo. No mencionan a Kapso: quien consume el módulo
// trabaja con WhatsApp, no con el proveedor que hay detrás.

export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'sticker';

export type MessageContent =
  | { readonly kind: 'text'; readonly text: string }
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

export type SendResult =
  | { readonly ok: true; readonly messageIds: readonly string[] }
  | { readonly ok: false; readonly error: string };

/** El único puerto hacia afuera. Nunca lanza: todo error vuelve como `{ ok: false }`. */
export interface WhatsAppSender {
  sendText(to: string, body: string): Promise<SendResult>;
  /** Marca el mensaje como leído y, si `typing`, muestra "escribiendo…" al usuario. */
  markRead(messageId: string, options?: { readonly typing?: boolean }): Promise<SendResult>;
}

export interface MessageContext {
  /** Responde en la misma conversación. */
  reply(body: string): Promise<SendResult>;
  markRead(options?: { readonly typing?: boolean }): Promise<SendResult>;
}

export type MessageHandler = (message: InboundMessage, context: MessageContext) => void | Promise<void>;

export type Log = Pick<Console, 'info' | 'warn' | 'error'>;
