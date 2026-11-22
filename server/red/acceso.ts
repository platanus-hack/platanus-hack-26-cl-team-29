import { createHash, randomBytes, randomInt } from 'node:crypto';
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

/**
 * Enlaces para entrar sin escribir el código: el mensaje lleva `?entrar=<token>` y tocarlo entra solo. El token es
 * aleatorio y opaco (no lleva teléfono ni código), sirve una vez y vence con el código. Se guarda solo su hash.
 */
export interface EnlacesAcceso {
  /** Un token nuevo para ese teléfono y su código vigente. */
  crear(telefono: string, codigo: string): string;
  /** El teléfono y el código del token, y lo borra: sirve una vez. Null si no existe o venció. */
  canjear(token: string): { telefono: string; codigo: string } | null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function crearEnlacesAcceso(ahora: () => number = Date.now): EnlacesAcceso {
  const pendientes = new Map<string, { telefono: string; codigo: string; vence: number }>();
  return {
    crear(telefono, codigo) {
      for (const [h, p] of pendientes) if (p.vence <= ahora() || p.telefono === telefono) pendientes.delete(h);
      const token = randomBytes(24).toString('base64url');
      pendientes.set(hashToken(token), { telefono, codigo, vence: ahora() + DURACION_CODIGO_MS });
      return token;
    },
    canjear(token) {
      const h = hashToken(token);
      const p = pendientes.get(h);
      pendientes.delete(h);
      return p && p.vence > ahora() ? { telefono: p.telefono, codigo: p.codigo } : null;
    },
  };
}

/**
 * El mensaje de WhatsApp con el código: el código solo en su línea y en monoespaciado (mantener apretado copia solo el
 * número) y, si hay URL pública, el enlace para entrar directo. El botón nativo "Copiar código" de WhatsApp exige una
 * plantilla de autenticación aprobada por Meta (docs/decisiones, entrada directa por enlace).
 */
export const mensajeDeCodigo = (codigo: string, enlace?: string) => [
  'Tu código para entrar a Bando:',
  `\`\`\`${codigo}\`\`\``,
  ...(enlace ? ['', `O entra directo: ${enlace}`] : []),
  '',
  `Vence en ${DURACION_CODIGO_MS / 60_000} minutos. Si no lo pediste, ignora este mensaje.`,
].join('\n');
