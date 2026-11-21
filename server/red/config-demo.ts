import { CANASTA_DEMO, PISO_ROLLOS_DEMO, pisoPorDefecto } from '../../shared/canasta-demo.ts';
import type { Tramo } from './tipos.ts';

// Configuración de "la sala compra junta". El proveedor es una empresa real: su nombre, comuna y
// WhatsApp llegan solo por variables de entorno, nunca en el código. Los valores por defecto son genéricos.

/** Un producto de la canasta de la demo, con su piso oculto para competir. */
export interface ProductoDemo {
  id: string;
  nombre: string;
  unidad: string;
  unidadPlural: string;
  precioSolo: number;
  tramos: Tramo[];
  /** Precio mínimo oculto del proveedor real por este producto cuando compite. */
  piso: number;
}

export interface ConfigDemo {
  /** La canasta de la compra conjunta (DEMO_PRODUCTOS). `producto`, `unidad`, `precioSolo` y `tramos` reflejan el primero. */
  productos: ProductoDemo[];
  proveedor: { nombre: string; comuna: string; telefono: string };
  /** Logo del proveedor de la sala (DEMO_PROVEEDOR_LOGO_URL): URL https o data:, o null. */
  proveedorLogoUrl: string | null;
  producto: string;
  /** Unidad de venta en singular ("caja") y plural ("cajas"). */
  unidad: string;
  unidadPlural: string;
  /** Lo que paga cada comprador si compra solo. */
  precioSolo: number;
  /** Precio unitario por volumen total del grupo, de menor a mayor `desde`. */
  tramos: Tramo[];
  /** Minutos que dura la compra conjunta desde que se siembra o reinicia. */
  minutos: number;
  /** Número de WhatsApp de la demo, solo dígitos (para el QR y el enlace wa.me). */
  whatsappNumero: string | null;
  /** Precio mínimo oculto del proveedor real cuando compite (DEMO_PRECIO_PISO). */
  precioPiso: number;
  /**
   * Datos ficticios de la demo (DEMO_FICTICIOS=1): negocios sembrados, el proveedor único de la sala y sus rivales.
   * Apagado por defecto: la red parte vacía y la llenan personas reales por WhatsApp.
   */
  ficticios: boolean;
  /** Proveedores ficticios compiten en vivo contra el real. Solo con `ficticios` (DEMO_COMPETENCIA=0 lo apaga). */
  competencia: boolean;
}

/** Cantidad máxima por participante en la compra conjunta. */
export const CANTIDAD_MAXIMA = 20;

/** La canasta por defecto: el primero (rollos) se puede cambiar con DEMO_PRODUCTO, DEMO_PRECIO_SOLO, DEMO_TRAMOS, etc. */
const [ROLLOS, ...OTROS_PRODUCTOS] = CANASTA_DEMO;
const TRAMOS = ROLLOS!.tramos;

function leerListaTramos(lista: unknown): Tramo[] {
  if (!Array.isArray(lista) || lista.length === 0) throw new Error('los tramos deben ser una lista no vacía');
  const leidos = lista.map((t: { desde?: unknown; precioUnitario?: unknown }) => {
    const desde = Number(t?.desde), precioUnitario = Number(t?.precioUnitario);
    if (!Number.isInteger(desde) || desde < 1 || !(precioUnitario > 0)) throw new Error('cada tramo necesita desde >= 1 y precioUnitario > 0');
    return { desde, precioUnitario };
  });
  return leidos.sort((a, b) => a.desde - b.desde);
}

/** `DEMO_TRAMOS` en JSON (`[{ "desde": 1, "precioUnitario": 32000 }, ...]`). Si no es válido, se usa el de defecto. */
function leerTramos(texto: string | undefined): Tramo[] {
  if (!texto) return TRAMOS;
  try {
    return leerListaTramos(JSON.parse(texto));
  } catch (error) {
    console.warn(`[red] DEMO_TRAMOS no es válido (${error instanceof Error ? error.message : error}); se usan los tramos por defecto`);
    return TRAMOS;
  }
}

