// Tipos del canal web (/app y /proveedor). Copia local del contrato de la red
// (docs/decisiones/20261121-1130-contrato-red.md) más las rutas con sesión: el front no importa código del backend.

import type { EmpresaSii } from '../../../shared/conexion-sii.ts';
import type { Documento, EstadoRed, Licitacion, Negocio, OrdenCompra, Tramo } from '../red/tipos.ts';

export type { Tramo };
export type { CafSii, EmpresaSii, EstadoConexionSii, FichaSii, FoliosSii, PasoSii } from '../../../shared/conexion-sii.ts';

/** `GET /api/red/config`. El producto y sus unidades salen de aquí, nunca escritos a mano. */
export interface ConfigRed {
  whatsappNumero: string | null;
  producto: string;
  unidad: string;
  unidadPlural: string;
  /** Canasta de la compra conjunta: los productos y cómo se cuentan. */
  productos?: Array<{ id: string; nombre: string; unidad: string; unidadPlural: string }>;
  /** Logo del proveedor de la compra conjunta, si se configuró. Opcional: sin él se usa su monograma. */
  proveedorLogoUrl?: string | null;
}

/** Licitación con los campos de la compra conjunta por tramos (todos opcionales: se leen con cuidado). */
export interface LicitacionCanal extends Omit<Licitacion, 'estado'> {
  estado: string;
  tramos?: Tramo[];
  /** Precio por unidad que calcula el backend según los tramos. */
  precioActual?: number;
  /** El proveedor único de la compra conjunta. */
  proveedorId?: string;
  /** Órdenes creadas al cerrar, una por participante. */
  ordenIds?: string[];
  facturadaEn?: string;
}

export interface OrdenCanal extends OrdenCompra {
  /** Presente si la orden nació del cierre de una compra conjunta. */
  licitacionId?: string;
}

export interface Participacion {
  licitacionId: string;
  cantidad: number;
  /** Canasta: el carrito de este negocio en esa compra. */
  items?: Array<{ productoId: string; cantidad: number }>;
}

/** Lo que se pide para entrar como comprador. El RUT es obligatorio: la factura sale a ese RUT en el SII. */
export interface DatosEntrada {
  nombre: string;
  comuna: string;
  /** Para su factura: la consulta pública del SII no la trae. */
  direccion: string;
  rubro?: string;
  rut: string;
}

/** A quién sale la factura del comprador (sus datos del SII). Solo lo ve su dueño. */
export interface FacturaA {
  rut: string;
  razonSocial: string;
  giro: string;
  /** Sin dirección (la consulta del SII no la trae), su factura no se puede emitir: la completa en Facturas. */
  direccion?: string;
  comuna: string;
  /** Datos de prueba: el SII todavía no está conectado para consultar RUT. */
  simulado?: boolean;
}

/** `GET /api/red/yo`. */
export interface YoComprador {
  negocio: Negocio;
  facturaA?: FacturaA | null;
  ordenes: OrdenCanal[];
  documentos: Documento[];
  participaciones: Participacion[];
}

/** `GET /api/red/proveedor/yo`. */
export interface YoProveedor {
  proveedor: Negocio;
  ordenes: OrdenCanal[];
  documentos: Documento[];
  nota: number | null;
  notaAnterior?: number;
  licitaciones?: LicitacionCanal[];
  /** false: todavía no puede emitir facturas en el SII, así que sus ofertas no compiten. */
  puedeFacturar?: boolean;
}

/** La recepción que confirma el comprador: llegó todo, o cuántas faltaron (reclamo en el SII). */
export type Recepcion = { conforme: true; confirmado: true } | { faltante: number; confirmado: true };

export interface FotoRed extends Omit<EstadoRed, 'licitaciones' | 'ordenes'> {
  licitaciones: LicitacionCanal[];
  ordenes: OrdenCanal[];
}

export type Modo = 'real' | 'falso';

export interface DatosEmpresaSii extends Omit<EmpresaSii, 'acteco'> {
  rutEmisor: string;
  acteco: string;
  fchResol: string;
  nroResol: number;
  origen: 'sii' | 'manual';
}
