// Enlace privado al PDF de un documento: `/api/red/documentos/<id>/pdf?t=<token>`, con
// token = HMAC-SHA256(id) bajo una llave del servidor. Quien tiene el enlace puede abrir el PDF (para
// mandarlo por WhatsApp o mostrarlo en la web); sin el token correcto la ruta responde 404.
// La llave sale de PDF_LLAVE; si falta, se deriva de SII_LLAVE_CIFRADO; si tampoco hay, es aleatoria por
// proceso (los enlaces dejan de servir tras un reinicio).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Documento } from './tipos.ts';

let llaveDelProceso: Buffer | null = null;

function llave(env: NodeJS.ProcessEnv): Buffer {
  const secreto = env.PDF_LLAVE?.trim() || env.SII_LLAVE_CIFRADO?.trim();
  // Se deriva con un rótulo propio: la llave de cifrado del SII no se usa tal cual para otra cosa.
  if (secreto) return createHmac('sha256', secreto).update('enlace-pdf').digest();
  if (!llaveDelProceso) {
    console.warn('[red] sin PDF_LLAVE ni SII_LLAVE_CIFRADO: los enlaces a los PDF dejan de servir al reiniciar el servidor');
    llaveDelProceso = randomBytes(32);
  }
  return llaveDelProceso;
}

export function tokenPdf(documentoId: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac('sha256', llave(env)).update(documentoId).digest('base64url');
}

export function tokenPdfValido(documentoId: string, token: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof token !== 'string') return false;
  const esperado = Buffer.from(tokenPdf(documentoId, env));
  const recibido = Buffer.from(token);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

/** Enlace al PDF del documento: absoluto con PUBLIC_URL, relativo si no está. */
export function enlacePdf(documento: Pick<Documento, 'id'>, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  return `${base}/api/red/documentos/${encodeURIComponent(documento.id)}/pdf?t=${tokenPdf(documento.id, env)}`;
}

const ARCHIVOS: Record<number, string> = { 33: 'factura', 52: 'guia-despacho', 61: 'nota-credito' };

/** `factura-5190.pdf`, `guia-despacho-2001.pdf`, `nota-credito-3001.pdf`. */
export const nombreArchivoPdf = (documento: Pick<Documento, 'tipo' | 'folio'>): string =>
  `${ARCHIVOS[documento.tipo] ?? 'documento'}-${documento.folio}.pdf`;