/**
 * `DEMO_PRODUCTOS` en JSON: `[{ "id", "nombre", "unidad", "unidadPlural", "precioSolo", "tramos", "piso"? }]`.
 * Sin `piso`: DEMO_PRECIO_PISO para `rollos` y 80 % del primer tramo para los demás. Si no es válido, null.
 */
function leerProductos(texto: string | undefined, pisoRollos: number): ProductoDemo[] | null {
  if (!texto) return null;
  try {
    const lista: unknown = JSON.parse(texto);
    if (!Array.isArray(lista) || lista.length === 0) throw new Error('debe ser una lista no vacía');
    const productos = lista.map((p: Record<string, unknown>) => {
      const id = String(p?.id ?? '').trim(), nombre = String(p?.nombre ?? '').trim();
      const unidad = String(p?.unidad ?? '').trim() || 'unidad';
      const precioSolo = Number(p?.precioSolo);
      if (!id || !nombre || !(precioSolo > 0)) throw new Error('cada producto necesita id, nombre y precioSolo > 0');
      const t = leerListaTramos(p.tramos);
      const piso = Number(p.piso) > 0 ? Number(p.piso) : id === 'rollos' ? pisoRollos : pisoPorDefecto(t, precioSolo);
      return { id, nombre, unidad, unidadPlural: String(p?.unidadPlural ?? '').trim() || `${unidad}s`, precioSolo, tramos: t, piso };
    });
    if (new Set(productos.map(p => p.id)).size !== productos.length) throw new Error('los id de producto se repiten');
    return productos;
  } catch (error) {
    console.warn(`[red] DEMO_PRODUCTOS no es válido (${error instanceof Error ? error.message : error}); se usa la canasta por defecto`);
    return null;
  }
}

const positivo = (texto: string | undefined, porDefecto: number) => {
  const n = Number(texto);
  return texto && n > 0 ? n : porDefecto;
};

export function configDemo(env: NodeJS.ProcessEnv = process.env): ConfigDemo {
  const precioPiso = positivo(env.DEMO_PRECIO_PISO, PISO_ROLLOS_DEMO);
  const rollos: ProductoDemo = {
    id: 'rollos',
    nombre: env.DEMO_PRODUCTO?.trim() || ROLLOS!.nombre,
    unidad: env.DEMO_UNIDAD?.trim() || ROLLOS!.unidad,
    unidadPlural: env.DEMO_UNIDAD_PLURAL?.trim() || (env.DEMO_UNIDAD ? `${env.DEMO_UNIDAD.trim()}s` : ROLLOS!.unidadPlural),
    precioSolo: positivo(env.DEMO_PRECIO_SOLO, ROLLOS!.precioSolo),
    tramos: leerTramos(env.DEMO_TRAMOS),
    piso: precioPiso,
  };
  const productos = leerProductos(env.DEMO_PRODUCTOS, precioPiso)
    ?? [rollos, ...OTROS_PRODUCTOS.map(p => ({ ...structuredClone(p), piso: pisoPorDefecto(p.tramos, p.precioSolo) }))];
  const primero = productos[0]!;
  const ficticios = env.DEMO_FICTICIOS?.trim() === '1';
  return {
    productos,
    proveedor: {
      nombre: env.DEMO_PROVEEDOR_NOMBRE?.trim() || 'Proveedor de la demo',
      comuna: env.DEMO_PROVEEDOR_COMUNA?.trim() || 'Santiago',
      telefono: env.DEMO_TELEFONO_PROVEEDOR?.trim() || '',
    },
    proveedorLogoUrl: env.DEMO_PROVEEDOR_LOGO_URL?.trim() || null,
    producto: primero.nombre,
    unidad: primero.unidad,
    unidadPlural: primero.unidadPlural,
    precioSolo: primero.precioSolo,
    tramos: primero.tramos,
    minutos: positivo(env.DEMO_MINUTOS, 5),
    whatsappNumero: env.DEMO_WHATSAPP_NUMERO?.replace(/\D/g, '') || null,
    precioPiso,
    ficticios,
    competencia: ficticios && env.DEMO_COMPETENCIA?.trim() !== '0',
  };
}
