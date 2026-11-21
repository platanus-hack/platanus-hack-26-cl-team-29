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
  nombre: string;
  comuna?: string;
  cantidad: number;
}

export interface Oferta {
  proveedorId: string;
  precioUnitario: number;
  plazoDias: number;
}

export interface Ganadora extends Oferta {
  nota: number;
  precioAjustado: number;
}

export interface Licitacion {
  id: string;
  producto: string;
  comuna: string;
  cierraEn: string;
  participantes: Participante[];
  ofertas: Oferta[];
  estado: 'abierta' | 'cerrada';
  ganadora?: Ganadora;
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
  licitaciones: Licitacion[];
}

export type TipoEventoRed =
  | 'orden.creada'
  | 'orden.confirmada'
  | 'documento.emitido'
  | 'recepcion.registrada'
  | 'reclamo.registrado'
  | 'nota_credito.emitida'
  | 'nota.cambiada'
  | 'licitacion.participante'
  | 'licitacion.oferta'
  | 'licitacion.cerrada';

/** Lo que viaja en `red:evento` por Socket.io. */
export interface EventoRed {
  tipo: TipoEventoRed;
  datos: unknown;
  en: string;
}
