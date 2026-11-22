// Lo que el agente necesita del dominio de la red (server/red/). Refleja las funciones
// del contrato (docs/decisiones/20261121-1130-contrato-red.md). Acepta implementaciones
// sincrónicas o asíncronas: el agente siempre hace await.

type Talvez<T> = T | Promise<T>;

export interface Negocio {
  readonly id: string;
  readonly nombre: string;
  readonly comuna: string;
  readonly rol: 'comprador' | 'proveedor';
  /** Se registró como proveedor por WhatsApp: vende y también compra. */
  readonly vende?: boolean;
  readonly telefono: string;
  /** RUT del comprador, si ya lo dio. Solo interno. */
  readonly rut?: string;
}

export interface ItemOrden {
  readonly producto: string;
  /** En la compra conjunta: a qué producto de la canasta corresponde la línea. */
  readonly productoId?: string;
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
  /** Las compras en grupo (puede haber varias abiertas). */
  readonly licitaciones?: readonly LicitacionSala[];
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
  /** El producto del catálogo con precio que nombra el texto ("sacos de harina" → "Harina 25 kg"), o undefined. */
  productoConPrecio?(texto: string): string | undefined;
  /** Fija la cantidad de un producto en el carrito de un negocio en una compra en grupo (0 lo quita). */
  agregarAlCarrito?(licitacionId: string, item: { readonly negocioId: string; readonly productoId: string; readonly cantidad: number }): Talvez<unknown>;
  /** Un comprador abre una compra en grupo de un producto. */
  abrirSolicitud?(s: { readonly compradorId: string; readonly producto: string; readonly unidad: string; readonly cantidad: number }): Talvez<{ readonly id: string; readonly cierraEn: string }>;
  /** Quien abrió una compra en grupo la cierra antes de su hora (si ya hay oferta y llegó al pedido mínimo). */
  cerrarAntes?(licitacionId: string, negocioId: string): Talvez<readonly OrdenCompra[]>;
}

// Compra conjunta de la sala ("la sala compra junta"). El público se suma por WhatsApp,
// el precio baja por tramos de volumen y al cierre el proveedor factura todo de una vez.

export interface Tramo {
  readonly desde: number;
  readonly precioUnitario: number;
}

/** Una línea del carrito de un participante. */
export interface ItemCarrito {
  readonly productoId: string;
  readonly cantidad: number;
}

/** Un producto de la canasta, con su precio por volumen ya calculado por la red. */
export interface ProductoCompra {
  readonly id: string;
  readonly nombre: string;
  readonly unidad: string;
  readonly unidadPlural?: string;
  readonly precioSolo: number;
  readonly tramos: readonly Tramo[];
  /** Ofertas de proveedores por este producto. */
  readonly ofertas?: readonly {
    readonly proveedorId: string; readonly precioUnitario: number; readonly tramos?: readonly Tramo[]; readonly minimo?: number; readonly pendienteSii?: true;
  }[];
  /** Quien creó el producto (sus tramos son su precio por volumen). */
  readonly proveedorId?: string;
  readonly totalUnidades: number;
  readonly precioActual: number;
  readonly siguienteTramo: { readonly desde: number; readonly precioUnitario: number; readonly faltan: number } | null;
}

export interface ParticipanteSala {
  readonly nombre: string;
  /** Suma de `items` (compatibilidad con la compra de un solo producto). */
  readonly cantidad: number;
  /** El carrito; si falta, es `cantidad` del único producto. */
  readonly items?: readonly ItemCarrito[];
  /** La red no lo expone hacia afuera; el agente lo resuelve con `telefonoDeNegocio(negocioId)`. */
  readonly telefono?: string;
  readonly negocioId?: string;
}

export interface LicitacionSala {
  readonly id: string;
  /** La canasta. Si falta (red antigua), hay un solo producto: los campos de abajo. */
  readonly productos?: readonly ProductoCompra[];
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
  /** El comprador que la abrió: solo él la puede cerrar antes. */
  readonly iniciadaPor?: string;
}

export interface UnionLicitacion {
  readonly licitacion: LicitacionSala;
  readonly participante: ParticipanteSala;
  readonly precioActual: number;
  readonly bajoDePrecio: boolean;
}

export interface ResultadoCarrito {
  readonly licitacion: LicitacionSala;
  /** null si el carrito quedó vacío (salió de la compra). */
  readonly participante: ParticipanteSala | null;
}

export interface EventoDeLaRed {
  readonly tipo: string;
  readonly datos: unknown;
}

