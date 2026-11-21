import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Rol } from './tipos.ts';

// Sesiones del canal web: un token opaco por negocio, guardado solo como hash SHA-256. Viven en memoria:
// tras un reinicio del servidor (o de la demo, que borra los negocios del público) la persona vuelve a entrar con su nombre (o el proveedor con su código).
// Los tokens nunca van en la foto pública ni en eventos.

export interface Sesion {
  negocioId: string;
  rol: Rol;
}

export interface Sesiones {
  crear(sesion: Sesion): string;
  /** La sesión del token, o null si no existe. */
  buscar(token: string | undefined): Sesion | null;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function crearSesiones(): Sesiones {
  const porHash = new Map<string, Sesion>();
  return {
    crear(sesion) {
      const token = randomBytes(24).toString('base64url');
      porHash.set(hash(token), { ...sesion });
      return token;
    },
    buscar(token) {
      if (!token) return null;
      const s = porHash.get(hash(token));
      return s ? { ...s } : null;
    },
  };
}

/** Igualdad en tiempo constante, para tokens y códigos. */
export function mismoSecreto(enviado: unknown, esperado: string): boolean {
  const a = Buffer.from(String(enviado ?? '')), b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
