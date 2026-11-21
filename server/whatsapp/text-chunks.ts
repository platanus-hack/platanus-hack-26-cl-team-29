/** Límite de WhatsApp para el cuerpo de un mensaje de texto. */
export const WHATSAPP_TEXT_MAX = 4096;

/**
 * Parte un texto largo en mensajes válidos, cortando en párrafo, línea o
 * espacio antes que a mitad de palabra. Truncar haría perder el final de una
 * respuesta sin que nadie se entere.
 */
export function splitText(text: string, max = WHATSAPP_TEXT_MAX): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' ')]
      .find(i => i > max / 2) ?? max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
