// Limpieza de lo que llega de Mercado Público antes de mostrarlo como referencia. Corre al leer (no al guardar),
// así también limpia las órdenes ya guardadas sin volver a descargar el dataset.
//
// 1. Cada ítem queda con una categoría de la taxonomía de Bando (shared/categorias.ts): por su código UNSPSC o, en
//    Convenio Marco (viene sin código), por las palabras del producto. Si no cae en ninguna, no es un insumo de
//    restaurantes y almacenes y se descarta: así salen los vales y tarjetas de alimentación ("ALIMENTACIÓN"), que no
//    nombran ningún producto.
// 2. Unidades a un set chico: unidad, kg, litro, caja, paquete.
// 3. Precios atípicos fuera: sobre PRECIO_UNITARIO_MAXIMO es el total de un contrato marcado como "unidad"; y, en cada
//    producto y unidad con al menos MIN_PARA_CERCAS precios, fuera de las cercas de Tukey (1,5 veces el rango
//    intercuartil) en escala logarítmica, porque los precios crecen en proporción, no en suma.
import { categoriaDeTexto, categoriaDeUnspsc, nombreCategoria, type IdCategoria } from '../../shared/categorias.ts';
import { sinTildes } from '../../shared/texto.ts';
import { unaLinea, type OrdenMP, type PrecioMP } from './normalizar.ts';

export type Unidad = 'unidad' | 'kg' | 'litro' | 'caja' | 'paquete';

/** Precio de un ítem limpio: con la categoría de Bando y la unidad normalizada. */
export interface PrecioLimpio extends PrecioMP {
  categoriaBando: IdCategoria;
  unidad: Unidad;
}
export interface OrdenLimpia extends OrdenMP {
  precios: PrecioLimpio[];
}

/** Ningún insumo de cocina o almacén cuesta más que esto por unidad: sobre esto es un total mal marcado. */
export const PRECIO_UNITARIO_MAXIMO = 2_000_000;
const MIN_PARA_CERCAS = 4;

const UNIDADES: [RegExp, Unidad][] = [
  [/^(kg|kgm|kgs|kilo|kilos|kilogramo|kilogramos)$/, 'kg'],
  [/^(l|lt|lts|ltr|litro|litros)$/, 'litro'],
  [/^(caja|cajas|bx|cj|cja)$/, 'caja'],
  [/^(paquete|paquetes|pk|pqt|paq|pack|bolsa|bolsas|saco|sacos|bandeja|bandejas|display|malla|fardo)$/, 'paquete'],
];

export const normalizarUnidad = (texto: string): Unidad => {
  const u = sinTildes(unaLinea(texto)).replace(/\.$/, '');
  return UNIDADES.find(([re]) => re.test(u))?.[1] ?? 'unidad';
};

/**
 * Nombre del producto sin el ruido de Convenio Marco: "ARROZ G2 BOLSA 1 K UNIDAD X REGIÓN(4206622) ARROZ G2..." →
 * "ARROZ G2 BOLSA 1 K". El código entre paréntesis y la región son de la ficha del convenio, no del producto.
 */
export function nombreDeProducto(texto: string): string {
  const antes = unaLinea(texto).split(/\(\d+\)/)[0]!;
  return antes.replace(/\s+UNIDAD\s+[IVXLC]+\s+REGI[OÓ]N\s*$/i, '').replace(/\s+(RM|REGI[OÓ]N METROPOLITANA)\s*$/i, '').trim() || unaLinea(texto);
}

export const categoriaDeItem = (p: Pick<PrecioMP, 'codigoProducto' | 'producto' | 'categoria'>): IdCategoria | null =>
  categoriaDeUnspsc(p.codigoProducto) ?? categoriaDeTexto(`${p.producto} ${p.categoria}`);

const cuartil = (ordenados: number[], q: number) => {
  const i = (ordenados.length - 1) * q;
  const bajo = Math.floor(i);
  return ordenados[bajo]! + (ordenados[Math.ceil(i)]! - ordenados[bajo]!) * (i - bajo);
};

/** Precios de un mismo producto y unidad: los que caen fuera de las cercas de Tukey (en log) salen. */
function dentroDeCercas(precios: PrecioLimpio[]): Set<PrecioLimpio> {
  if (precios.length < MIN_PARA_CERCAS) return new Set(precios);
  const logs = precios.map(p => Math.log(p.precioUnitario)).sort((a, b) => a - b);
  const q1 = cuartil(logs, 0.25), q3 = cuartil(logs, 0.75), rango = q3 - q1;
  return new Set(precios.filter(p => {
    const v = Math.log(p.precioUnitario);
    return v >= q1 - 1.5 * rango && v <= q3 + 1.5 * rango;
  }));
}

/** Clave para comparar precios del mismo producto: su código UNSPSC o, sin código, su nombre limpio. */
const claveDeProducto = (p: PrecioLimpio) => `${p.codigoProducto ?? sinTildes(p.producto)}|${p.unidad}`;

export function limpiarOrdenes(ordenes: OrdenMP[]): OrdenLimpia[] {
  const categorizadas = ordenes.map(o => ({
    ...o,
    precios: o.precios.flatMap((p): PrecioLimpio[] => {
      const categoriaBando = categoriaDeItem(p);
      if (!categoriaBando || p.precioUnitario > PRECIO_UNITARIO_MAXIMO) return [];
      return [{ ...p, producto: nombreDeProducto(p.producto), rubro: nombreCategoria(categoriaBando), categoriaBando, unidad: normalizarUnidad(p.unidad) }];
    }),
  }));
  const grupos = new Map<string, PrecioLimpio[]>();
  for (const p of categorizadas.flatMap(o => o.precios)) {
    const g = grupos.get(claveDeProducto(p));
    if (g) g.push(p);
    else grupos.set(claveDeProducto(p), [p]);
  }
  const validos = new Set([...grupos.values()].flatMap(g => [...dentroDeCercas(g)]));
  return categorizadas.map(o => ({ ...o, precios: o.precios.filter(p => validos.has(p)) })).filter(o => o.precios.length);
}