export interface RedSala {
  licitacionAbierta(): Talvez<LicitacionSala | null>;
  /** Una compra por id (abierta o no), o null. Para quien nombra una compra en su mensaje (el texto del QR). */
  licitacionPorId?(id: string): Talvez<LicitacionSala | null>;
  /** El mismo teléfono otra vez actualiza la cantidad. La red valida que sea un entero positivo. */
  unirseALicitacion(licitacionId: string, datos: {
    readonly telefono: string;
    readonly nombre: string;
    readonly comuna?: string;
    readonly cantidad: number;
  }): Talvez<UnionLicitacion>;
  /** Reemplaza el carrito completo; cantidad 0 quita el item y carrito vacío = sale. Si falta, se usa `unirseALicitacion`. */
  actualizarCarrito?(licitacionId: string, datos: {
    readonly telefono: string;
    readonly nombre?: string;
    /** RUT del comprador (ya consultado con `consultarRut`): su factura sale a ese RUT. */
    readonly rut?: string;
    /** Dirección para la factura, confirmada o escrita por la persona. */
    readonly direccionFactura?: { readonly direccion: string; readonly comuna: string };
    readonly items: readonly ItemCarrito[];
  }): Talvez<ResultadoCarrito>;
  /**
   * Valida el RUT y lo consulta en el SII (una vez por RUT). Si la red lo ofrece, nadie se suma sin RUT. Falla con
   * un error con `codigo` (`datos_invalidos`, `sii_no_disponible`) y un `message` para mostrar tal cual. Con el
   * `telefono` de quien escribe, rechaza un RUT que ya registró otro teléfono (sin mostrar sus datos).
   */
  consultarRut?(rut: string, telefono?: string): Talvez<{
    readonly rut: string;
    readonly razonSocial: string;
    /** Dirección y comuna del SII, si las tiene. `simulado`: datos de prueba, no se ofrecen como reales. */
    readonly direccion?: string;
    readonly comuna?: string;
    readonly simulado?: boolean;
  }>;
  salirDeLicitacion?(licitacionId: string, datos: { readonly telefono: string }): Talvez<unknown>;
  /** Emite `licitacion.cerrada` con las órdenes; el agente usa el evento, no el valor devuelto. */
  cerrarLicitacion(licitacionId: string): Talvez<unknown>;
  /** Cierra todas las compras abiertas que ya vencieron (puede haber varias). */
  cerrarVencidas?(): Talvez<unknown>;
  /** Emite las facturas (33) de las órdenes de un proveedor (sin él, de todos) en un envío al SII por proveedor. */
  confirmarOrdenesDeLicitacion(licitacionId: string, proveedorId?: string): Talvez<readonly Documento[]>;
  telefonoDeNegocio(negocioId: string): Talvez<string | null>;
  /** Enlace privado al PDF de un documento emitido, si la red lo ofrece. */
  enlacePdf?(documento: Documento): Talvez<string | null>;
  escuchar(oyente: (evento: EventoDeLaRed) => void): () => void;
}

/** Lo que necesitan los proveedores que se registran y venden por WhatsApp (server/agente/proveedor.ts). */
export interface RedProveedores {
  /** Falla con `codigo` y un `message` para mostrar tal cual (RUT inválido, de otro teléfono...). */
  registrarProveedor(datos: { readonly telefono: string; readonly rut: string; readonly nombre?: string }): Talvez<Negocio>;
  ofertar(licitacionId: string, oferta: {
    readonly proveedorId: string; readonly productoId: string; readonly precioUnitario: number; readonly plazoDias: number;
  }): Talvez<LicitacionSala>;
  crearProducto(licitacionId: string, producto: {
    readonly proveedorId: string; readonly nombre: string; readonly unidad: string; readonly precio: number;
  }): Talvez<{ readonly producto: ProductoCompra }>;
}

export function tieneProveedores(red: object): red is RedProveedores {
  const r = red as Partial<Record<keyof RedProveedores, unknown>>;
  return typeof r.registrarProveedor === 'function' && typeof r.ofertar === 'function' && typeof r.crearProducto === 'function';
}

/** La red real expone la compra conjunta desde cierta versión; sin ella el agente sigue con los flujos de siempre. */
export function tieneSala(red: object): red is RedSala {
  const r = red as Partial<Record<keyof RedSala, unknown>>;
  return typeof r.licitacionAbierta === 'function' && typeof r.confirmarOrdenesDeLicitacion === 'function'
    && typeof r.unirseALicitacion === 'function' && typeof r.escuchar === 'function'
    && typeof r.telefonoDeNegocio === 'function';
}
