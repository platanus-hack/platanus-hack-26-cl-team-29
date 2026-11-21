// Lo que sale de la red hacia pantallas y navegadores (GET /api/red/estado y cada `red:evento`) nunca
// lleva teléfonos. El teléfono vive solo dentro del servidor, para que el agente de WhatsApp responda.

/** El mismo tipo sin el campo `telefono`, a cualquier nivel. */
export type SinTelefono<T> = T extends readonly (infer U)[]
  ? SinTelefono<U>[]
  : T extends object
    ? { [K in keyof T as K extends 'telefono' ? never : K]: SinTelefono<T[K]> }
    : T;

/** Copia profunda sin ningún campo `telefono`, a cualquier nivel. */
export function sinTelefonos<T>(valor: T): SinTelefono<T> {
  return JSON.parse(JSON.stringify(valor, (clave, v) => (clave === 'telefono' ? undefined : v)));
}
