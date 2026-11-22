// Dataset OCDS oficial de ChileCompra en Open Contracting (licencia CC0): un "compiled release" por línea, un archivo
// por año (2026 pesa ~390 MB comprimido). No pide ticket. Se lee en streaming, línea a línea, nunca entero en memoria.
// Ver docs/hallazgos/20261121-1545-api-mercado-publico.md.
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { esDeAlimentos, niveles, rutDeEmpresa, unaLinea, unidadLegible, type OrdenMP, type PrecioMP } from './normalizar.ts';

export const urlOcds = (anio: string): string => `https://data.open-contracting.org/en/publication/144/download?name=${anio}.jsonl.gz`;

interface ItemOcds {
  id: string;
  description?: string;
  quantity?: number;
  unit?: { name?: string; value?: { amount?: number; currency?: string } };
  classification?: { id?: string };
}

interface Parte {
  id: string;
  name?: string;
  roles?: string[];
  address?: { region?: string };
  identifier?: { id?: string; legalName?: string };
}

export interface ReleaseOcds {
  ocid: string;
  date?: string;
  parties?: Parte[];
  tender?: { items?: ItemOcds[] };
  awards?: { id: string; date?: string; status?: string; suppliers?: { id: string }[]; items?: ItemOcds[] }[];
}

/** Unidades con el total del contrato en vez de un precio unitario. */
const SIN_PRECIO_UNITARIO = new Set(['global', 'mes']);
/** Bajo esto el "precio" es un marcador (vienen montos de $1 en contratos por suministro). */
const PRECIO_MINIMO = 10;
/** UNSPSC 50: alimentos, bebidas y tabaco. Convenio Marco viene sin clasificación ("0"): se mira la descripción. */
const esComida = (it: ItemOcds) => {
  const c = String(it.classification?.id ?? '');
  return c.startsWith('50') || (c === '0' && esDeAlimentos(it.description ?? ''));
};
/** Antes de parsear una línea: ¿puede traer comida? (descarta la mayoría de las licitaciones sin costo de JSON.parse). */
const puedeTraerComida = (linea: string) => linea.includes('Categoria/50') || linea.includes('Categoria/0"');

const tienePrecio = (it: ItemOcds) => {
  const valor = it.unit?.value;
  return (valor?.amount ?? 0) >= PRECIO_MINIMO && (!valor?.currency || valor.currency === 'CLP') && (it.quantity ?? 0) > 0
    && !SIN_PRECIO_UNITARIO.has(unaLinea(it.unit?.name).toLowerCase());
};

/**
 * Una adjudicación vigente con un solo proveedor (empresa) → una orden con sus ítems de comida con precio unitario.
 * Las adjudicaciones anteriores a `desde` (`AAAA-MM-DD`) no sirven como precio de referencia.
 */
export function normalizarRelease(r: ReleaseOcds, desde: string): OrdenMP[] {
  const partes = new Map((r.parties ?? []).map(p => [p.id, p]));
  const comprador = r.parties?.find(p => p.roles?.includes('buyer'));
  const categorias = new Map((r.tender?.items ?? []).map(it => [it.id, it.description]));
  return (r.awards ?? []).flatMap((a): OrdenMP[] => {
    const fecha = (a.date ?? r.date ?? '').slice(0, 10);
    const proveedor = a.suppliers?.length === 1 ? partes.get(a.suppliers[0]!.id) : undefined;
    const rut = rutDeEmpresa(proveedor?.identifier?.id);
    if (a.status !== 'active' || fecha < desde || !proveedor || !rut) return [];
    const precios = (a.items ?? []).filter(it => esComida(it) && tienePrecio(it)).map((it): PrecioMP => {
      const [rubro, categoria] = niveles(categorias.get(it.id));
      return {
        orden: `${r.ocid}/${a.id}`,
        producto: unaLinea(it.description).slice(0, 160),
        codigoProducto: Number(it.classification?.id) || null,
        rubro,
        categoria,
        unidad: unidadLegible(it.unit?.name),
        cantidad: it.quantity!,
        precioUnitario: Math.round(it.unit!.value!.amount!),
        fecha,
        despacho: unaLinea(comprador?.address?.region),
        organismo: unaLinea(comprador?.identifier?.legalName ?? comprador?.name),
      };
    }).filter(p => p.producto);
    if (!precios.length) return [];
    const nombre = unaLinea(proveedor.identifier?.legalName) || unaLinea(proveedor.name?.split(' | ')[0]);
    return [{ codigo: `${r.ocid}/${a.id}`, fecha, proveedor: { rut, nombre, comuna: '', region: unaLinea(proveedor.address?.region) }, precios }];
  });
}

/**
 * Lee un `.jsonl.gz` en streaming y entrega las órdenes de comida en lotes (para guardar y avisar mientras avanza).
 * Una línea que no se puede leer se salta.
 */
export async function leerOcds(
  comprimido: Readable,
  o: { desde: string; alLote: (ordenes: OrdenMP[]) => Promise<void>; tamanoLote?: number },
): Promise<{ lineas: number; ordenes: number }> {
  const tamano = o.tamanoLote ?? 500;
  let lote: OrdenMP[] = [];
  let lineas = 0, ordenes = 0;
  // `pipe` no pasa los errores de la descarga: un corte de red (ECONNRESET) quedaba como 'error' sin oyente y botaba el
  // servidor entero. Así el error llega al gunzip y esta función lo rechaza, para que quien la llama lo registre.
  const descomprimido = comprimido.pipe(createGunzip());
  comprimido.once('error', error => descomprimido.destroy(error));
  for await (const linea of createInterface({ input: descomprimido, crlfDelay: Infinity })) {
    lineas++;
    if (!puedeTraerComida(linea)) continue;
    try {
      lote.push(...normalizarRelease(JSON.parse(linea) as ReleaseOcds, o.desde));
    } catch {
      continue;
    }
    if (lote.length >= tamano) {
      ordenes += lote.length;
      await o.alLote(lote);
      lote = [];
    }
  }
  if (lote.length) await o.alLote(lote);
  return { lineas, ordenes: ordenes + lote.length };
}

/** ETag y Last-Modified del archivo (HEAD): si no cambiaron, no hay nada nuevo que leer. */
export async function versionOcds(url: string, pedir: typeof fetch = fetch): Promise<string> {
  const res = await pedir(url, { method: 'HEAD' });
  if (!res.ok) throw new Error(`HEAD ${url}: HTTP ${res.status}`);
  return `${res.headers.get('etag') ?? ''}|${res.headers.get('last-modified') ?? ''}`;
}

export async function descargarOcds(url: string, pedir: typeof fetch = fetch): Promise<Readable> {
  const res = await pedir(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
}
