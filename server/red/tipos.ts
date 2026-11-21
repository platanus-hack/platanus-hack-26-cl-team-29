// Entidades de la red de compras. Contrato: docs/decisiones/20261121-1130-contrato-red.md
// Las fechas van como texto ISO para que viajen igual por HTTP, Socket.io y jsonb.

export type Rol = 'comprador' | 'proveedor';

export interface Negocio {
  id: string;
  nombre: string;
  comuna: string;
  rol: Rol;
  telefono: string;
}

export interface Item {
  producto: string;
  cantidad: number;
  precioUnitario: number;
  /** Lo que dice la guía de despacho (52). Se fija al confirmar; antes puede faltar. */
  cantidadDespachada?: number;
}

export type EstadoOrden = 'enviada' | 'confirmada' | 'facturada' | 'recibida' | 'reclamada' | 'corregida';

export interface Reclamo {
  producto: string;
  faltante: number;
  en: string;
  estadoSii: string;
}

export interface OrdenCompra {
  id: string;
  compradorId: string;
  proveedorId: string;
  items: Item[];
  estado: EstadoOrden;
  creadaEn: string;
  reclamo?: Reclamo;
}

export type TipoDocumento = 33 | 52 | 61;

export interface Documento {
  id: string;
  ordenId: string;
  tipo: TipoDocumento;
  folio: number;
  trackId: string;
  estadoSii: string;
  monto: number;
  emitidoEn: string;
}

export type TipoEventoReputacion = 'entrega_conforme' | 'reclamo' | 'nota_credito_mismo_dia';

export interface EventoReputacion {
  id: string;
  proveedorId: string;
  ordenId: string;
  tipo: TipoEventoReputacion;
  en: string;
}

export interface Participante {
  negocioId?: string;
  /** Solo interno (WhatsApp): nunca sale en la foto pública ni en eventos. */
  telefono?: string;
  nombre: string;
  comuna?: string;
  cantidad: number;
  /** Cuándo se sumó (ISO). */
  en: string;
}

export interface Oferta {
  proveedorId: string;
  precioUnitario: number;
  plazoDias: number;
  /** Cuándo llegó (ISO). */
  en: string;
}

export interface Ganadora extends Oferta {
  nota: number;
  precioAjustado: number;
}

/** Desde cuántas unidades totales del grupo rige `precioUnitario`. */
export interface Tramo {
  desde: number;
  precioUnitario: number;
}

export interface SiguienteTramo extends Tramo {
  /** Unidades que le faltan al grupo para llegar a este tramo. */
  faltan: number;
}

export interface Licitacion {
  id: string;
  producto: string;
  /** Unidad de venta, singular y plural ("caja", "cajas"). */
  unidad: string;
  unidadPlural: string;
  comuna: string;
  cierraEn: string;
  /** Precio unitario que paga cada comprador si compra solo, para mostrar el ahorro del grupo. */
  precioSolo: number;
  participantes: Participante[];
  ofertas: Oferta[];
  estado: 'abierta' | 'cerrada';
  ganadora?: Ganadora;
  /** Compra conjunta: el proveedor único que vende a todo el grupo. Sin él, gana la mejor oferta (`ganadora`). */
  proveedorId?: string;
  /** Precio por volumen total del grupo, de menor a mayor `desde`. */
  tramos: Tramo[];
  /** Órdenes creadas al cerrar, una por participante. */
  ordenIds?: string[];
}

/** Licitación con lo que se deriva de sus participantes y tramos. */
export interface LicitacionVista extends Licitacion {
  totalUnidades: number;
  precioActual: number;
  siguienteTramo: SiguienteTramo | null;
}

/** Todo lo que se persiste, por colección. */
export interface DatosRed {
  negocios: Negocio[];
  ordenes: OrdenCompra[];
  documentos: Documento[];
  eventosReputacion: EventoReputacion[];
  licitaciones: Licitacion[];
}

export type Coleccion = keyof DatosRed;

/** Foto completa que pide la pantalla al conectarse (`GET /api/red/estado`). */
export interface EstadoRed {
  negocios: Negocio[];
  ordenes: OrdenCompra[];
  documentos: Documento[];
  notas: Record<string, number>;
  licitaciones: LicitacionVista[];
}

export type TipoEventoRed =
  | 'orden.creada'
  | 'orden.confirmada'
  | 'documento.emitido'
  | 'documento.actualizado'
  | 'recepcion.registrada'
  | 'reclamo.registrado'
  | 'nota_credito.emitida'
  | 'nota.cambiada'
  | 'licitacion.participante'
  | 'licitacion.oferta'
  | 'licitacion.cerrada'
  | 'licitacion.precio_bajo'
  | 'licitacion.facturada'
  | 'red.reiniciada';

/** Lo que viaja en `red:evento` por Socket.io. */
export interface EventoRed {
  tipo: TipoEventoRed;
  datos: unknown;
  en: string;
}
