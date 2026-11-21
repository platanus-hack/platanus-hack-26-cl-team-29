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
