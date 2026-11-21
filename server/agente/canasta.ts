// La canasta de la compra conjunta: qué productos hay, cómo los nombra la gente y qué cambio
// pide cada mensaje ("4 cajas de rollos y 2 de etiquetas", "quita los guantes", "2 del 3").
// Intérprete de reglas, sin red ni credenciales; Claude es opcional (claude.ts) y estas reglas son su respaldo.
import type { ItemCarrito, ItemOrden, LicitacionSala, ParticipanteSala, ProductoCompra } from './puerto.ts';
import { pluralDe, sinTildes } from '../../shared/texto.ts';
import { NUMEROS, aNumero } from './intencion.ts';

export interface ProductoCatalogo {
  readonly id: string;
  /** Como lo nombra la gente: "rollos". */
  readonly corto: string;
  readonly unidad: string;
  readonly unidadPlural: string;
  /** Raíces sin tildes que lo identifican: "rollo", "termico". */
  readonly claves: readonly string[];
}

export interface Catalogo {
  readonly productos: readonly ProductoCatalogo[];
  /** Cantidad máxima por producto y negocio. */
  readonly maximo: number;
}

/** fijar: deja esa cantidad; sumar: agrega; quitar: resta (0 = lo saca entero). */
export type ModoCambio = 'fijar' | 'sumar' | 'quitar';

export interface CambioCarrito {
  readonly productoId: string;
  readonly modo: ModoCambio;
  readonly cantidad: number;
}

export type AccionCanasta = 'ver' | 'lista' | 'salir' | 'si' | 'no';

/** Lo que trae un mensaje del público sobre la compra conjunta. */
export interface DatosCanasta {
  readonly nombre?: string;
  readonly cambios: readonly CambioCarrito[];
  /** "solo rollos, 6": lo demás sale del carrito. */
  readonly soloEstos?: boolean;
  readonly accion?: AccionCanasta;
  /** Un número sin producto ("mejor 6"): se resuelve con el carrito o se pregunta de cuál. */
  readonly suelta?: { readonly cantidad: number; readonly modo: ModoCambio };
  /** Un producto sin número ("rollos"): se pregunta cuántas. */
  readonly sinCantidad?: { readonly productoId: string; readonly modo: ModoCambio };
  /** Pidió más que el máximo por producto ("80 rollos"): se pregunta en vez de adivinar. */
  readonly fueraDeRango?: boolean;
  /** Falso si las reglas no están seguras y conviene que lo lea Claude. */
  readonly claro: boolean;
}

/** Id del producto de una red sin canasta (un solo producto en los campos de la licitación). */
const PRODUCTO_UNICO = 'producto';

export function productosDe(l: LicitacionSala): readonly ProductoCompra[] {
  if (l.productos?.length) return l.productos;
  return [{
    id: PRODUCTO_UNICO, nombre: l.producto, unidad: l.unidad, unidadPlural: l.unidadPlural, precioSolo: l.precioSolo,
    tramos: l.tramos, totalUnidades: l.totalUnidades, precioActual: l.precioActual, siguienteTramo: l.siguienteTramo,
  }];
}

export function itemsDe(p: ParticipanteSala, l: LicitacionSala): readonly ItemCarrito[] {
  return p.items ?? [{ productoId: productosDe(l)[0].id, cantidad: p.cantidad }];
}

/** El producto de una línea de orden: por id, por nombre o el único que hay. */
export function productoDeItem(item: ItemOrden, productos: readonly ProductoCompra[]): ProductoCompra | undefined {
  return productos.find(p => p.id === item.productoId) ?? productos.find(p => p.nombre === item.producto)
    ?? (productos.length === 1 ? productos[0] : undefined);
}

/** "rollos" -> "rollo", "papeles" -> "papel", "guantes" -> "guante". */
const raiz = (palabra: string) => palabra.replace(/s$/, '').replace(/([lrndz])e$/, '$1');
const VACIAS = new Set(['de', 'del', 'la', 'el', 'las', 'los', 'para', 'con', 'y', 'mm', 'un', 'una', 'en', 'x']);
/** Cómo más le dice la gente a lo mismo (raíces). */
const SINONIMOS: Record<string, string> = {
  papel: 'rollo', boleta: 'rollo', impresora: 'rollo', termico: 'rollo',
  adhesivo: 'etiqueta', sticker: 'etiqueta', bolsita: 'bolsa', guantito: 'guante',
};

