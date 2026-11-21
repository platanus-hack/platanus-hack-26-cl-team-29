import type { Documento, Item, Negocio, OrdenCompra } from './tipos.ts';

// Lo que la red necesita del SII. Cuando exista server/sii/, se escribe un adaptador
// de esta interfaz sobre esa (los RUT salen de variables de entorno allá, nunca de aquí).
// Cada método tiene efecto legal: el dominio lo llama solo después de una confirmación
// explícita de la persona (confirmar la orden, informar la recepción, aceptar la nota).

export interface ResultadoSii {
  folio: number;
  trackId: string;
  estadoSii: string;
}

export interface DatosEmision {
  orden: OrdenCompra;
  emisor: Negocio;
  receptor: Negocio;
}

export interface PuertoSii {
  /** Factura electrónica (33) con referencia a la orden de compra. */
  emitirFactura(datos: DatosEmision): Promise<ResultadoSii>;
  /** Guía de despacho (52) de la misma orden. */
  emitirGuia(datos: DatosEmision): Promise<ResultadoSii>;
  /** Nota de crédito (61) que corrige parcialmente la factura por los ítems faltantes. */
  emitirNotaCredito(datos: DatosEmision & { factura: Documento; items: Item[] }): Promise<ResultadoSii>;
  /** Reclamo del receptor sobre la factura (contenido o falta parcial de mercaderías). */
  registrarReclamo(datos: { factura: Documento; receptor: Negocio; motivo: string }): Promise<{ estadoSii: string }>;
}

/**
 * SII simulado: folios correlativos por tipo, sin red. Se usa cuando no hay SII real.
 * `ultimos` permite seguir la numeración de los documentos ya guardados tras un reinicio.
 */
export function crearSiiFalso(ultimos: Documento[] = []): PuertoSii {
  const folios: Record<number, number> = { 33: 1000, 52: 2000, 61: 3000 };
  for (const d of ultimos) folios[d.tipo] = Math.max(folios[d.tipo], d.folio);
  const resultado = (tipo: number): ResultadoSii => {
    folios[tipo]++;
    return { folio: folios[tipo], trackId: `SIM-${tipo}-${folios[tipo]}`, estadoSii: 'simulado' };
  };
  return {
    emitirFactura: async () => resultado(33),
    emitirGuia: async () => resultado(52),
    emitirNotaCredito: async () => resultado(61),
    registrarReclamo: async () => ({ estadoSii: 'simulado' }),
  };
}
