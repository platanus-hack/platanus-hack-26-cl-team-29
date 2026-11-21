// Tipos de la red, copia local del contrato (docs/decisiones/20261121-1130-contrato-red.md).
// El front no importa código del backend: si el contrato cambia, se actualiza aquí.

export type Rol = 'comprador' | 'proveedor';

export interface Negocio {
  id: string;
  nombre: string;
  comuna: string;
  rol: Rol;
}

export interface ItemOrden {
  producto: string;
  cantidad: number;
  precioUnitario: number;
}

export type EstadoOrden = 'enviada' | 'confirmada' | 'facturada' | 'recibida' | 'reclamada' | 'corregida';

export interface OrdenCompra {
  id: string;
  compradorId: string;
  proveedorId: string;
  items: ItemOrden[];
  estado: EstadoOrden;
  creadaEn: string;
  /** Presente desde `reclamada`. */
  reclamo?: { producto: string; faltante: number; en: string; estadoSii: string };
}

export type TipoDocumento = 33 | 52 | 61;

export interface Documento {
  id: string;
  ordenId: string;
  tipo: TipoDocumento;
  folio: number | null;
  trackId: string | null;
  estadoSii: string | null;
  /** Monto neto. */
  monto?: number;
  emitidoEn?: string;
}

export interface NotaProveedor {
  proveedorId: string;
  nota: number;
}

export interface Participante {
  negocioId?: string;
  nombre?: string;
  comuna?: string;
  cantidad: number;
  en?: string;
}

export interface Oferta {
  proveedorId: string;
  precioUnitario: number;
  plazoDias: number;
  en?: string;
  /** Proveedores que compiten en la sala: el nombre y la nota vienen con la oferta. */
  proveedorNombre?: string;
  nota?: number;
}

/** Oferta ganadora al cerrar: la de menor precio ajustado por nota y plazo. */
export interface Ganadora extends Oferta {
  nota: number;
  precioAjustado: number;
}

/** Desde `desde` unidades en el grupo, todos pagan `precioUnitario`. */
export interface Tramo {
  desde: number;
  precioUnitario: number;
}

export interface SiguienteTramo extends Tramo {
  faltan: number;
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
  /** Precio por unidad que paga un negocio comprando solo. Opcional: si falta, se usa la oferta más cara. */
  precioSolo?: number;
  /** Compra conjunta con un solo proveedor y precio por volumen. */
  proveedorId?: string;
  /** Cómo se cuenta el producto, en singular ("saco"). */
  unidad?: string;
  unidadPlural?: string;
  tramos?: Tramo[];
  /** Derivados que calcula el backend; si faltan, la pantalla los calcula desde `tramos`. */
  totalUnidades?: number;
  precioActual?: number;
  siguienteTramo?: SiguienteTramo | null;
  /** Órdenes creadas al cerrar, una por participante. */
  ordenIds?: string[];
}

/** GET /api/red/config: a qué número escribirle a Bando y qué se compra. */
export interface ConfigRed {
  whatsappNumero: string | null;
  producto?: string;
  unidad?: string;
  unidadPlural?: string;
}

export interface EstadoRed {
  negocios: Negocio[];
  ordenes: OrdenCompra[];
  documentos: Documento[];
  /** El backend la manda como { proveedorId: nota }; normalizarEstado la convierte a lista. */
  notas: NotaProveedor[];
  licitaciones: Licitacion[];
}

export type TipoEvento =
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

/**
 * Evento `red:evento` de Socket.io. `datos` según el contrato (entidades completas):
 * orden.creada/confirmada { orden }, documento.emitido { documento }, documento.actualizado { documento },
 * recepcion.registrada { orden, conforme, faltante? }, reclamo.registrado { orden, reclamo, motivo },
 * nota_credito.emitida { orden, documento }, nota.cambiada { proveedorId, anterior, nota },
 * licitacion.participante { licitacion, participante }, licitacion.oferta { licitacionId, oferta, mejor } (antes { licitacion, oferta, nota }),
 * licitacion.cerrada { licitacion, ordenes }, licitacion.precio_bajo { licitacionId, precioAnterior, precioNuevo, totalUnidades },
 * licitacion.facturada { licitacionId, documentos (cantidad), total, ahorroTotal }, red.reiniciada { foto completa, igual a GET /api/red/estado }. Se lee con cuidado por si falta algo.
 */
export interface EventoRed {
  tipo: TipoEvento;
  datos: Record<string, unknown>;
  en: string;
}

export type Fuente = 'cargando' | 'real' | 'falsa';
