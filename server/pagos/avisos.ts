// Textos de WhatsApp del crédito Bando. Cortos, con el monto por `dinero()` y la fecha como la lee una persona.
import { fechaCorta } from '../../shared/fecha.ts';
import { dinero } from '../../shared/formato.ts';

interface Datos {
  monto: number;
  proveedor: string;
  venceEn: string;
  plazoDias: number;
  /** "Visa terminada en 6623", o null sin tarjeta. */
  tarjeta: string | null;
}

export const textoTarjeta = (t: { marca: string; ultimos4: string } | null): string | null => (t ? `${t.marca} terminada en ${t.ultimos4}` : null);

export const faltaTarjeta = (enlace: string): string =>
  `Para comprar con Bando inscribe tu tarjeta una vez. Bando le paga al proveedor al tiro y tú pagas a 30 días, sin trámites.\n\nSe inscribe en Transbank (Bando nunca ve el número): ${enlace}\n\nCuando esté lista, vuelve a mandar tu pedido.`;

export const creditoOtorgado = (d: Datos): string => d.plazoDias
  ? `Bando ya le pagó ${dinero(d.monto)} a ${d.proveedor}. Tú pagas el ${fechaCorta(d.venceEn)}${d.tarjeta ? `, solo, con tu ${d.tarjeta}` : ''}.`
  : `Bando ya le pagó ${dinero(d.monto)} a ${d.proveedor}. Esta compra supera tu cupo disponible, así que se cobra hoy${d.tarjeta ? ` en tu ${d.tarjeta}` : ''}.`;

export const recordatorio = (d: Datos): string =>
  `El ${fechaCorta(d.venceEn)} cobramos ${dinero(d.monto)} de tu compra a ${d.proveedor}${d.tarjeta ? ` en tu ${d.tarjeta}` : ''}. No tienes que hacer nada.`;

export const cobrado = (d: Datos & { disponible: number; subioA: string | null }): string =>
  `Listo: cobramos ${dinero(d.monto)} de tu compra a ${d.proveedor}${d.tarjeta ? ` en tu ${d.tarjeta}` : ''}. Cupo disponible: ${dinero(d.disponible)}.${d.subioA ? ` Subiste a ${d.subioA}: más cupo y más plazo.` : ''}`;

export const cobroFallido = (d: Datos, enlace: string): string =>
  `No pudimos cobrar ${dinero(d.monto)} de tu compra a ${d.proveedor}. Lo intentamos de nuevo mañana. Si cambiaste de tarjeta, inscribe la nueva: ${enlace}`;

export const pagoAlProveedor = (d: { monto: number; folio: number | null }): string =>
  `Bando te pagó ${dinero(d.monto)}${d.folio ? ` por la factura folio ${d.folio}` : ''}. No esperas los 30 días: el plazo del comprador lo asume Bando.`;
