// Taxonomía fija de Bando para lo que compran restaurantes y almacenes: una sola lista para la web, el servidor y la IA.
// Cada proveedor queda con una categoría principal y secundarias; cada producto, con la suya.
// Tres formas de llegar a una categoría, todas aquí: el código UNSPSC de ChileCompra, el código de actividad
// económica del SII (giro) y las palabras del producto o del giro.
import { sinTildes } from './texto.ts';

export const CATEGORIAS = [
  { id: 'abarrotes', nombre: 'Abarrotes' },
  { id: 'lacteos', nombre: 'Lácteos y huevos' },
  { id: 'carnes', nombre: 'Carnes y cecinas' },
  { id: 'pescados', nombre: 'Pescados y mariscos' },
  { id: 'frutas', nombre: 'Frutas y verduras' },
  { id: 'panaderia', nombre: 'Panadería y pastelería' },
  { id: 'bebidas', nombre: 'Bebidas y licores' },
  { id: 'congelados', nombre: 'Congelados' },
  { id: 'limpieza', nombre: 'Limpieza e higiene' },
  { id: 'envases', nombre: 'Envases y desechables' },
  { id: 'gas', nombre: 'Gas y combustibles' },
  { id: 'otros', nombre: 'Otros' },
] as const;

export type IdCategoria = typeof CATEGORIAS[number]['id'];

const NOMBRES = new Map<string, string>(CATEGORIAS.map(c => [c.id, c.nombre]));
export const nombreCategoria = (id: string): string => NOMBRES.get(id) ?? 'Otros';
export const esCategoria = (id: unknown): id is IdCategoria => typeof id === 'string' && NOMBRES.has(id);

/** Prefijo UNSPSC (segmento, familia o clase) → categoría. Gana el prefijo más largo. */
const UNSPSC: [prefijo: string, categoria: IdCategoria][] = [
  ['5010', 'abarrotes'], // frutos secos y semillas
  ['5011', 'carnes'],
  ['5012', 'pescados'],
  ['5013', 'lacteos'], // lácteos y huevos
  ['5015', 'abarrotes'], // aceites y grasas
  ['5016', 'abarrotes'], // azúcar, chocolate y confites
  ['5017', 'abarrotes'], // condimentos y conservantes
  ['5018', 'panaderia'],
  ['5019', 'abarrotes'], // alimentos preparados y en conserva
  ['5020', 'bebidas'],
  ['5021', 'otros'], // tabaco
  ['5022', 'abarrotes'], // cereales y legumbres
  ['503', 'frutas'], // frutas: frescas, orgánicas, congeladas, secas y en conserva
  ['504', 'frutas'], // verduras, ídem
  ['47131', 'limpieza'], // suministros de limpieza
  ['53131', 'limpieza'], // aseo personal
  ['141117', 'limpieza'], // papel higiénico, toallas y servilletas
  ['2412', 'envases'], // envases y embalajes
  ['521515', 'envases'], // vajilla y utensilios desechables
  ['1510', 'gas'], // combustibles
  ['1511', 'gas'], // gases combustibles
];

/** Categoría de un código UNSPSC (50221101 → abarrotes), o null si no es un insumo de la taxonomía. */
export function categoriaDeUnspsc(codigo: number | string | null | undefined): IdCategoria | null {
  const c = String(codigo ?? '');
  if (!/^\d{8}$/.test(c)) return null;
  let mejor: [string, IdCategoria] | undefined;
  for (const par of UNSPSC) if (c.startsWith(par[0]) && (!mejor || par[0].length > mejor[0].length)) mejor = par;
  return mejor?.[1] ?? null;
}

/**
 * Código de actividad económica del SII (CIIU4.CL, 6 dígitos) → categoría. Gana el prefijo más largo.
 * Mayoristas (4630), comercio especializado (4721, 4722), fabricación de alimentos (10, 11) y de insumos.
 */
