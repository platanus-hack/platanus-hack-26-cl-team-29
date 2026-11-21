// Lo que el agente necesita del dominio de la red (server/red/). Refleja las funciones
// del contrato (docs/decisiones/20261121-1130-contrato-red.md). Acepta implementaciones
// sincrónicas o asíncronas: el agente siempre hace await.

type Talvez<T> = T | Promise<T>;

export interface Negocio {
  readonly id: string;
  readonly nombre: string;
  readonly comuna: string;
  readonly rol: 'comprador' | 'proveedor';
  readonly telefono: string;
}

export interface ItemOrden {
  readonly producto: string;
  readonly cantidad: number;
  readonly precioUnitario: number;
  /** Lo que dice la guía de despacho (52). Si falta, se asume igual a `cantidad`. */
  readonly cantidadDespachada?: number;
}

export type EstadoOrden = 'enviada' | 'confirmada' | 'facturada' | 'recibida' | 'reclamada' | 'corregida';

export interface OrdenCompra {
  readonly id: string;
  readonly compradorId: string;
  readonly proveedorId: string;
  readonly items: readonly ItemOrden[];
  readonly estado: EstadoOrden;
  readonly creadaEn: string;
}

export interface Documento {
  readonly id: string;
  readonly ordenId: string;
  readonly tipo: 33 | 52 | 61;
  readonly folio: number;
  readonly trackId: string;
  readonly estadoSii: string;
}

export interface EstadoRed {
  readonly negocios: readonly Negocio[];
  readonly ordenes: readonly OrdenCompra[];
}

export type Recepcion = { readonly conforme: true } | { readonly faltante: number };

export interface Red {
  negocioPorTelefono(telefono: string): Talvez<Negocio | null>;
  estadoDeLaRed(): Talvez<EstadoRed>;
  notaDeProveedor(proveedorId: string): Talvez<number>;
  /** El dominio pone el precio unitario según el proveedor. */
  crearOrden(datos: {
    readonly compradorId: string;
    readonly proveedorId: string;
    readonly items: readonly { readonly producto: string; readonly cantidad: number }[];
  }): Talvez<OrdenCompra>;
  /** Emite la factura (33) con la OC y la guía (52). */
  confirmarOrden(ordenId: string): Talvez<OrdenCompra>;
  /** Con faltante, registra el reclamo en el SII. */
  registrarRecepcion(ordenId: string, recepcion: Recepcion): Talvez<OrdenCompra>;
  /** Nota de crédito (61) por lo faltante, amarrada a la factura original. */
  emitirNotaCredito(ordenId: string): Talvez<Documento>;
}

// Compra conjunta de la sala ("la sala compra junta"). El público se suma por WhatsApp,
// el precio baja por tramos de volumen y al cierre el proveedor factura todo de una vez.

export interface Tramo {
  readonly desde: number;
  readonly precioUnitario: number;
}

export interface ParticipanteSala {
  readonly nombre: string;
  readonly cantidad: number;
  /** La red no lo expone hacia afuera; el agente lo resuelve con `telefonoDeNegocio(negocioId)`. */
  readonly telefono?: string;
  readonly negocioId?: string;
}

export interface LicitacionSala {
  readonly id: string;
  readonly producto: string;
  /** En singular: "caja". */
  readonly unidad: string;
  /** "cajas". Si falta, el agente lo deriva de `unidad`. */
  readonly unidadPlural?: string;
  /** Proveedor único de la compra conjunta; si falta, se usa el de las órdenes al cerrar. */
  readonly proveedorId?: string;
  readonly precioSolo: number;
  readonly tramos: readonly Tramo[];
  readonly participantes: readonly ParticipanteSala[];
  readonly totalUnidades: number;
  readonly precioActual: number;
  readonly siguienteTramo: { readonly desde: number; readonly precioUnitario: number; readonly faltan: number } | null;
  readonly cierraEn: string;
  readonly estado: string;
}

export interface UnionLicitacion {
  readonly licitacion: LicitacionSala;
  readonly participante: ParticipanteSala;
  readonly precioActual: number;
  readonly bajoDePrecio: boolean;
}

export interface EventoDeLaRed {
  readonly tipo: string;
  readonly datos: unknown;
}

export interface RedSala {
  licitacionAbierta(): Talvez<LicitacionSala | null>;
  /** El mismo teléfono otra vez actualiza la cantidad. La red valida el rango (hoy 1 a 20). */
  unirseALicitacion(licitacionId: string, datos: {
    readonly telefono: string;
    readonly nombre: string;
    readonly comuna?: string;
    readonly cantidad: number;
  }): Talvez<UnionLicitacion>;
  /** Emite `licitacion.cerrada` con las órdenes; el agente usa el evento, no el valor devuelto. */
  cerrarLicitacion(licitacionId: string): Talvez<unknown>;
  /** Emite las facturas (33) de todas las órdenes de la compra en un solo envío al SII. */
  confirmarOrdenesDeLicitacion(licitacionId: string): Talvez<readonly Documento[]>;
  telefonoDeNegocio(negocioId: string): Talvez<string | null>;
  escuchar(oyente: (evento: EventoDeLaRed) => void): () => void;
}

/** La red real expone la compra conjunta desde cierta versión; sin ella el agente sigue con los flujos de siempre. */
export function tieneSala(red: object): red is RedSala {
  const r = red as Partial<Record<keyof RedSala, unknown>>;
  return typeof r.licitacionAbierta === 'function' && typeof r.confirmarOrdenesDeLicitacion === 'function'
    && typeof r.unirseALicitacion === 'function' && typeof r.escuchar === 'function'
    && typeof r.telefonoDeNegocio === 'function';
}
