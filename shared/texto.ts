// Español de las pantallas y de WhatsApp: plurales, conteos y comparación sin tildes.
import { miles } from './formato.ts';

/** Plural en español de una palabra en singular (saco → sacos, bidón → bidones), o `conocido` si ya se sabe. */
export function pluralDe(singular: string, conocido?: string): string {
  if (conocido) return conocido;
  if (/[aeiouáéó]$/i.test(singular)) return `${singular}s`;
  const sinTilde = singular.replace(/ón$/, 'on').replace(/án$/, 'an').replace(/én$/, 'en');
  return `${sinTilde}es`;
}

/** La palabra según la cantidad: "negocio" con 1, "negocios" con el resto. */
export function segun(n: number, singular: string, plural = pluralDe(singular)): string {
  return n === 1 ? singular : plural;
}

/** "1 negocio", "3 negocios", "1.200 unidades". */
export function contar(n: number, singular: string, plural?: string): string {
  return `${miles(n)} ${segun(n, singular, plural)}`;
}

/** "¿Cuántas cajas?" o "¿Cuántos sacos?": el género sale del plural de la unidad. */
export function cuantos(plural: string): string {
  return /(as|des)$/i.test(plural) ? 'Cuántas' : 'Cuántos';
}

/** Primera letra en mayúscula. */
export const mayuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

/** En minúsculas y sin tildes, para comparar lo que escribe una persona ("Ñuñoa" → "nunoa"). */
export const sinTildes = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
