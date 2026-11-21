import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-webhook-signature';
export const EVENT_HEADER = 'x-webhook-event';

/**
 * HMAC-SHA256 sobre los bytes crudos del body, nunca sobre un objeto
 * re-serializado (JSON.stringify reordena y normaliza, y la firma deja de
 * calzar). Kapso manda hex en minúscula sin prefijo; se tolera `sha256=`.
 */
export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  const presented = header?.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!presented) return false;
  const expected = Buffer.from(signPayload(rawBody, secret), 'utf8');
  const actual = Buffer.from(presented, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signPayload(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}
