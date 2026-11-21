import type { OutboundMessage } from './types.ts';

// Límites de WhatsApp para mensajes con botones de respuesta.
export const MAX_BUTTONS = 3;
export const BUTTON_TITLE_MAX = 20;
export const INTERACTIVE_BODY_MAX = 1024;

/** `null` si el mensaje es válido; si no, por qué. Se valida antes de guardar o enviar nada. */
export function invalidReason(message: OutboundMessage): string | null {
  if (message.body.trim() === '') return 'El mensaje está vacío.';
  const buttons = message.buttons ?? [];
  if (buttons.length === 0) return null;
  if (buttons.length > MAX_BUTTONS) return `WhatsApp permite máximo ${MAX_BUTTONS} botones.`;
  if (message.body.length > INTERACTIVE_BODY_MAX) return `Un mensaje con botones admite máximo ${INTERACTIVE_BODY_MAX} caracteres.`;
  for (const b of buttons) {
    if (!b.id.trim() || !b.title.trim()) return 'Cada botón necesita id y título.';
    if (b.title.length > BUTTON_TITLE_MAX) return `El botón "${b.title}" pasa los ${BUTTON_TITLE_MAX} caracteres.`;
  }
  if (new Set(buttons.map(b => b.id)).size !== buttons.length) return 'Los ids de los botones se repiten.';
  return null;
}

export function toOutbound(message: string | OutboundMessage): OutboundMessage {
  return typeof message === 'string' ? { body: message } : message;
}
