// Tipos de la red, copia local del contrato (docs/decisiones/20261121-1130-contrato-red.md).
// El front no importa código del backend: si el contrato cambia, se actualiza aquí. Lo que es igual en los
// dos lados (tramos, precios) viene de shared/.
import type { TipoDocumento } from '../../../shared/documentos.ts';
import type { SiguienteTramo, Tramo } from '../../../shared/precios.ts';
import type { EstadoOrden, Rol, TipoEventoRed } from '../../../shared/red.ts';


export interface Negocio {
  id: string;
  nombre: string;
  comuna: string;
  rol: Rol;
  /** También vende (proveedor registrado por WhatsApp). */
  vende?: boolean;
  /** Rubro del comprador (`almacen`, `panaderia`, ...), para su ícono. */
  rubro?: string;
  /** Logo del proveedor de la sala, si está configurado. */
  logoUrl?: string;
}

export interface ItemOrden {
  /** Canasta: qué producto de la compra conjunta es. */
  productoId?: string;
  producto: string;
  cantidad: number;
  precioUnitario: number;
}


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

export type { TipoDocumento } from '../../../shared/documentos.ts';

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
  rubro?: string;
  /** Canasta: el carrito por producto. `cantidad` es la suma de todos los productos. */
  items?: Array<{ productoId: string; cantidad: number }>;
  cantidad: number;
  en?: string;
}

/** Un producto de la canasta, con los derivados que calcula el backend. */
export interface ProductoCompra {
  id: string;
  nombre: string;
  unidad: string;
  unidadPlural: string;
  precioSolo: number;
  tramos: Tramo[];
  /** Ofertas por este producto (cada una con su `productoId`). */
  ofertas?: Oferta[];
  /** Quien creó el producto por WhatsApp (sus tramos son su precio por volumen). */
  proveedorId?: string;
  /** Al cerrar: la mejor oferta de este producto. */
  ganadora?: Ganadora;
  totalUnidades?: number;
  precioActual?: number;
  siguienteTramo?: SiguienteTramo | null;
}

export interface Oferta {
  proveedorId: string;
  /** Canasta: el producto por el que oferta. */
  productoId?: string;
  precioUnitario: number;
  /** Sus tramos por cantidad: lo que cobra depende de cuánto junte el grupo (`precioDeOferta`). */
  tramos?: Tramo[];
  /** Entró sola desde su lista de precios. */
  automatica?: true;
  /** Pedido mínimo del grupo (MOQ): si gana y no llegan, el proveedor puede cancelar. */
  minimo?: number;
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

export type { SiguienteTramo, Tramo } from '../../../shared/precios.ts';
export type { EstadoOrden, Rol, TipoEventoRed } from '../../../shared/red.ts';

export interface Licitacion {
  id: string;
  /**
   * Canasta. Los campos de un solo producto (`producto`, `unidad`, `precioSolo`, `tramos`, `ofertas`,
   * `precioActual`, `siguienteTramo`) son los de `productos[0]`; `totalUnidades` es el de toda la canasta.
   */
  productos?: ProductoCompra[];
  /** Lo que ahorra el grupo contra `precioSolo` de cada producto (neto), de toda la canasta. */
  ahorroTotal?: number;
  /** Participantes con carrito y suma de unidades por `precioActual` de cada producto (neto). */
  totalNegocios?: number;
  montoTotal?: number;
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
  /** Logo del proveedor real de la demo (el de `licitacion.proveedorId`), si el backend lo configura. */
  proveedorLogoUrl?: string;
}

export interface EstadoRed {
  negocios: Negocio[];
  ordenes: OrdenCompra[];
  documentos: Documento[];
  /** El backend la manda como { proveedorId: nota }; normalizarEstado la convierte a lista. */
  notas: NotaProveedor[];
  licitaciones: Licitacion[];
}


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
  tipo: TipoEventoRed;
  datos: Record<string, unknown>;
  en: string;
}

export type Fuente = 'cargando' | 'real' | 'falsa';
