// Tipos del canal web (/app y /proveedor). Copia local del contrato de la red
// (docs/decisiones/20261121-1130-contrato-red.md) más las rutas con sesión: el front no importa código del backend.

import type { Documento, EstadoRed, Licitacion, Negocio, OrdenCompra } from '../red/tipos.ts';

/** `GET /api/red/config`. El producto y sus unidades salen de aquí, nunca escritos a mano. */
export interface ConfigRed {
  whatsappNumero: string | null;
  producto: string;
  unidad: string;
  unidadPlural: string;
}

/** Tramo de precio por volumen: desde `desde` unidades en total, cada una cuesta `precioUnitario`. */
export interface Tramo {
  desde: number;
  precioUnitario: number;
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
}

/** `GET /api/red/yo`. */
export interface YoComprador {
  negocio: Negocio;
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
}

export type Recepcion = { conforme: true; confirmado: true } | { faltante: number; confirmado: true };

export interface FotoRed extends Omit<EstadoRed, 'licitaciones' | 'ordenes'> {
  licitaciones: LicitacionCanal[];
  ordenes: OrdenCanal[];
}

export type Modo = 'real' | 'falso';