/** Palabras del nombre, sin el paréntesis ni la unidad del principio: "Caja de rollos térmicos" -> ["rollos", "térmicos"]. */
function palabrasDelNombre(nombre: string, unidad: string): string[] {
  const palabras = nombre.replace(/\(.*?\)/g, ' ').split(/\s+/).filter(Boolean);
  if (palabras.length > 1 && raiz(sinTildes(palabras[0])) === raiz(sinTildes(unidad))) palabras.shift();
  while (palabras.length > 1 && VACIAS.has(sinTildes(palabras[0]))) palabras.shift();
  return palabras;
}

/** "rollos" de "Caja de rollos térmicos 80 mm (50 un.)". */
export function cortoDe(p: Pick<ProductoCompra, 'nombre' | 'unidad'>): string {
  return (palabrasDelNombre(p.nombre, p.unidad)[0] ?? p.nombre).toLowerCase();
}

export function catalogoDe(l: LicitacionSala, maximo: number): Catalogo {
  return {
    maximo,
    productos: productosDe(l).map(p => {
      const claves = palabrasDelNombre(p.nombre, p.unidad).map(sinTildes)
        .filter(w => /^[a-z]{3,}$/.test(w) && !VACIAS.has(w)).map(raiz);
      if (/^[a-z]{3,}$/i.test(p.id)) claves.push(raiz(sinTildes(p.id)));
      return { id: p.id, corto: cortoDe(p), unidad: p.unidad, unidadPlural: pluralDe(p.unidad, p.unidadPlural), claves: [...new Set(claves)] };
    }),
  };
}

