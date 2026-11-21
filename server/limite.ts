import type { NextFunction, Request, Response } from 'express';
import { MENSAJE_LIMITE } from '../shared/texto.ts';

// Límites livianos en memoria, por ventana fija, para que nadie inunde una ruta durante la demo.
// La clave es siempre de una persona (teléfono, RUT, sesión o token), nunca la IP en rutas del público:
// toda la sala sale a internet por la misma IP del wifi del evento.

/** Cuenta usos por clave en ventanas de `ventanaMs`. Devuelve `true` mientras la clave no pase de `maximo`. */
export function crearLimitador(maximo: number, ventanaMs: number, reloj: () => number = Date.now) {
  const cuentas = new Map<string, { desde: number; n: number }>();
  return (clave: string): boolean => {
    const ahora = reloj();
    if (cuentas.size > 10_000) for (const [k, c] of cuentas) if (ahora - c.desde >= ventanaMs) cuentas.delete(k);
    const c = cuentas.get(clave);
    if (!c || ahora - c.desde >= ventanaMs) {
      cuentas.set(clave, { desde: ahora, n: 1 });
      return true;
    }
    c.n++;
    return c.n <= maximo;
  };
}

/**
 * Middleware de Express: responde 429 con un mensaje para la persona cuando la clave del pedido pasa el límite.
 * Si `clave` devuelve null o vacío, no limita (la ruta valida y rechaza por su cuenta).
 */
export function limitarPor<R extends Request>(
  maximo: number,
  ventanaMs: number,
  clave: (req: R) => string | null | undefined,
  mensaje = MENSAJE_LIMITE,
) {
  const cabe = crearLimitador(maximo, ventanaMs);
  return (req: R, res: Response, next: NextFunction) => {
    const k = clave(req);
    if (!k || cabe(k)) return next();
    res.status(429).json({ error: 'demasiados_pedidos', mensaje });
  };
}
