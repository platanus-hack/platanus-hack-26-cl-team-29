// Tipos del canal web (/app y /proveedor). Copia local del contrato de la red
// (docs/decisiones/20261121-1130-contrato-red.md) más las rutas con sesión: el front no importa código del backend.

import type { Documento, EstadoRed, Licitacion, Negocio, OrdenCompra } from '../red/tipos.ts';

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
  /** Canasta: el carrito de este negocio en esa compra. */
  items?: Array<{ productoId: string; cantidad: number }>;
}

/** Lo que se pide para entrar como comprador. El RUT es obligatorio: la factura sale a ese RUT en el SII. */
export interface DatosEntrada {
  nombre: string;
  comuna: string;
  rubro?: string;
  rut: string;
}

/** A quién sale la factura del comprador (sus datos del SII). Solo lo ve su dueño. */
export interface FacturaA {
  rut: string;
  razonSocial: string;
  giro: string;
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
}

export type Recepcion = { conforme: true; confirmado: true } | { faltante: number; confirmado: true };

export interface FotoRed extends Omit<EstadoRed, 'licitaciones' | 'ordenes'> {
  licitaciones: LicitacionCanal[];
  ordenes: OrdenCanal[];
}

export type Modo = 'real' | 'falso';

/** Datos tributarios de la empresa del proveedor, tal como van en sus documentos. */
export interface EmpresaSii {
  razonSocial: string;
  giro: string;
  acteco: number;
  direccion: string;
  comuna: string;
  ciudad?: string;
}

/** `POST /api/red/proveedor/sii/empresa/consultar`: la ficha que el SII tiene inscrita. */
export interface FichaSii extends EmpresaSii {
  rut: string;
  actividades: { codigo: number; descripcion: string }[];
}

export interface CafSii {
  tipo: 33 | 52 | 61;
  desde: number;
  hasta: number;
  fa: string;
  primerLibre: number | null;
  libres: number | null;
  escaneando: boolean;
  progreso: { revisados: number; folio: number; total: number } | null;
  error: string | null;
}

/** `GET /api/red/proveedor/sii`. Nunca trae el certificado, su clave ni el CAF. */
export interface ConexionSii {
  conectado: boolean;
  respaldoVariables: boolean;
  puedeGuardar: boolean;
  titular: string | null;
  venceEl: string | null;
  rutEmisor: string | null;
  empresa: EmpresaSii | null;
  origenEmpresa: 'sii' | 'manual' | null;
  resolucion: { fecha: string; numero: number; origen: 'sii' | 'manual'; rechazada: boolean } | null;
  cafs: CafSii[];
  /** Conexión automática con el portal del SII: en curso o su último resultado. */
  automatico: { activo: boolean; pasos: PasoSii[] } | null;
  sesionPersistente: boolean;
}

export interface PasoSii {
  id: 'empresa' | 'resolucion' | 'caf_33' | 'caf_52' | 'caf_61';
  estado: 'pendiente' | 'en_curso' | 'listo' | 'omitido' | 'error';
  detalle: string | null;
  /** Texto literal del SII. */
  mensajeSii: string | null;
}

export interface DatosEmpresaSii extends Omit<EmpresaSii, 'acteco'> {
  rutEmisor: string;
  acteco: string;
  fchResol: string;
  nroResol: number;
  origen: 'sii' | 'manual';
}
