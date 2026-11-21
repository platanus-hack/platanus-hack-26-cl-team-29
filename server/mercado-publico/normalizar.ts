// Lo que usa Bando de Mercado Público: el proveedor (RUT, nombre, comuna) y un precio por ítem.
// Aquí, la normalización de una orden de compra de la API con ticket; la del dataset OCDS está en ocds.ts.
import { formatearRut, validarRut } from '../../shared/rut.ts';
import { sinTildes } from '../../shared/texto.ts';
import type { OrdenApi } from './api.ts';

export interface ProveedorMP {
  /** Forma para leer: 76.123.456-7. */
  rut: string;
  nombre: string;
  /** Vacía si la fuente no la trae (el dataset OCDS solo trae la región). */
  comuna: string;
  region: string;
}

export interface PrecioMP {
  /** Código de la orden o de la adjudicación en Mercado Público. */
  orden: string;
  /** Lo que escribió el proveedor (o, si no, el comprador), en una línea. */
  producto: string;
  /** Código UNSPSC del producto en ChileCompra: el mismo para dos productos escritos distinto. */
  codigoProducto: number | null;
  /** Primer nivel de la categoría ("Alimentos, bebidas y tabaco"): el rubro del proveedor. */
  rubro: string;
  /** Último nivel de la categoría ("Pan"). */
  categoria: string;
  unidad: string;
  cantidad: number;
  /** Precio unitario neto en pesos. */
  precioUnitario: number;
  /** Día de la orden o la adjudicación, `AAAA-MM-DD`. */
  fecha: string;
  /** Dónde se despacha: comuna de la unidad compradora (API) o su región (OCDS). */
  despacho: string;
  /** Organismo público que compró. Es público, pero solo sale contado ("clientes"), nunca por nombre. */
  organismo: string;
}

export interface OrdenMP {
  codigo: string;
  fecha: string;
  proveedor: ProveedorMP;
  precios: PrecioMP[];
}

/** Estado 9 de la API: orden cancelada, su precio no vale como referencia. */
const CANCELADA = 9;
/** Bajo este número el RUT es de una persona natural: no se guarda (el repo y la app no muestran datos personales). */
const PRIMER_RUT_DE_EMPRESA = 50_000_000;

/** Palabras que marcan una compra de alimentos o insumos de cocina y aseo. */
const ALIMENTOS = /\b(aliment|abarrote|viveres|comestible|fruta|verdura|hortaliza|carne|pollo|pescado|pan\b|panader|leche|lacteo|queso|huevo|arroz|aceite|harina|azucar|cafe|colacion|casino|cocina|aseo)/;

/** ¿Es de alimentos o insumos, por su texto? El listado por día de la API no trae ítems: se filtra por el nombre. */
export const esDeAlimentos = (texto: string): boolean => ALIMENTOS.test(sinTildes(texto));

export const unaLinea = (texto: string | undefined): string => (texto ?? '').replace(/\s+/g, ' ').trim();

/** El RUT de una empresa en forma para leer, o null si no es válido o es de una persona natural. */
export function rutDeEmpresa(texto: string | undefined): string | null {
  const rut = validarRut(texto);
  return rut && Number(rut.split('-')[0]) >= PRIMER_RUT_DE_EMPRESA ? formatearRut(rut) : null;
}

/** Códigos de unidad de ChileCompra a palabras ("KGM" → "kilogramo"); el resto, en minúscula. */
const UNIDADES: Record<string, string> = { ea: 'unidad', '000': 'unidad', kgm: 'kilogramo', ltr: 'litro', gl: 'unidad' };
export const unidadLegible = (texto: string | undefined): string => {
  const u = unaLinea(texto).toLowerCase();
  return UNIDADES[u] ?? (u || 'unidad');
};

/** Categoría de ChileCompra en niveles: "Alimentos, bebidas y tabaco / Pan y galletas / Pan" → [rubro, último nivel]. */
export function niveles(categoria: string | undefined): [rubro: string, categoria: string] {
  const partes = unaLinea(categoria).split(' / ');
  return [partes[0] ?? '', partes.at(-1) ?? ''];
}

const esPeso = (moneda: string | undefined) => !moneda || moneda === 'CLP';

/** Null si la orden no sirve como referencia: cancelada, en otra moneda, sin RUT de empresa o sin ítems con precio. */
export function normalizarOrden(oc: OrdenApi, dia: string): OrdenMP | null {
  const rut = rutDeEmpresa(oc.Proveedor?.RutSucursal);
  if (oc.CodigoEstado === CANCELADA || !esPeso(oc.TipoMoneda) || !rut) return null;
  const fecha = (oc.Fechas?.FechaEnvio || oc.Fechas?.FechaCreacion || dia).slice(0, 10);
  const precios = (oc.Items?.Listado ?? [])
    .filter(i => i.PrecioNeto > 0 && i.Cantidad > 0 && esPeso(i.Moneda))
    .map((i): PrecioMP => {
      const [rubro, categoria] = niveles(i.Categoria);
      return {
        orden: oc.Codigo,
        producto: unaLinea(i.EspecificacionProveedor) || unaLinea(i.EspecificacionComprador),
        codigoProducto: i.CodigoProducto ?? null,
        rubro,
        categoria,
        unidad: unidadLegible(i.Unidad),
        cantidad: i.Cantidad,
        precioUnitario: Math.round(i.PrecioNeto),
        fecha,
        despacho: unaLinea(oc.Comprador?.ComunaUnidad),
        organismo: unaLinea(oc.Comprador?.NombreOrganismo),
      };
    })
    .filter(p => p.producto);
  if (!precios.length) return null;
  const p = oc.Proveedor!;
  return {
    codigo: oc.Codigo,
    fecha,
    proveedor: { rut, nombre: unaLinea(p.Nombre), comuna: unaLinea(p.Comuna), region: unaLinea(p.Region) },
    precios,
  };
}
