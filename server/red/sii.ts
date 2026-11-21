import { fechaEnChile } from '../../shared/fecha.ts';
import { crearSiiEnMemoria, limpiarLatin1 } from '../sii/index.ts';
import type { DocumentoImpreso, Item as ItemSii, Receptor } from '../sii/index.ts';
import type { Documento, Item, Negocio, OrdenCompra, TipoDocumento } from './tipos.ts';

// Lo que la red necesita del SII. Cuando exista server/sii/, se escribe un adaptador
// de esta interfaz sobre esa (los RUT salen de variables de entorno allá, nunca de aquí).
// Cada método tiene efecto legal: el dominio lo llama solo después de una confirmación
// explícita de la persona (confirmar la orden, informar la recepción, aceptar la nota).

export interface ResultadoSii {
  folio: number;
  trackId: string;
  estadoSii: string;
  /** Datos de la representación impresa (PDF) con el TED, si el documento se armó en esta emisión. */
  impreso?: DocumentoImpreso;
}

export interface DatosEmision {
  orden: OrdenCompra;
  emisor: Negocio;
  receptor: Negocio;
}

export interface PuertoSii {
  /** Factura electrónica (33) con referencia a la orden de compra. */
  emitirFactura(datos: DatosEmision): Promise<ResultadoSii>;
  /**
   * Facturas (33) de varias órdenes en UN sobre (una sola subida), en el mismo orden de la entrada.
   * Es el cierre de la compra conjunta: una factura por participante.
   */
  emitirFacturas(datos: readonly DatosEmision[]): Promise<ResultadoSii[]>;
  /** Guía de despacho (52) de la misma orden, por `cantidadDespachada` de cada ítem (puede ser menos que lo pedido). */
  emitirGuia(datos: DatosEmision): Promise<ResultadoSii>;
  /** Nota de crédito (61) que corrige parcialmente la factura por los ítems faltantes. */
  emitirNotaCredito(datos: DatosEmision & { factura: Documento; items: Item[] }): Promise<ResultadoSii>;
  /** Reclamo del receptor sobre la factura (contenido o falta parcial de mercaderías). */
  registrarReclamo(datos: { factura: Documento; receptor: Negocio; motivo: string }): Promise<{ estadoSii: string }>;
  /** Opcional: avisa cuando el SII cambia el estado de un documento ya emitido (p. ej. su veredicto). */
  alCambiarEstado?(oyente: (cambio: CambioEstadoSii) => void): void;
}

export interface CambioEstadoSii {
  tipo: TipoDocumento;
  folio: number;
  estadoSii: string;
  /** Respuesta del SII que dio el veredicto, si la hay (por ejemplo, QueryEstUp con `ESTADO` RCT). */
  detalle?: string;
}

/** Largos del receptor en el XSD del DTE (server/sii/dte.ts rechaza uno más largo, no lo recorta). */
const LARGO_RECEPTOR = { razonSocial: 100, giro: 40, direccion: 70, comuna: 20 } as const;

/** Texto del SII listo para el XML: Latin-1, sin espacios repetidos y cortado al largo del campo. */
export function textoReceptor(texto: string, largo: number): string {
  return limpiarLatin1(texto.replace(/\s+/g, ' ')).slice(0, largo).trim();
}

/**
 * Receptor de la factura de un comprador: su RUT con su razón social, giro, dirección y comuna del SII, limpios
 * y cortados como exige el SII (giro a 40). null si el negocio no dio su RUT o sus datos son simulados (sin
 * consulta real al SII): entonces quien emite usa su receptor de respaldo.
 */
export function receptorDelComprador(n: Negocio): Receptor | null {
  const c = n.contribuyente;
  if (!n.rut || !c || c.simulado) return null;
  const campos = {
    razonSocial: textoReceptor(c.razonSocial, LARGO_RECEPTOR.razonSocial),
    giro: textoReceptor(c.giro, LARGO_RECEPTOR.giro),
    direccion: textoReceptor(c.direccion, LARGO_RECEPTOR.direccion),
    comuna: textoReceptor(c.comuna, LARGO_RECEPTOR.comuna),
  };
  // Un campo vacío lo rechaza el XSD: mejor el respaldo que un sobre rechazado.
  if (Object.values(campos).some(v => !v)) return null;
  return { rut: n.rut, ...campos };
}

