// Reglas de la marca que se pueden revisar leyendo el código (DESIGN.md, "Reglas"). Funciones puras: reciben la ruta y
// el texto de un archivo y cuentan cuántas veces rompe cada regla. `npm run marca` (scripts/revisar-marca.ts) las corre
// sobre client/src y las compara con la línea base.

export type Regla = 'color-escrito' | 'tipografia-anterior' | 'formato-suelto' | 'letra-chica' | 'emoji';

export const REGLAS: Record<Regla, string> = {
  'color-escrito': 'Color escrito a mano: usa un token de client/src/marca/tokens.css.',
  'tipografia-anterior': 'Oxanium o JetBrains Mono en una vista con la marca nueva: la marca usa solo Inter.',
  'formato-suelto': 'toLocaleString suelto: los montos van con dinero() y las fechas con los formatos de shared/.',
  'letra-chica': 'Texto de menos de 12 px.',
  'emoji': 'Emoji en el código: la marca usa íconos de línea o de flujo, nunca emojis.',
};

/** El único archivo donde se escriben colores. */
const ARCHIVO_DE_TOKENS = 'client/src/marca/tokens.css';

/** Un `#` de color, no el de un enlace (`href="#add"`) ni el de una entidad HTML. */
const COLOR = /(?<![\w&/-]|href=["'`{]{1,2})#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(/g;
const TIPOGRAFIA_ANTERIOR = /Oxanium|JetBrains Mono/g;
const TO_LOCALE = /\.toLocaleString\(/g;
const TAMANO_CSS = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g;
const TAMANO_JSX = /fontSize\s*:\s*['"]?(\d+(?:\.\d+)?)(?:px)?['"]?/g;
/** Pictogramas, sin los signos legales (©, ®, ™) que también entran en esa categoría. */
const EMOJI = /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}/gu;
/** Una vista migrada usa la marca nueva: lleva `.bando-ui`, `.bando-proyeccion` o piezas `bm-`. */
const MIGRADA = /bando-ui|bando-proyeccion|\bbm-[a-z]/;

const contar = (texto: string, patron: RegExp) => texto.match(patron)?.length ?? 0;
const chicos = (texto: string, patron: RegExp) => [...texto.matchAll(patron)].filter(m => Number(m[1]) < 12).length;
/** Quita comentarios para no contar un color o una fuente que solo se menciona en una explicación. */
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Cuántas veces rompe cada regla un archivo. Solo aparecen las reglas que rompe. */
export function revisarArchivo(ruta: string, texto: string): Partial<Record<Regla, number>> {
  const codigo = sinComentarios(texto);
  const cuenta: Partial<Record<Regla, number>> = {
    'color-escrito': ruta === ARCHIVO_DE_TOKENS ? 0 : contar(codigo, COLOR),
    'tipografia-anterior': MIGRADA.test(codigo) ? contar(codigo, TIPOGRAFIA_ANTERIOR) : 0,
    'formato-suelto': contar(codigo, TO_LOCALE),
    'letra-chica': chicos(codigo, TAMANO_CSS) + chicos(codigo, TAMANO_JSX),
    'emoji': contar(codigo, EMOJI),
  };
  return Object.fromEntries(Object.entries(cuenta).filter(([, n]) => n! > 0));
}

export type Cuentas = Record<string, Partial<Record<Regla, number>>>;

/** Lo que empeoró respecto de la línea base: archivo, regla, cuántas había y cuántas hay. */
export function loQueEmpeoro(base: Cuentas, actual: Cuentas): { ruta: string; regla: Regla; antes: number; ahora: number }[] {
  return Object.entries(actual).flatMap(([ruta, reglas]) => Object.entries(reglas)
    .map(([regla, ahora]) => ({ ruta, regla: regla as Regla, antes: base[ruta]?.[regla as Regla] ?? 0, ahora: ahora! }))
    .filter(x => x.ahora > x.antes));
}
