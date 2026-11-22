// Las unidades de venta de Bando: un listado fijo para que "kg", "kilos" y "kilo" sean lo mismo y dos productos se
// puedan comparar. La web las muestra en un selector; el servidor solo acepta estas; WhatsApp traduce lo que escribe
// la persona con `unidadDeTexto`.
import { sinTildes } from './texto.ts';

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
