// Qué quiso decir la persona. El intérprete (Claude o reglas) solo clasifica:
// nunca ejecuta nada. La máquina de estados decide qué hacer con la intención.
import type { Catalogo, DatosCanasta } from './canasta.ts';

export type Intencion =
  | { readonly tipo: 'pedir'; readonly producto: string; readonly cantidad: number }
  | { readonly tipo: 'si' }
  | { readonly tipo: 'no' }
  | { readonly tipo: 'conforme' }
  | { readonly tipo: 'faltante'; readonly cantidad: number }
  | { readonly tipo: 'ver_pedidos' }
  | { readonly tipo: 'otro' };

export interface Interprete {
  /** `pregunta` es lo último que el agente preguntó, si espera respuesta. */
  interpretar(texto: string, pregunta: string | null): Promise<Intencion>;
  /** Compra conjunta: solo para lo que las reglas no entienden con seguridad. */
  interpretarCanasta?(texto: string, pregunta: string, catalogo: Catalogo): Promise<DatosCanasta>;
}

export const NUMEROS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, veinte: 20,
};
const CANTIDAD = `(\\d+|${Object.keys(NUMEROS).join('|')})`;

export function aNumero(palabra: string): number {
  return NUMEROS[palabra] ?? Number(palabra);
}

/** Quita tildes y mayúsculas para comparar sin depender de cómo escribe la persona. */
export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Intérprete sin red ni credenciales: cubre las frases de la demo. */
export function interpretarConReglas(texto: string): Intencion {
  const t = normalizar(texto);

  const faltante = t.match(new RegExp(`(?:faltaron|falto|faltan|falta|llegaron solo|solo llegaron) ${CANTIDAD}`));
  if (faltante) return { tipo: 'faltante', cantidad: aNumero(faltante[1]) };

  const pedido = t.match(new RegExp(`(?:pide|pideme|pedir|quiero|necesito|encarga|compra|manda|envia)(?: me)? ${CANTIDAD} (.+)`));
  if (pedido) return { tipo: 'pedir', cantidad: aNumero(pedido[1]), producto: pedido[2].trim() };

  if (/\b(todo bien|todo ok|llego todo|recibi todo|todo conforme|conforme)\b/.test(t)) return { tipo: 'conforme' };
  if (/^(no|nop|cancela|cancelar|mejor no|no gracias|todavia no|aun no|despues)\b/.test(t)) return { tipo: 'no' };
  if (/^(si|1|ok|dale|confirmo|confirma|claro|de acuerdo)\b/.test(t)) return { tipo: 'si' };
  if (/\b(emite|emitela|emitir|factura todo|facturalos|confirmalos|reclama|reclamala|envialo|hazlo)\b/.test(t)) return { tipo: 'si' };
  if (/^2$/.test(t)) return { tipo: 'no' };
  if (/\b(pedidos|ordenes|que hay|novedades)\b/.test(t)) return { tipo: 'ver_pedidos' };
  return { tipo: 'otro' };
}

export const interpreteDeReglas: Interprete = {
  interpretar: async texto => interpretarConReglas(texto),
};
