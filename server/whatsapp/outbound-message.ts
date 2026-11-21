import type { OutboundMessage } from './types.ts';

// Límites de WhatsApp para mensajes con botones de respuesta.
export const MAX_BUTTONS = 3;
export const BUTTON_TITLE_MAX = 20;
export const INTERACTIVE_BODY_MAX = 1024;
export const MAX_LIST_ROWS = 10;
export const LIST_BUTTON_MAX = 20;
export const ROW_TITLE_MAX = 24;
export const ROW_DESCRIPTION_MAX = 72;
export const DOCUMENT_CAPTION_MAX = 1024;

/** `null` si el mensaje es válido; si no, por qué. Se valida antes de guardar o enviar nada. */
export function invalidReason(message: OutboundMessage): string | null {
  if (message.document) return invalidDocumentReason(message);
  if (message.body.trim() === '') return 'El mensaje está vacío.';
  if (message.list) return invalidListReason(message);
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

function invalidListReason(message: OutboundMessage): string | null {
  const list = message.list!;
  if (message.buttons?.length) return 'Un mensaje lleva botones o lista, no ambos.';
  if (message.body.length > INTERACTIVE_BODY_MAX) return `Un mensaje con lista admite máximo ${INTERACTIVE_BODY_MAX} caracteres.`;
  if (!list.button.trim() || list.button.length > LIST_BUTTON_MAX) return `El botón de la lista necesita texto, máximo ${LIST_BUTTON_MAX} caracteres.`;
  if (list.rows.length === 0 || list.rows.length > MAX_LIST_ROWS) return `Una lista lleva de 1 a ${MAX_LIST_ROWS} opciones.`;
  for (const r of list.rows) {
    if (!r.id.trim() || !r.title.trim()) return 'Cada opción de la lista necesita id y título.';
    if (r.title.length > ROW_TITLE_MAX) return `La opción "${r.title}" pasa los ${ROW_TITLE_MAX} caracteres.`;
    if ((r.description?.length ?? 0) > ROW_DESCRIPTION_MAX) return `La descripción de "${r.title}" pasa los ${ROW_DESCRIPTION_MAX} caracteres.`;
  }
  if (new Set(list.rows.map(r => r.id)).size !== list.rows.length) return 'Los ids de la lista se repiten.';
  return null;
}

function invalidDocumentReason(message: OutboundMessage): string | null {
  const document = message.document!;
  if (message.buttons?.length || message.list) return 'Un documento no lleva botones ni lista.';
  if (message.body.length > DOCUMENT_CAPTION_MAX) return `La leyenda de un documento admite máximo ${DOCUMENT_CAPTION_MAX} caracteres.`;
  if (!document.filename.trim()) return 'El documento necesita nombre de archivo.';
  if (!/^https?:\/\/\S+$/i.test(document.link)) return `WhatsApp descarga el documento desde una URL pública; "${document.link}" no lo es.`;
  return null;
}

export function toOutbound(message: string | OutboundMessage): OutboundMessage {
  return typeof message === 'string' ? { body: message } : message;
}
