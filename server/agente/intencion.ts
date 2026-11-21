// Qué quiso decir la persona. El intérprete (Claude o reglas) solo clasifica:
// nunca ejecuta nada. La máquina de estados decide qué hacer con la intención.

export type Intencion =
  | { readonly tipo: 'pedir'; readonly producto: string; readonly cantidad: number }
  | { readonly tipo: 'si' }
  | { readonly tipo: 'no' }
  | { readonly tipo: 'conforme' }
  | { readonly tipo: 'faltante'; readonly cantidad: number }
  | { readonly tipo: 'ver_pedidos' }
  | { readonly tipo: 'otro' };

/** Lo que trae un mensaje del público para sumarse a la compra conjunta. */
export interface DatosSala {
  readonly nombre?: string;
  readonly cantidad?: number;
  /** Habló de una subunidad ("80 rollos") con un número que no calza como cajas: hay que preguntar. */
  readonly dudaUnidad?: boolean;
  /** Falso si las reglas no están seguras y conviene que lo lea Claude. */
  readonly claro: boolean;
}

export interface UnidadSala {
  readonly singular: string;
  readonly plural: string;
  /** Cantidad máxima por negocio: un número de subunidades hasta aquí se toma como unidades. */
  readonly maximo: number;
}

export interface Interprete {
  /** `pregunta` es lo último que el agente preguntó, si espera respuesta. */
  interpretar(texto: string, pregunta: string | null): Promise<Intencion>;
  /** Solo para lo que las reglas no entienden con seguridad. */
  interpretarSala?(texto: string, pregunta: string, unidad: UnidadSala): Promise<DatosSala>;
}

const NUMEROS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, veinte: 20,
};
const CANTIDAD = `(\\d+|${Object.keys(NUMEROS).join('|')})`;

function aNumero(palabra: string): number {
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

// --- Compra conjunta: nombre del negocio y cantidad ---

/** Subunidades que la gente confunde con la unidad de venta ("rollos" por "cajas"). */
const SUBUNIDADES = ['rollos', 'rollo', 'unidades', 'unidad'];

/** Palabras de relleno que se sacan de los bordes del nombre. */
const RELLENO = new Set([
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'quiero', 'queremos', 'quisiera', 'sumarme', 'sumarnos', 'sumar',
  'me', 'nos', 'sumo', 'sumamos', 'entro', 'entramos', 'y', 'con', 'para', 'por', 'favor', 'porfa', 'gracias', 'ok', 'dale',
  'si', 'listo', 'ya', 'unos', 'unas', 'un', 'una', 'anotame', 'anota', 'pon', 'ponme', 'mejor', 'ahora', 'cambia', 'a',
  'son', 'serian', 'total', 'necesito', 'necesitamos', 'pido', 'pedimos',
]);
/** Palabras que dicen que el mensaje es una pregunta o un comentario, no un nombre. */
const NO_NOMBRE = /\b(cuanto|cuantos|cuantas|como|que|cuando|donde|precio|funciona|vale|cuesta|sirve|info|ayuda)\b/;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Saca nombre y cantidad de frases como "Almacén Rosita, 4", "4 cajas, Panadería Sol",
 * "somos Panadería Sol y queremos 3" o solo "4" / solo "Almacén Rosita".
 */
export function interpretarSalaConReglas(texto: string, unidad: UnidadSala): DatosSala {
  const original = texto.replace(/\s+/g, ' ').trim();
  if (!original) return { claro: true };
  const t = normalizar(original);
  if (/\?/.test(original) || (NO_NOMBRE.test(t) && !/\d/.test(t))) return { claro: false };

  const unidades = [unidad.plural, unidad.singular].map(u => normalizar(u)).map(escapar).join('|');
  const sub = SUBUNIDADES.map(escapar).join('|');
  // Primero dígitos: "Negocio Uno, 9" son 9, no 1. Las palabras ("tres cajas") solo si no hay dígitos.
  const patronDe = (numero: string) => new RegExp(`(?:^|\\s)(${numero})(?:\\s+(${unidades}|${sub}))?(?=\\s|$)`);
  const palabraNumero = Object.keys(NUMEROS).join('|');

  // Se busca en una copia sin tildes y en minúsculas con el mismo largo, y se recorta el original.
  const nfc = original.normalize('NFC');
  const plano = [...nfc].map(c => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || c).join('')
    .toLowerCase().replace(/[,;:.!¡]/g, ' ');
  const m = plano.match(patronDe('\\d{1,4}')) ?? plano.match(patronDe(palabraNumero));
  let cantidad: number | undefined;
  let dudaUnidad = false;
  let resto = nfc;
  if (m && m.index !== undefined) {
    cantidad = aNumero(m[1]);
    if (m[2] !== undefined && SUBUNIDADES.includes(m[2]) && cantidad > unidad.maximo) {
      dudaUnidad = true;
      cantidad = undefined;
    }
    // "4 cajas de rollos térmicos, Panadería Sol": lo que sigue con "de" es el producto, no el nombre.
    let fin = m.index + m[0].length;
    const producto = nfc.slice(fin).toLowerCase().match(/^\s+de\s[^,;:]*/);
    if (producto) fin += producto[0].length;
    resto = `${nfc.slice(0, m.index)} , ${nfc.slice(fin)}`;
  }
  const nombre = extraerNombre(resto, unidades);
  return {
    ...(nombre ? { nombre } : {}),
    ...(cantidad !== undefined ? { cantidad } : {}),
    ...(dudaUnidad ? { dudaUnidad } : {}),
    // Si no sacó nada de un mensaje de varias palabras, mejor que lo lea Claude si está disponible.
    claro: Boolean(nombre) || cantidad !== undefined || dudaUnidad || t.split(' ').length <= 3,
  };
}

function extraerNombre(resto: string, unidades: string): string | undefined {
  const limpio = resto
    .replace(/\b(mi|el|nuestro)\s+(negocio|local)(\s+se\s+llama|\s+es)?\b/gi, ' , ')
    .replace(/\bse\s+llama\b/gi, ' , ')
    .replace(/\b(soy|somos)(\s+de(l)?)?\b/gi, ' , ')
    .replace(new RegExp(`\\b(${unidades})\\b`, 'gi'), ' , ');
  for (const tramo of limpio.split(/[,;:\n.!¡]+/)) {
    const palabras = tramo.trim().split(/\s+/).filter(Boolean);
    while (palabras.length && RELLENO.has(normalizar(palabras[0]))) palabras.shift();
    while (palabras.length && RELLENO.has(normalizar(palabras.at(-1)!))) palabras.pop();
    const nombre = palabras.join(' ');
    if (/\p{L}.*\p{L}/u.test(nombre) && palabras.length <= 6 && !NO_NOMBRE.test(normalizar(nombre))) return nombre.slice(0, 40);
  }
  return undefined;
}
