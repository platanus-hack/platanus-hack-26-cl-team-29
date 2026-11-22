// Entidades de la red de compras. Contrato: docs/decisiones/20261121-1130-contrato-red.md
// Las fechas van como texto ISO para que viajen igual por HTTP, Socket.io y jsonb.
import type { TipoDocumento } from '../../shared/documentos.ts';
import type { SiguienteTramo, Tramo } from '../../shared/precios.ts';
import type { EstadoOrden, Rol, TipoEventoRed } from '../../shared/red.ts';
import type { DocumentoImpreso } from '../sii/index.ts';
import type { DatosContribuyente } from './contribuyente.ts';


export interface Negocio {
  id: string;
  nombre: string;
  comuna: string;
  rol: Rol;
  /** Se registró como proveedor por WhatsApp: vende y también compra (`puedeVender`, `puedeComprar` de shared/red.ts). */
  vende?: boolean;
  telefono: string;
  /** Rubro del comprador (`RUBROS`), para el ícono en pantalla. */
  rubro?: Rubro;
  /** Logo del proveedor de la sala (DEMO_PROVEEDOR_LOGO_URL, solo si es https). */
  logoUrl?: string;
  /** RUT del comprador en la forma del SII ("12345678-5"). Solo interno: nunca en la foto pública, eventos ni pantallas. */
  rut?: string;
  /** Sus datos en el SII, a los que sale su factura. Solo interno, igual que `rut`. */
  contribuyente?: DatosContribuyente;
}

/** Rubros de comprador que la pantalla sabe dibujar. Uno desconocido queda como `otro`. */
export const RUBROS = [
  'almacen', 'panaderia', 'restaurante', 'farmacia', 'minimarket', 'botilleria', 'ferreteria', 'cafe',
  'verduleria', 'carniceria', 'libreria', 'otro',
] as const;
export type Rubro = typeof RUBROS[number];

export interface Item {
  /** En la compra conjunta, el producto de la canasta (`ProductoCompra.id`). */
  productoId?: string;
  producto: string;
  cantidad: number;
  precioUnitario: number;
  /** Lo que dice la guía de despacho (52). Se fija al confirmar; antes puede faltar. */
  cantidadDespachada?: number;
}


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

export type { TipoDocumento } from '../../shared/documentos.ts';

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

/** Una línea del carrito de un participante. */
export interface ItemCarrito {
  productoId: string;
  cantidad: number;
}

export interface Participante {
  negocioId?: string;
  /** Solo interno (WhatsApp): nunca sale en la foto pública ni en eventos. */
  telefono?: string;
  nombre: string;
  comuna?: string;
  rubro?: Rubro;
  /** Su carrito: cada producto de la canasta que compra, con su cantidad. */
  items: ItemCarrito[];
  /** Suma de `items` (compatibilidad con la compra de un solo producto). */
  cantidad: number;
  /** Cuándo se sumó (ISO). */
  en: string;
}

export interface Oferta {
  proveedorId: string;
  /** Producto de la canasta al que se oferta. Falta solo en licitaciones guardadas antes de la canasta. */
  productoId?: string;
  /** Precio base por unidad (con tramos, el de su primer tramo). */
  precioUnitario: number;
  /** Sus tramos por cantidad: el precio que cobra depende de cuánto junte el grupo (`precioDeOferta`). */
  tramos?: Tramo[];
  /** La puso Bando desde la lista de precios del proveedor; si él oferta a mano, la reemplaza. */
  automatica?: true;
  /**
   * Pedido mínimo del grupo (MOQ) que pide el proveedor. No impide la compra: si gana y el grupo no llega, puede
   * cancelar el pedido, y el comprador lo ve antes de sumarse.
   */
  minimo?: number;
  plazoDias: number;
  /** Cuándo llegó (ISO). */
  en: string;
}

export interface Ganadora extends Oferta {
  nota: number;
  precioAjustado: number;
}

export type { SiguienteTramo, Tramo } from '../../shared/precios.ts';
export type { EstadoOrden, Rol, TipoEventoRed } from '../../shared/red.ts';

/** Un producto de la canasta de la compra conjunta, con sus propios tramos y ofertas. */
export interface ProductoCompra {
  id: string;
  nombre: string;
  unidad: string;
  unidadPlural: string;
  /** Precio unitario si se compra solo. */
  precioSolo: number;
  /** Precio por volumen total del grupo en este producto, de menor a mayor `desde`. */
  tramos: Tramo[];
  /** Ofertas de proveedores por este producto (cada una con `productoId`). */
  ofertas: Oferta[];
  /** Quien creó el producto por WhatsApp: sus `tramos` son su precio por volumen. Los de la canasta de la demo no tienen. */
  proveedorId?: string;
  /** Al cerrar, la mejor oferta por precio ajustado (sin la compra propia de cada participante, ver `cerrarLicitacion`). */
  ganadora?: Ganadora;
}

/** Producto de la canasta con lo que se deriva de los carritos. */
export interface ProductoCompraVista extends ProductoCompra {
  totalUnidades: number;
  precioActual: number;
  siguienteTramo: SiguienteTramo | null;
}

export interface Licitacion {
  id: string;
  /** La canasta. Los campos de un solo producto (`producto`, `unidad`, `precioSolo`, `tramos`, `ofertas`) reflejan `productos[0]`. */
  productos: ProductoCompra[];
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
  /** El comprador que inició la compra en grupo (una solicitud): puede cerrarla antes si ya llegó al mínimo. */
  iniciadaPor?: string;
  /** Órdenes creadas al cerrar, una por participante. */
  ordenIds?: string[];
}

/**
 * Licitación con lo que se deriva de los carritos. `totalUnidades`, `montoTotal` y `ahorroTotal` son de toda
 * la canasta; `precioActual` y `siguienteTramo` son los de `productos[0]` (compatibilidad).
 */
export interface LicitacionVista extends Omit<Licitacion, 'productos'> {
  productos: ProductoCompraVista[];
  /** Negocios (participantes) con algo en su carrito. */
  totalNegocios: number;
  totalUnidades: number;
  /** Lo que paga el grupo hoy: suma de unidades por `precioActual` de cada producto (neto). */
  montoTotal: number;
  /** Lo que ahorra el grupo contra `precioSolo` de cada producto (neto). */
  ahorroTotal: number;
  precioActual: number;
  siguienteTramo: SiguienteTramo | null;
}

/**
 * Representación impresa de un documento (PDF), con el TED. Solo interna: lleva los RUT y datos tributarios
 * del SII, así que nunca va en la foto pública ni en eventos; sale solo como PDF por un enlace firmado.
 */
export interface ImpresoDocumento {
  /** El `id` del documento. */
  id: string;
  impreso: DocumentoImpreso;
}

/** Todo lo que se persiste, por colección. */
export interface DatosRed {
  negocios: Negocio[];
  ordenes: OrdenCompra[];
  documentos: Documento[];
  eventosReputacion: EventoReputacion[];
  licitaciones: Licitacion[];
  impresos: ImpresoDocumento[];
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


/** Lo que viaja en `red:evento` por Socket.io. */
export interface EventoRed {
  tipo: TipoEventoRed;
  datos: unknown;
  en: string;
}
