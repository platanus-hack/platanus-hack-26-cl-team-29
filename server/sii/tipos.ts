// Tipos públicos del módulo. Hablan de documentos y empresas, no de XML: el XML queda dentro de server/sii/.

export interface Emisor {
  readonly rut: string;
  readonly razonSocial: string;
  readonly giro: string;
  /** Código de actividad económica del SII. */
  readonly acteco: number;
  readonly direccion: string;
  readonly comuna: string;
  readonly ciudad?: string;
}

export interface Receptor {
  readonly rut: string;
  readonly razonSocial: string;
  /** Máximo 40 caracteres (XSD). */
  readonly giro: string;
  readonly direccion: string;
  readonly comuna: string;
  readonly ciudad?: string;
}

export interface Item {
  readonly nombre: string;
  readonly cantidad: number;
  /** Precio unitario NETO (sin IVA). La línea es `round(cantidad x precio)`. */
  readonly precioUnitario: number;
  /** Unidad de medida, máximo 4 caracteres (`UN`, `KG`). */
  readonly unidad?: string;
}

/** Orden de compra del cliente: va como `Referencia` con `TpoDocRef` 801. */
export interface OrdenCompra {
  /** Identificador de la OC, alfanumérico de hasta 18 caracteres. */
  readonly folio: string;
  /** `AAAA-MM-DD`. */
  readonly fecha: string;
}

export interface DocumentoReferido {
  readonly folio: number;
  readonly fecha: string;
}

interface EntradaDocumento {
  /** Folio dentro del rango del CAF. Quien llama lleva la cuenta de los folios usados. */
  readonly folio: number;
  /** `AAAA-MM-DD`; por defecto hoy en Chile. */
  readonly fechaEmision?: string;
  readonly receptor: Receptor;
  readonly items: readonly Item[];
}

export interface EntradaFactura extends EntradaDocumento {
  readonly ordenCompra?: OrdenCompra;
  /** Guías de despacho (52) que esta factura cubre. */
  readonly guias?: readonly DocumentoReferido[];
}

/** Motivo del traslado (`IndTraslado`): 1 venta, 2 venta por efectuar, 3 consignación, 5 traslado interno, etc. */
export type MotivoTraslado = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface EntradaGuia extends EntradaDocumento {
  readonly motivoTraslado: MotivoTraslado;
  readonly ordenCompra?: OrdenCompra;
}

/** Nota de crédito que corrige montos (`CodRef` 3) de una factura 33, por ejemplo por una entrega parcial. */
export interface EntradaNotaCredito extends EntradaDocumento {
  readonly factura: DocumentoReferido;
  /** Por defecto "Falta parcial de mercaderia". */
  readonly razon?: string;
}

export interface DocumentoEmitido {
  readonly tipo: number;
  readonly folio: number;
  readonly fechaEmision: string;
  readonly rutEmisor: string;
  readonly rutReceptor: string;
  readonly montoNeto: number;
  readonly iva: number;
  readonly montoTotal: number;
  /** Lo necesario para la representación impresa (PDF), con el TED exacto del documento. */
  readonly impreso: DocumentoImpreso;
}

export interface LineaImpresa {
  readonly nombre: string;
  readonly cantidad: number;
  readonly unidad?: string;
  readonly precioUnitario: number;
  readonly monto: number;
}

export interface ReferenciaImpresa {
  /** 801 orden de compra, 33 factura, 52 guía de despacho. */
  readonly tipoDocumento: number | string;
  readonly folio: string;
  readonly fecha: string;
  /** `CodRef`: 1 anula, 2 corrige texto, 3 corrige montos. */
  readonly codigo?: number;
  readonly razon?: string;
}

/**
 * Datos de la representación impresa de un DTE: solo JSON, para guardarlos junto al documento y volver a
 * dibujar el PDF cuando se pida. `ted` es el `<TED>` tal cual va en el XML; el PDF417 codifica esos bytes.
 */