const GIROS: [prefijo: string, categoria: IdCategoria][] = [
  ['463011', 'frutas'], ['463012', 'carnes'], ['463013', 'pescados'], ['463014', 'abarrotes'], ['463019', 'abarrotes'],
  ['463020', 'bebidas'],
  ['472101', 'abarrotes'], ['472102', 'carnes'], ['472103', 'frutas'], ['472104', 'pescados'], ['472105', 'panaderia'],
  ['472109', 'abarrotes'], ['4722', 'bebidas'],
  ['1010', 'carnes'], ['1020', 'pescados'], ['1030', 'frutas'], ['1040', 'abarrotes'], ['1050', 'lacteos'],
  ['1061', 'abarrotes'], ['1062', 'abarrotes'], ['1071', 'panaderia'], ['1072', 'abarrotes'], ['1073', 'abarrotes'],
  ['1074', 'abarrotes'], ['1075', 'congelados'], ['1079', 'abarrotes'], ['110', 'bebidas'],
  ['2023', 'limpieza'], ['1709', 'limpieza'], ['1702', 'envases'], ['2220', 'envases'],
  ['4661', 'gas'], ['4730', 'gas'], ['3520', 'gas'],
];

/** Palabras (sin tildes) → categoría. El orden importa: lo más específico primero ("frutos secos" antes que "fruta"). */
const PALABRAS: [RegExp, IdCategoria][] = [
  [/\b(congelad|helado)/, 'congelados'],
  [/\b(pescado|merluza|jurel|atun|salmon|reineta|marisc|chorito|camaron|surimi|productos del mar)/, 'pescados'],
  [/\b(pollo|trutro|pechuga|vacun|carne|cerdo|pavo|cecina|jamon|salchicha|vienesa|longaniza|chorizo|hamburguesa|mortadela|lomo|osobuco|posta|costilla|carnic)/, 'carnes'],
  [/\b(leche|lacteo|yogur|queso|quesillo|mantequilla|huevo|manjar)/, 'lacteos'],
  [/\b(pan|panes|hallullas?|marraquetas?|queques?|galletas?|bizcochos?|tortas?|kuchen)\b|panader|pasteler/, 'panaderia'],
  [/\b(jugo|bebida|agua mineral|nectar|gaseosa|vino|cerveza|pisco|licor|botiller)/, 'bebidas'],
  [/\b(detergente|cloro|lavaloza|jabon|desinfectante|papel higienico|toalla de papel|servilleta|limpieza|aseo|escoba|trapero|alcohol gel)/, 'limpieza'],
  [/\b(envase|desechable|plumavit|vaso plastico|film plastico|papel aluminio|bolsa de basura|embalaje|plastico)/, 'envases'],
  [/\b(gas licuado|cilindro de gas|parafina|lena|carbon|combustible)/, 'gas'],
  [/\b(conserva|snack|frutos secos|mermelada|abarrote|confite|chocolate)/, 'abarrotes'],
  [/\b(fruta|manzana|platano|naranja|pera|tomate|lechuga|papa|papas|cebolla|zanahoria|verdura|hortaliza|palta|limon|zapallo|choclo|acelga|repollo|pimenton|verduler)/, 'frutas'],
  [/\b(arroz|fideo|tallarin|harina|azucar|aceite|sal|cafe|te|cereal|legumbre|lenteja|poroto|garbanzo|avena|salsa|mayonesa|ketchup|levadura|condimento|vinagre|caldo|sopa|jalea|postre|flan|maicena|semola|quinoa|mani|almendra|nuez|nueces|alimentos)(es|s)?\b/, 'abarrotes'],
];

/** Categoría por las palabras de un texto (producto, giro o nombre), o null si ninguna calza. */
export function categoriaDeTexto(texto: string): IdCategoria | null {
  const t = sinTildes(texto);
  return PALABRAS.find(([re]) => re.test(t))?.[1] ?? null;
}

/** Categoría de un giro del SII: por su código y, si el código no dice, por las palabras de su descripción. */
export function categoriaDeGiro(giro: { codigo: string; descripcion: string }): IdCategoria | null {
  const c = giro.codigo.replace(/\D/g, '');
  let mejor: [string, IdCategoria] | undefined;
  for (const par of GIROS) if (c.startsWith(par[0]) && (!mejor || par[0].length > mejor[0].length)) mejor = par;
  return mejor?.[1] ?? categoriaDeTexto(giro.descripcion);
}
