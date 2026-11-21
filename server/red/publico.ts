// Lo que sale de la red hacia pantallas y navegadores (GET /api/red/estado, respuestas HTTP y cada
// `red:evento`) nunca lleva teléfonos, tokens de sesión ni el RUT y los datos del SII de un comprador
// (`rut`, `contribuyente`): esos solo los ve su dueño en /app (`facturaA` de GET /yo). Es el único sanitizador: `emitir` lo aplica a
// todo evento antes de entregarlo a cualquier oyente de `red.escuchar` (incluido el `io.emit`), y
// `estadoPublico()` a la foto. El teléfono y el RUT viven solo dentro del servidor (agente de WhatsApp y facturación).

const PRIVADOS = new Set(['telefono', 'token', 'rut', 'contribuyente']);
type Privado = 'telefono' | 'token' | 'rut' | 'contribuyente';

/** El mismo tipo sin los campos privados (`telefono`, `token`, `rut`, `contribuyente`), a cualquier nivel. */
export type SinTelefono<T> = T extends readonly (infer U)[]
  ? SinTelefono<U>[]
  : T extends object
    ? { [K in keyof T as K extends Privado ? never : K]: SinTelefono<T[K]> }
    : T;

/** Copia profunda sin ningún campo privado (`telefono`, `token`, `rut`, `contribuyente`), a cualquier nivel. */
export function sinTelefonos<T>(valor: T): SinTelefono<T> {
  if (valor === undefined) return valor as SinTelefono<T>;
  return JSON.parse(JSON.stringify(valor, (clave, v) => (PRIVADOS.has(clave) ? undefined : v)));
}
