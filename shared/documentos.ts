// Documentos tributarios de la red (factura 33, guía de despacho 52, nota de crédito 61): un solo nombre para
// cada tipo en la web, WhatsApp, los PDF y los logs.

export type TipoDocumento = 33 | 52 | 61;

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [33, 52, 61];

export const esTipoDocumento = (tipo: unknown): tipo is TipoDocumento => (TIPOS_DOCUMENTO as readonly unknown[]).includes(tipo);

const NOMBRES: Record<number, string> = { 33: 'Factura', 52: 'Guía de despacho', 61: 'Nota de crédito', 801: 'Orden de compra' };

/** "Factura", "Guía de despacho", "Nota de crédito" (y "Orden de compra" para la referencia 801). */
export const nombreDocumento = (tipo: number): string => NOMBRES[tipo] ?? `Documento tipo ${tipo}`;

/** "factura", "guía de despacho": para ir dentro de una frase. */
export const nombreEnFrase = (tipo: number): string => nombreDocumento(tipo).toLowerCase();

/** "Factura electrónica"; la orden de compra (801) no es electrónica. */
export const nombreElectronico = (tipo: number): string =>
  tipo in NOMBRES && tipo !== 801 ? `${nombreDocumento(tipo)} electrónica` : nombreDocumento(tipo);
