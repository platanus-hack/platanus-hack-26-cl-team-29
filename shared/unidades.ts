// Las unidades de venta de Bando: un listado fijo para que "kg", "kilos" y "kilo" sean lo mismo y dos productos se
// puedan comparar. La web las muestra en un selector; el servidor solo acepta estas; WhatsApp traduce lo que escribe
// la persona con `unidadDeTexto`.
import { pluralDe, sinTildes } from './texto.ts';

export const UNIDADES = [
  { id: 'unidad', plural: 'unidades', dichas: ['un', 'und', 'unid', 'u'] },
  { id: 'kilo', plural: 'kilos', dichas: ['kg', 'kgs', 'kilogramo', 'kilogramos', 'k'] },
  { id: 'gramo', plural: 'gramos', dichas: ['g', 'gr', 'grs'] },
  { id: 'miligramo', plural: 'miligramos', dichas: ['mg'] },
  { id: 'litro', plural: 'litros', dichas: ['l', 'lt', 'lts', 'ltr'] },
  { id: 'mililitro', plural: 'mililitros', dichas: ['ml', 'cc'] },
  { id: 'metro', plural: 'metros', dichas: ['m', 'mt', 'mts'] },
  { id: 'caja', plural: 'cajas', dichas: ['cj', 'cja'] },
  { id: 'bolsa', plural: 'bolsas', dichas: [] },
  { id: 'paquete', plural: 'paquetes', dichas: ['pqt', 'paq', 'pack'] },
  { id: 'saco', plural: 'sacos', dichas: [] },
  { id: 'rollo', plural: 'rollos', dichas: [] },
  { id: 'botella', plural: 'botellas', dichas: [] },
  { id: 'lata', plural: 'latas', dichas: [] },
  { id: 'bidon', plural: 'bidones', dichas: ['bidón'] },
  { id: 'bandeja', plural: 'bandejas', dichas: [] },
  { id: 'docena', plural: 'docenas', dichas: [] },
] as const;

export type IdUnidad = typeof UNIDADES[number]['id'];

/** Cómo se escribe cada una para mostrarla ("bidón", no "bidon"). */
const NOMBRES: Partial<Record<IdUnidad, string>> = { bidon: 'bidón' };
export const nombreUnidad = (u: IdUnidad): string => NOMBRES[u] ?? u;
export const pluralUnidad = (u: IdUnidad): string => UNIDADES.find(x => x.id === u)!.plural;
export const esUnidad = (texto: string): texto is IdUnidad => UNIDADES.some(u => u.id === texto);

/** "Kilos", "kg", "la bolsa", "bidones" → su unidad. Undefined si no es ninguna de la lista. */
export function unidadDeTexto(texto: string): IdUnidad | undefined {
  const t = sinTildes(texto).replace(/^(el|la|los|las|un|una|por|x)\s+/, '').replace(/\.$/, '').trim();
  return UNIDADES.find(u => u.id === t || sinTildes(u.plural) === t || u.dichas.some(d => sinTildes(d) === t))?.id;
}

/** Cómo se cuenta un producto en pantalla: "caja" y "cajas". */
export interface NombresUnidad {
  singular: string;
  plural: string;
}

export const SIN_UNIDAD: NombresUnidad = { singular: 'unidad', plural: 'unidades' };

/** Lo que se deduce del nombre cuando nadie dijo la unidad: la harina va en sacos, el aceite en bidones. */
function unidadSupuesta(producto: string): NombresUnidad {
  if (/harina|az[uú]car/i.test(producto)) return { singular: 'saco', plural: 'sacos' };
  if (/aceite/i.test(producto)) return { singular: 'bidón', plural: 'bidones' };
  if (/^caja/i.test(producto)) return { singular: 'caja', plural: 'cajas' };
  return SIN_UNIDAD;
}

/**
 * La única regla para nombrar la unidad de un producto en pantalla: la que trae el producto (con su plural, o el que
 * le corresponde) o, sin ella, la que se deduce de su nombre.
 */
export function unidadDelProducto(producto: string, conocida?: { unidad?: string; unidadPlural?: string }): NombresUnidad {
  return conocida?.unidad ? { singular: conocida.unidad, plural: pluralDe(conocida.unidad, conocida.unidadPlural) } : unidadSupuesta(producto);
}
