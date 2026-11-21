// Cifrado de los secretos de la conexión con el SII (certificado, su clave y la llave del CAF): AES-256-GCM.
// La llave sale de SII_LLAVE_CIFRADO (32 bytes en base64) y nunca se guarda junto a los datos.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Sin llave no se guarda nada: el mensaje dice cómo crearla. */
export class SinLlaveCifrado extends Error {
  constructor(detalle: string) {
    super(`No se pueden guardar los datos del SII: ${detalle}. Configura SII_LLAVE_CIFRADO con 32 bytes en base64 ` +
      '(por ejemplo, la salida de `openssl rand -base64 32`).');
    this.name = 'SinLlaveCifrado';
  }
}

export function llaveDesdeEnv(env: NodeJS.ProcessEnv): Buffer {
  const texto = env.SII_LLAVE_CIFRADO?.trim();
  if (!texto) throw new SinLlaveCifrado('falta SII_LLAVE_CIFRADO');
  const llave = Buffer.from(texto, 'base64');
  if (llave.length !== 32) throw new SinLlaveCifrado(`SII_LLAVE_CIFRADO tiene ${llave.length} bytes y debe tener 32`);
  return llave;
}

const VERSION = 'v1';

/** `v1.<iv>.<tag>.<cifrado>`, todo en base64url. El IV es aleatorio en cada llamada. */
export function cifrar(llave: Buffer, texto: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', llave, iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return [VERSION, iv, cifrador.getAuthTag(), cifrado].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/** Falla si la llave no es la misma con que se cifró o si el texto fue alterado. */
export function descifrar(llave: Buffer, sobre: string): string {
  const [version, iv, tag, cifrado] = sobre.split('.');
  if (version !== VERSION || !iv || !tag || cifrado === undefined) throw new Error('Dato cifrado con formato desconocido');
  const descifrador = createDecipheriv('aes-256-gcm', llave, Buffer.from(iv, 'base64url'));
  descifrador.setAuthTag(Buffer.from(tag, 'base64url'));
  try {
    return Buffer.concat([descifrador.update(Buffer.from(cifrado, 'base64url')), descifrador.final()]).toString('utf8');
  } catch {
    throw new Error('No se pudo descifrar: la llave SII_LLAVE_CIFRADO no es la que se usó al guardar');
  }
}