export interface DocumentoImpreso {
  readonly tipo: 33 | 52 | 61;
  readonly folio: number;
  readonly fechaEmision: string;
  readonly emisor: Emisor;
  readonly receptor: Receptor;
  readonly lineas: readonly LineaImpresa[];
  readonly referencias: readonly ReferenciaImpresa[];
  readonly neto: number;
  readonly tasaIva: number;
  readonly iva: number;
  readonly total: number;
  /** Solo guía (52): `IndTraslado`. */
  readonly indTraslado?: number;
  readonly ted: string;
  /** Resolución que autoriza al emisor; en certificación el número es 0. */
  readonly resolucion: { readonly numero: number; readonly fecha: string };
  /** Unidad del SII del emisor (por defecto SANTIAGO). */
  readonly oficinaSii?: string;
  /** Lo emitió la implementación falsa: el timbre no vale ante el SII. */
  readonly simulado: boolean;
}

/**
 * Resultado de subir un sobre. `recibido` solo dice que el SII lo recibió, no que lo aceptó: el veredicto sale de
 * `estadoEnvio`. `incierto` es un corte de red: el sobre pudo llegar o no, y NUNCA se reenvía sin antes consultar
 * `estadoDocumento` (FAU = no llegó, se puede volver a emitir con el mismo folio).
 */
export type ResultadoEnvio =
  | { readonly estado: 'recibido'; readonly trackId: string; readonly respuesta: string }
  | { readonly estado: 'rechazado'; readonly status: string; readonly respuesta: string }
  | { readonly estado: 'incierto'; readonly error: string };

export interface ResultadoEmision {
  readonly documento: DocumentoEmitido;
  readonly envio: ResultadoEnvio;
  /** Sobre firmado tal como se subió, para guardarlo. */
  readonly sobreXml: string;
}

/** Resultado de subir varios documentos en un solo sobre: `documentos` va en el mismo orden de la entrada. */
export interface ResultadoLote {
  readonly documentos: readonly DocumentoEmitido[];
  readonly envio: ResultadoEnvio;
  readonly sobreXml: string;
}

export interface ConteoPorTipo {
  readonly tipo: number;
  readonly informados: number;
  readonly aceptados: number;
  readonly rechazados: number;
  readonly reparos: number;
}

/** Estado de un envío (QueryEstUp). `EPR` = procesado: el detalle está en `porTipo`. `RCT`, `RFR`, `RSC` = rechazado. */
export interface EstadoEnvio {
  readonly trackId: string;
  readonly codigo: string;
  readonly glosa: string | null;
  readonly porTipo: readonly ConteoPorTipo[];
  /** Respuesta del SII completa, sin recortar. */
  readonly respuesta: string;
}

export interface ConsultaDocumento {
  readonly tipo: number;
  readonly folio: number;
  readonly fechaEmision: string;
  readonly montoTotal: number;
  readonly rutReceptor: string;
}

/** Estado de un documento (QueryEstDte): `DOK` recibido y coincide, `FAU` no recibido, `DNK` datos no coinciden. */
export interface EstadoDocumento {
  readonly codigo: string;
  readonly glosa: string | null;
  readonly codigoError: string | null;
  readonly glosaError: string | null;
  readonly respuesta: string;
}

/** ACD acepta, ERM acusa recibo de mercaderías, RCD reclama el contenido, RFP falta parcial, RFT falta total. */
export type AccionReceptor = 'ACD' | 'ERM' | 'RCD' | 'RFP' | 'RFT';

/** Documento recibido sobre el que actúa el receptor. Solo 33, 34 y 43 admiten aceptación o reclamo. */
export interface DocumentoRecibido {
  readonly rutEmisor: string;
  readonly tipo: number;
  readonly folio: number;
}

export type ResultadoReclamo =
  | 'ok'
  | 'ya_registrado'
  | 'fuera_de_plazo'
  | 'previamente_aceptado'
  | 'no_autorizado'
  | 'sin_eventos'
  | 'no_recibido'
  | 'error_sii'
  | 'rechazado';

export interface RespuestaReclamo {
  readonly codigo: number;
  /** Texto literal del SII. */
  readonly descripcion: string;
  readonly resultado: ResultadoReclamo;
}

export interface EventoReceptor {
  readonly codigo: string;
  readonly descripcion: string;
  readonly rutResponsable: string;
  readonly fecha: string;
}

export interface EventosDocumento extends RespuestaReclamo {
  readonly eventos: readonly EventoReceptor[];
}

export type Log = Pick<Console, 'info' | 'warn' | 'error'>;
