// Lo que sale de la red hacia pantallas y navegadores (GET /api/red/estado, respuestas HTTP y cada
// `red:evento`) nunca lleva teléfonos ni tokens de sesión. Es el único sanitizador: `emitir` lo aplica a
// todo evento antes de entregarlo a cualquier oyente de `red.escuchar` (incluido el `io.emit`), y
// `estadoPublico()` a la foto. El teléfono vive solo dentro del servidor, para el agente de WhatsApp.

const PRIVADOS = new Set(['telefono', 'token']);
type Privado = 'telefono' | 'token';

/** El mismo tipo sin los campos `telefono` ni `token`, a cualquier nivel. */
export type SinTelefono<T> = T extends readonly (infer U)[]
  ? SinTelefono<U>[]
  : T extends object
    ? { [K in keyof T as K extends Privado ? never : K]: SinTelefono<T[K]> }
    : T;

/** Copia profunda sin ningún campo `telefono` ni `token`, a cualquier nivel. */
export function sinTelefonos<T>(valor: T): SinTelefono<T> {
  if (valor === undefined) return valor as SinTelefono<T>;
  return JSON.parse(JSON.stringify(valor, (clave, v) => (PRIVADOS.has(clave) ? undefined : v)));
}
