// Qué quiso decir la persona. El intérprete (Claude o reglas) solo clasifica:
// nunca ejecuta nada. La máquina de estados decide qué hacer con la intención.
import type { Catalogo, DatosCanasta } from './canasta.ts';
import { sinTildes } from '../../shared/texto.ts';

export type Intencion =
  /** `proveedor`: el nombre que dijo la persona, si eligió uno; si no, el agente elige el mejor. */
  | { readonly tipo: 'pedir'; readonly producto: string; readonly cantidad: number; readonly proveedor?: string }
  | { readonly tipo: 'si' }
  | { readonly tipo: 'no' }
  | { readonly tipo: 'conforme' }
  | { readonly tipo: 'faltante'; readonly cantidad: number }
  | { readonly tipo: 'ver_pedidos' }
  /** Un proveedor ofrece un precio por un producto de la compra conjunta (si no dice cuál, se le pregunta). */
  | { readonly tipo: 'ofertar'; readonly precio: number; readonly producto?: string }
  /** Un proveedor suma un producto nuevo a la compra conjunta: nombre, unidad de venta y precio. */
  | { readonly tipo: 'crear_producto'; readonly nombre: string; readonly unidad: string; readonly precio: number }
  /** Quiere vender en la red: registro de proveedor con su certificado digital. */
  | { readonly tipo: 'ser_proveedor' }
  /** Un proveedor pregunta cómo van sus ofertas. */
  | { readonly tipo: 'ver_ofertas' }
  /** Respuesta en lenguaje libre (una pregunta, una consulta): se manda tal cual, no ejecuta nada. */
  | { readonly tipo: 'respuesta'; readonly texto: string }
  | { readonly tipo: 'otro' };

/** Lo que el intérprete conversacional sabe del mensaje. Nunca incluye teléfonos. */
export interface EntradaConversacion {
  readonly negocio: { readonly id: string; readonly nombre: string; readonly comuna: string; readonly rol: 'comprador' | 'proveedor'; readonly vende?: boolean };
  readonly texto: string;
  /** Mensajes anteriores de esta conversación, del más antiguo al más nuevo (sin el actual). */
  readonly historial: readonly { readonly de: 'persona' | 'bando'; readonly texto: string }[];
  /** Lo que el agente está esperando que la persona confirme, si hay algo. */
  readonly pendiente: string | null;
}

export interface Interprete {
  /** `pregunta` es lo último que el agente preguntó, si espera respuesta. */
  interpretar(texto: string, pregunta: string | null): Promise<Intencion>;
  /** Compra conjunta: solo para lo que las reglas no entienden con seguridad. */
  interpretarCanasta?(texto: string, pregunta: string, catalogo: Catalogo): Promise<DatosCanasta>;
  /** Con contexto y consultas a la red: puede responder preguntas además de clasificar (server/ia/). */
  conversar?(entrada: EntradaConversacion): Promise<Intencion>;
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
  return sinTildes(texto).replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Unidades de venta que se reconocen al crear un producto ("vendo cajas de café"); en singular. */
const UNIDADES = ['caja', 'bolsa', 'saco', 'paquete', 'rollo', 'botella', 'bidón', 'kilo', 'unidad', 'pack', 'bandeja', 'docena', 'litro', 'frasco', 'lata', 'sobre', 'resma'];

/** "$12.000", "12000", "12 000" → 12000. Solo montos de 3 dígitos o más ("1 kg" no es un precio). */
const PRECIO = /\$\s*(\d{1,3}(?:[.\s]\d{3})+|\d+)|\b(\d{1,3}(?:\.\d{3})+|\d{3,})\b/;
const precioDe = (m: RegExpExecArray) => Number((m[1] ?? m[2])!.replace(/[.\s]/g, ''));

/** Una unidad de venta en singular si la palabra es una ("cajas" → "caja"). */
function unidadDe(palabra: string | undefined): string | undefined {
  const p = sinTildes(palabra ?? '');
  return UNIDADES.find(u => [sinTildes(u), `${sinTildes(u)}s`, `${sinTildes(u)}es`].includes(p));
}

/** "oferto $25.000 por rollos", "te dejo los guantes en 7.900". */
function leerOferta(texto: string): Intencion | null {
  const t = normalizar(texto);
  if (!/\b(oferto|ofertar|ofrezco|te lo dejo|te los dejo|te las dejo|lo dejo en|mi oferta)\b/.test(t)) return null;
  const precio = PRECIO.exec(texto);
  if (!precio) return null;
  const resto = texto.replace(precio[0], ' ').replace(/\b(oferto|ofertar|ofrezco|te l[oa]s? dejo|lo dejo|mi oferta( es)?)\b/gi, ' ')
    .replace(/(^|\s)(por|en|a|para|de)(?=\s|$)/gi, ' ').replace(/[$,.]/g, ' ').replace(/\s+/g, ' ').trim();
  return { tipo: 'ofertar', precio: precioDe(precio), ...(resto ? { producto: resto } : {}) };
}

/** "vendo café molido 1 kg a $12.000 la bolsa", "nuevo producto: cajas de té a 4500". */
function leerProductoNuevo(texto: string): Intencion | null {
  const verbo = /^\s*(vendo|agrega(?:r)? (?:el )?producto|nuevo producto|suma(?:r)? (?:el )?producto)\s*:?\s*/i.exec(texto);
  if (!verbo) return null;
  const sinVerbo = texto.slice(verbo[0].length);
  const precio = PRECIO.exec(sinVerbo);
  if (!precio) return null;
  const antes = sinVerbo.slice(0, precio.index).replace(/\s+(a|en|por|x)\s*$/i, '').trim();
  const despues = sinVerbo.slice(precio.index + precio[0].length).trim();
  const porUnidad = /^(?:la|el|por|cada|x|c\/u)\s+([\p{L}]+)/iu.exec(despues)?.[1];
  const primera = antes.split(/\s+/)[0];
  const unidad = unidadDe(porUnidad) ?? unidadDe(primera) ?? 'unidad';
  // "cajas de té": el nombre es "Té"; "café molido 1 kg": queda tal cual.
  const nombre = unidadDe(primera) ? antes.replace(/^\S+\s+(?:de\s+)?/i, '') : antes;
  if (nombre.length < 2) return null;
  return { tipo: 'crear_producto', nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), unidad, precio: precioDe(precio) };
}

/** Intérprete sin red ni credenciales: cubre las frases de la demo. */
export function interpretarConReglas(texto: string): Intencion {
  const t = normalizar(texto);

  if (/\b(quiero vender|soy proveedor|ser proveedor|registrarme como proveedor|vender en (la red|bando))\b/.test(t)) return { tipo: 'ser_proveedor' };
  const productoNuevo = leerProductoNuevo(texto);
  if (productoNuevo) return productoNuevo;
  const oferta = leerOferta(texto);
  if (oferta) return oferta;
  if (/\b(mis ofertas|como voy|como van mis ofertas)\b/.test(t)) return { tipo: 'ver_ofertas' };

  const faltante = t.match(new RegExp(`(?:faltaron|falto|faltan|falta|llegaron solo|solo llegaron) ${CANTIDAD}`));
  if (faltante) return { tipo: 'faltante', cantidad: aNumero(faltante[1]) };

  const pedido = t.match(new RegExp(`(?:pide|pideme|pedir|quiero|necesito|encarga|compra|manda|envia)(?: me)?(?: (?:comprar|pedir|encargar))? ${CANTIDAD} (.+)`));
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