/** RUT de ejemplo, sin dueño real, para el receptor del PDF simulado. */
const RUT_RECEPTOR_SIMULADO = '22222222-2';

/**
 * SII simulado: folios correlativos por tipo, sin red. Se usa cuando no hay SII real.
 * `ultimos` permite seguir la numeración de los documentos ya guardados tras un reinicio.
 * Cada documento trae su representación impresa con un timbre simulado (server/sii en memoria), con los
 * nombres de la red: así el PDF se puede mostrar en la demo, marcado como simulado.
 */
export function crearSiiFalso(ultimos: Documento[] = []): PuertoSii {
  const folios: Record<number, number> = { 33: 1000, 52: 2000, 61: 3000 };
  for (const d of ultimos) folios[d.tipo] = Math.max(folios[d.tipo], d.folio);
  const memoria = crearSiiEnMemoria();
  const resultado = (tipo: number): ResultadoSii => {
    folios[tipo]++;
    return { folio: folios[tipo], trackId: `SIM-${tipo}-${folios[tipo]}`, estadoSii: 'simulado' };
  };
  // El PDF simulado sale al RUT del comprador (con sus datos del SII si son reales); sin RUT, al de ejemplo.
  const receptor = (n: Negocio): Receptor => receptorDelComprador(n) ?? {
    rut: n.rut ?? RUT_RECEPTOR_SIMULADO, razonSocial: n.nombre, giro: 'Comercio', direccion: 'Sin informar', comuna: n.comuna || 'Santiago',
  };
  const items = (lista: readonly Item[], cantidad: (i: Item) => number): ItemSii[] =>
    lista.map(i => ({ nombre: i.producto, cantidad: cantidad(i), precioUnitario: i.precioUnitario, unidad: 'UN' })).filter(i => i.cantidad > 0);
  const ordenCompra = (o: OrdenCompra) => ({ folio: o.id, fecha: fechaEnChile(o.creadaEn) });

  /** El PDF es un extra: si no se puede armar, el documento se emite igual, sin representación impresa. */
  async function conImpreso(r: ResultadoSii, emisor: Negocio, armar: (folio: number) => Promise<{ documento: { impreso: DocumentoImpreso } }>) {
    try {
      const { impreso } = (await armar(r.folio)).documento;
      return { ...r, impreso: { ...impreso, emisor: { ...impreso.emisor, razonSocial: emisor.nombre, comuna: emisor.comuna || 'Santiago' } } };
    } catch (error) {
      console.warn(`[red] sin representación impresa para el folio ${r.folio}`, error);
      return r;
    }
  }

  const factura = ({ orden, emisor, receptor: comprador }: DatosEmision, r: ResultadoSii) =>
    conImpreso(r, emisor, folio => memoria.emitirFactura({
      folio, receptor: receptor(comprador), items: items(orden.items, i => i.cantidad), ordenCompra: ordenCompra(orden),
    }));

  return {
    emitirFactura: async datos => factura(datos, resultado(33)),
    // Un sobre: el mismo track id para todas.
    emitirFacturas: async datos => {
      const lote = datos.map(() => resultado(33));
      return Promise.all(lote.map((r, k) => factura(datos[k]!, { ...r, trackId: `SIM-LOTE-${lote[0]!.folio}` })));
    },
    emitirGuia: async ({ orden, emisor, receptor: comprador }) => conImpreso(resultado(52), emisor, folio => memoria.emitirGuia({
      folio, receptor: receptor(comprador), items: items(orden.items, i => i.cantidadDespachada ?? i.cantidad),
      motivoTraslado: 1, ordenCompra: ordenCompra(orden),
    })),
    emitirNotaCredito: async ({ emisor, receptor: comprador, factura: f, items: faltantes }) =>
      conImpreso(resultado(61), emisor, folio => memoria.emitirNotaCredito({
        folio, receptor: receptor(comprador), items: items(faltantes, i => i.cantidad), factura: { folio: f.folio, fecha: fechaEnChile(f.emitidoEn) },
      })),
    registrarReclamo: async () => ({ estadoSii: 'simulado' }),
  };
}
