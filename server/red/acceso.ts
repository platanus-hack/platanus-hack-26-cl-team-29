import { createHash, randomInt } from 'node:crypto';
import { mismoSecreto } from './sesiones.ts';

// Códigos para entrar a la web: 6 dígitos que llegan por WhatsApp al teléfono del negocio. Viven en memoria y solo
// como hash: duran minutos, así que un reinicio a lo más obliga a pedir otro. Cada código sirve una vez y se
// invalida tras INTENTOS_POR_CODIGO errores; cuántos códigos pide un teléfono lo limita la ruta.

export const DURACION_CODIGO_MS = 10 * 60_000;
export const INTENTOS_POR_CODIGO = 5;

export type Verificacion = 'ok' | 'incorrecto' | 'vencido';

export interface CodigosAcceso {
  /** Un código nuevo para el teléfono; reemplaza al anterior. */
  generar(telefono: string): string;
  /** No lo borra: quien entra por primera vez vuelve con el mismo código y sus datos. */
  verificar(telefono: string, codigo: string): Verificacion;
  /** Lo borra al entrar. */
  consumir(telefono: string): void;
}

const hash = (telefono: string, codigo: string) => createHash('sha256').update(`${telefono}:${codigo}`).digest('hex');

export function crearCodigosAcceso(ahora: () => number = Date.now): CodigosAcceso {
  const pendientes = new Map<string, { hash: string; vence: number; errores: number }>();
  return {
    generar(telefono) {
      const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
      for (const [t, p] of pendientes) if (p.vence <= ahora()) pendientes.delete(t);
      pendientes.set(telefono, { hash: hash(telefono, codigo), vence: ahora() + DURACION_CODIGO_MS, errores: 0 });
      return codigo;
    },
    verificar(telefono, codigo) {
      const p = pendientes.get(telefono);
      if (!p || p.vence <= ahora()) return 'vencido';
      if (mismoSecreto(hash(telefono, codigo), p.hash)) return 'ok';
      if (++p.errores >= INTENTOS_POR_CODIGO) pendientes.delete(telefono);
      return 'incorrecto';
    },
    consumir(telefono) {
      pendientes.delete(telefono);
    },
  };
}

/** El mensaje de WhatsApp con el código. */
export const mensajeDeCodigo = (codigo: string) =>
  `Tu código para entrar a Bando es *${codigo}*. Vence en ${DURACION_CODIGO_MS / 60_000} minutos.\n\nSi no lo pediste, ignora este mensaje.`;
