import type { Tramo } from './tipos.ts';

// Configuración de "la sala compra junta". El proveedor es una empresa real: su nombre, comuna y
// WhatsApp llegan solo por variables de entorno, nunca en el código. Los valores por defecto son genéricos.

export interface ConfigDemo {
  proveedor: { nombre: string; comuna: string; telefono: string };
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
}

/** Cantidad máxima por participante en la compra conjunta. */
export const CANTIDAD_MAXIMA = 20;

const TRAMOS: Tramo[] = [
  { desde: 1, precioUnitario: 32000 },
  { desde: 10, precioUnitario: 29900 },
  { desde: 25, precioUnitario: 27900 },
  { desde: 50, precioUnitario: 25900 },
  { desde: 100, precioUnitario: 24500 },
];

/** `DEMO_TRAMOS` en JSON (`[{ "desde": 1, "precioUnitario": 32000 }, ...]`). Si no es válido, se usa el de defecto. */
function leerTramos(texto: string | undefined): Tramo[] {
  if (!texto) return TRAMOS;
  try {
    const lista: unknown = JSON.parse(texto);
    if (!Array.isArray(lista) || lista.length === 0) throw new Error('debe ser una lista no vacía');
    const tramos = lista.map((t: { desde?: unknown; precioUnitario?: unknown }) => {
      const desde = Number(t?.desde), precioUnitario = Number(t?.precioUnitario);
      if (!Number.isInteger(desde) || desde < 1 || !(precioUnitario > 0)) throw new Error('cada tramo necesita desde >= 1 y precioUnitario > 0');
      return { desde, precioUnitario };
    });
    return tramos.sort((a, b) => a.desde - b.desde);
  } catch (error) {
    console.warn(`[red] DEMO_TRAMOS no es válido (${error instanceof Error ? error.message : error}); se usan los tramos por defecto`);
    return TRAMOS;
  }
}

const positivo = (texto: string | undefined, porDefecto: number) => {
  const n = Number(texto);
  return texto && n > 0 ? n : porDefecto;
};

export function configDemo(env: NodeJS.ProcessEnv = process.env): ConfigDemo {
  const unidad = env.DEMO_UNIDAD?.trim() || 'caja';
  const tramos = leerTramos(env.DEMO_TRAMOS);
  return {
    proveedor: {
      nombre: env.DEMO_PROVEEDOR_NOMBRE?.trim() || 'Proveedor de la demo',
      comuna: env.DEMO_PROVEEDOR_COMUNA?.trim() || 'Santiago',
      telefono: env.DEMO_TELEFONO_PROVEEDOR?.trim() || '',
    },
    producto: env.DEMO_PRODUCTO?.trim() || 'Caja de rollos térmicos 80 mm (50 un.)',
    unidad,
    unidadPlural: env.DEMO_UNIDAD_PLURAL?.trim() || (env.DEMO_UNIDAD ? `${unidad}s` : 'cajas'),
    precioSolo: positivo(env.DEMO_PRECIO_SOLO, 32000),
    tramos,
    minutos: positivo(env.DEMO_MINUTOS, 5),
    whatsappNumero: env.DEMO_WHATSAPP_NUMERO?.replace(/\D/g, '') || null,
  };
}