/** El carrito después de los cambios; las líneas que quedan en 0 salen. */
export function aplicarCambios(items: readonly ItemCarrito[], cambios: readonly CambioCarrito[], soloEstos = false): ItemCarrito[] {
  const carrito = new Map(soloEstos ? [] : items.map(i => [i.productoId, i.cantidad]));
  for (const c of cambios) {
    const actual = carrito.get(c.productoId) ?? 0;
    const nueva = c.modo === 'fijar' ? c.cantidad
      : c.modo === 'sumar' ? actual + c.cantidad
      : c.cantidad === 0 ? 0 : Math.max(0, actual - c.cantidad);
    if (nueva > 0) carrito.set(c.productoId, nueva);
    else carrito.delete(c.productoId);
  }
  return [...carrito].map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

// --- Intérprete de reglas ---

const SALIR = /\b(salir|salirme|me salgo|me retiro|retirarme|sacame|ya no quiero|no quiero nada|cancela(r)? (todo|mi pedido|el pedido)|vacia(r)?|(borra|quita|saca|elimina)(r)? todo)\b/;
const VER = /\b(mi pedido|mi carrito|mi compra|ver (mi )?(pedido|carrito)|que pedi|que llevo|resumen|cuanto (llevo|voy|pago|es|sale|me sale))\b/;
const LISTA = /\b(productos|lista|catalogo|menu|que (hay|venden|tienen)|precios)\b/;
const SI = /^(si|sip|ok|okey|dale|confirmo|claro|de acuerdo)( (por favor|sacame|porfa))?$/;
const NO = /^(no|nop|mejor no|todavia no|no gracias)$/;
const SOLO = /\b(solo|solamente|nada mas que)\b/;
const VERBOS: Record<string, ModoCambio> = {
  agrega: 'sumar', agregar: 'sumar', agregame: 'sumar', agregale: 'sumar', anade: 'sumar', anademe: 'sumar',
  suma: 'sumar', sumale: 'sumar', sumame: 'sumar', mas: 'sumar', otra: 'sumar', otro: 'sumar', otras: 'sumar', otros: 'sumar',
  quita: 'quitar', quitar: 'quitar', quitame: 'quitar', quitale: 'quitar', saca: 'quitar', sacar: 'quitar', sacale: 'quitar',
  elimina: 'quitar', eliminar: 'quitar', borra: 'quitar', borrar: 'quitar', sin: 'quitar', menos: 'quitar',
  cambia: 'fijar', cambiar: 'fijar', cambiame: 'fijar', deja: 'fijar', dejame: 'fijar', pon: 'fijar', ponme: 'fijar',
  mejor: 'fijar', ahora: 'fijar',
};
/**
 * Si el mensaje suma, fija o quita. Bugs reales de la sala lo dejaron así:
 *  - "más" solo suma junto al número ("4 más", "4 cajas más"); en "pa que sea más barato" no es cantidad.
 *  - "las 4 que faltan" suma.
 *  - "las 10 en total" fija, aunque diga "más" en otra parte.
 */
function modoDe(tokens: readonly string[]): ModoCambio | undefined {
  const numero = tokens.findIndex(t => /^\d{1,4}$/.test(t));
  const masJuntoAlNumero = tokens.some((t, i) => t === 'mas' && (numero < 0 || Math.abs(i - numero) <= 2));
  let modo: ModoCambio | undefined;
  for (const token of tokens) if (token !== 'mas' && token in VERBOS) { modo = VERBOS[token]; break; }
  if (modo !== 'quitar' && (masJuntoAlNumero || tokens.some(t => /^(falta|faltan|falten|faltaban)$/.test(t)))) modo = 'sumar';
  if (tokens.some(t => /^(total|totales|totals)$/.test(t))) modo = 'fijar';
  return modo;
}

/** "2 del 3", "4 de la 2", "1 del producto 3". */
const POSICION = /(?:^|\s)(\d{1,3})\s+(?:del?|de la)\s+(?:(?:producto|numero|opcion|item)\s+)?(?:n\s*)?(\d{1,2})(?=\s|$)/;
/** "el 3", "producto 2", "numero 1". */
const SOLO_POSICION = /(?:^|\s)(?:el|la|producto|numero|opcion|item)\s+(\d{1,2})(?=\s|$)/;

/** Palabras de relleno que se sacan de los bordes del nombre. */
const RELLENO = new Set([
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'quiero', 'queremos', 'quisiera', 'quiere', 'sumarme', 'sumarnos', 'sumar',
  'me', 'nos', 'sumo', 'sumamos', 'entro', 'entramos', 'y', 'con', 'para', 'por', 'favor', 'porfa', 'gracias', 'ok', 'dale',
  'si', 'listo', 'ya', 'unos', 'unas', 'anotame', 'anota', 'necesito', 'necesitamos', 'pido', 'pedimos', 'perfecto', 'aqui', 'aca',
  'solo', 'solamente', 'no', 'nop', 'mejor', 'ahora',
  // Verbos de pedir: "Quiero comprar guantes" no es el negocio "comprar".
  'comprar', 'compro', 'compramos', 'comprarme', 'pedir', 'pide', 'pideme', 'pidan', 'pedirte', 'llevar', 'llevo', 'llevamos',
  'encargar', 'encargo', 'encarga', 'dame', 'deme', 'denme', 'manda', 'mandame', 'traeme', 'queria', 'quisieramos', 'necesitaria',
]);
/** Palabras que dicen que el mensaje es una pregunta o un comentario, no un nombre. */
const NO_NOMBRE = /\b(cuanto|cuantos|cuantas|como|que|cuando|donde|precio|funciona|vale|cuesta|sirve|info|ayuda|puede|puedo)\b/;

interface Lectura { productoId?: string; cantidad?: number; modo?: ModoCambio; nombre?: string }

/** Copia sin tildes y en minúsculas, del mismo largo que el original, para recortar el nombre tal como lo escribió. */
function plano(original: string): string {
  return [...original].map(c => sinTildes(c) || c).join('').replace(/[¿?¡!.()"]/g, ' ');
}

function productoDeTexto(tokens: readonly string[], cat: Catalogo): string | undefined {
  const unidades = new Set(cat.productos.flatMap(p => [raiz(sinTildes(p.unidad)), raiz(sinTildes(p.unidadPlural))]));
  let deUnidad: string | undefined;
  for (const token of tokens) {
    const r = SINONIMOS[raiz(token)] ?? raiz(token);
    const p = cat.productos.find(x => x.claves.includes(r));
    if (!p) continue;
    if (!unidades.has(r)) return p.id; // "etiquetas" pesa más que "rollos" en "2 rollos de etiquetas"
    deUnidad ??= p.id;
  }
  if (deUnidad) return deUnidad;
  // Solo la unidad, si es de un único producto: "3 paquetes" son bolsas.
  for (const token of tokens) {
    const conEsa = cat.productos.filter(p => [p.unidad, p.unidadPlural].some(u => raiz(sinTildes(u)) === raiz(token)));
    if (conEsa.length === 1) return conEsa[0].id;
  }
  return undefined;
}

const esUnidad = (token: string, cat: Catalogo) =>
  cat.productos.some(p => [p.unidad, p.unidadPlural].some(u => raiz(sinTildes(u)) === raiz(token)));

/** "tres cajas", "una de rollos": un número en palabras solo cuenta junto a una unidad, un producto o "de" ("Bazar Uno" es un nombre). */
function esNumeroEnPalabras(tokens: readonly string[], i: number, cat: Catalogo): boolean {
  const siguiente = tokens[i + 1];
  return tokens[i] in NUMEROS && siguiente !== undefined
    && (siguiente === 'de' || siguiente === 'mas' || esUnidad(siguiente, cat) || productoDeTexto([siguiente], cat) !== undefined);
}

function esSignificativo(tokens: readonly string[], i: number, cat: Catalogo): boolean {
  const token = tokens[i];
  return /^\d+$/.test(token) || token in VERBOS || esNumeroEnPalabras(tokens, i, cat)
    || productoDeTexto([token], cat) !== undefined || esUnidad(token, cat);
}

function leerTramo(original: string, texto: string, cat: Catalogo): Lectura {
  const lectura: Lectura = {};
  let resto = texto;
  const pos = resto.match(POSICION);
  const n = cat.productos.length;
  if (pos && Number(pos[2]) >= 1 && Number(pos[2]) <= n) {
    lectura.cantidad = Number(pos[1]);
    lectura.productoId = cat.productos[Number(pos[2]) - 1].id;
    resto = resto.replace(pos[0], ' ');
  } else {
    const sola = resto.match(SOLO_POSICION);
    if (sola && Number(sola[1]) >= 1 && Number(sola[1]) <= n) {
      lectura.productoId = cat.productos[Number(sola[1]) - 1].id;
      resto = resto.replace(sola[0], ' ');
    }
  }
  const tokens = resto.split(/\s+/).filter(Boolean);
  lectura.modo = modoDe(tokens) ?? lectura.modo;
  if (lectura.cantidad === undefined) {
    // Primero dígitos ("Negocio Uno, 9" son 9); las palabras ("tres cajas") solo si no hay dígitos.
    const numero = tokens.find(t => /^\d{1,4}$/.test(t)) ?? tokens.find((_, i) => esNumeroEnPalabras(tokens, i, cat));
    if (numero !== undefined) lectura.cantidad = aNumero(numero);
  }
  lectura.productoId ??= productoDeTexto(tokens, cat);

  // El nombre: lo que va antes de la primera palabra de pedido ("Panadería Sol quiere 4 cajas").
  const palabras = [...original.matchAll(/\S+/g)];
  const planas = palabras.map(w => plano(w[0]).trim());
  const corte = planas.findIndex((_, i) => esSignificativo(planas, i, cat));
  const nombre = extraerNombre(palabras.slice(0, corte === -1 ? undefined : corte).map(w => w[0]).join(' '));
  if (nombre) lectura.nombre = nombre;
  return lectura;
}

function extraerNombre(texto: string): string | undefined {
  const limpio = texto
    .replace(/\b(mi|el|nuestro)\s+(negocio|local)(\s+se\s+llama|\s+es)?\b/gi, ' ')
    .replace(/\bse\s+llama\b/gi, ' ')
    .replace(/\b(soy|somos)(\s+de(l)?)?\b/gi, ' ');
  const palabras = limpio.trim().split(/\s+/).filter(Boolean);
  while (palabras.length && RELLENO.has(sinTildes(palabras[0]))) palabras.shift();
  while (palabras.length && RELLENO.has(sinTildes(palabras.at(-1)!))) palabras.pop();
  const nombre = palabras.join(' ');
  if (!/\p{L}.*\p{L}/u.test(nombre) || palabras.length > 6 || NO_NOMBRE.test(sinTildes(nombre))) return undefined;
  return nombre.slice(0, 40);
}

/** Separa "Almacén Rosita, 4 cajas de rollos y 2 de etiquetas" en tramos, con el original de cada uno. */
function tramos(original: string): { original: string; texto: string }[] {
  const p = plano(original);
  const cortes = [...p.matchAll(/[,;:\n]+|\s+y\s+|\s+e\s+/g)];
  const res: { original: string; texto: string }[] = [];
  let desde = 0;
  for (const c of [...cortes, null]) {
    const hasta = c ? c.index : p.length;
    const texto = p.slice(desde, hasta).trim();
    if (texto) res.push({ original: original.slice(desde, hasta).trim(), texto });
    if (c) desde = c.index + c[0].length;
  }
  return res;
}

export function interpretarCanastaConReglas(texto: string, cat: Catalogo): DatosCanasta {
  const original = texto.replace(/[ \t]+/g, ' ').trim().normalize('NFC');
  const t = plano(original).replace(/[,;:\n]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { cambios: [], claro: true };
  if (SALIR.test(t)) return { cambios: [], accion: 'salir', claro: true };
  if (VER.test(t)) return { cambios: [], accion: 'ver', claro: true };
  if (LISTA.test(t) && !/\d/.test(t)) return { cambios: [], accion: 'lista', claro: true };

  const cambios: CambioCarrito[] = [];
  const sinCantidad: { productoId: string; modo: ModoCambio }[] = [];
  const sueltas: { cantidad: number; modo: ModoCambio }[] = [];
  let nombre: string | undefined;
  let fueraDeRango = false;
  let modo: ModoCambio = 'fijar'; // el verbo vale para lo que sigue: "quita los guantes y las bolsas"
  const agregar = (productoId: string, cantidad: number, m: ModoCambio) => {
    if (m !== 'quitar' && cantidad > cat.maximo) fueraDeRango = true;
    else cambios.push(cantidad === 0 && m === 'fijar' ? { productoId, cantidad: 0, modo: 'quitar' } : { productoId, cantidad, modo: m });
  };

  for (const tramo of tramos(original)) {
    const l = leerTramo(tramo.original, tramo.texto, cat);
    if (l.modo) modo = l.modo;
    nombre ??= l.nombre;
    if (l.productoId && l.cantidad !== undefined) agregar(l.productoId, l.cantidad, modo);
    else if (l.productoId && modo === 'quitar') agregar(l.productoId, 0, modo);
    else if (l.productoId && sueltas.length) agregar(l.productoId, sueltas.shift()!.cantidad, modo);
    else if (l.productoId) sinCantidad.push({ productoId: l.productoId, modo });
    else if (l.cantidad !== undefined && sinCantidad.length) agregar(sinCantidad.shift()!.productoId, l.cantidad, modo);
    else if (l.cantidad !== undefined) sueltas.push({ cantidad: l.cantidad, modo });
  }
  // "agrega guantes": uno más.
  for (const s of sinCantidad.filter(s => s.modo === 'sumar')) agregar(s.productoId, 1, 'sumar');
  const falta = sinCantidad.find(s => s.modo !== 'sumar');
  const suelta = sueltas[0];
  if (suelta && suelta.modo !== 'quitar' && suelta.cantidad > cat.maximo) fueraDeRango = true;

  const algo = cambios.length > 0 || Boolean(nombre || falta || suelta) || fueraDeRango;
  const accion: AccionCanasta | undefined = algo ? undefined : SI.test(t) ? 'si' : NO.test(t) ? 'no' : undefined;
  const pregunta = /\?/.test(original) || NO_NOMBRE.test(t);
  return {
    ...(nombre ? { nombre } : {}),
    cambios,
    ...(SOLO.test(t) && cambios.length ? { soloEstos: true } : {}),
    ...(accion ? { accion } : {}),
    ...(suelta && !(suelta.cantidad > cat.maximo) ? { suelta } : {}),
    ...(falta ? { sinCantidad: falta } : {}),
    ...(fueraDeRango ? { fueraDeRango } : {}),
    // Si no sacó nada de un mensaje largo o es una pregunta, mejor que lo lea Claude si está disponible.
    claro: Boolean(accion) || (algo && !(pregunta && cambios.length === 0)) || (!pregunta && t.split(' ').length <= 3),
  };
}
