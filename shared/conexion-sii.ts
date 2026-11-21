// Contrato de "Conectar mi SII" entre el panel del proveedor y el servidor (`GET /api/red/proveedor/sii` y sus pasos).
// Sin secretos: del certificado solo viajan el RUT del titular y su vencimiento; el .pfx, su clave y el CAF nunca.
import type { TipoDocumento } from './documentos.ts';

/** Datos tributarios de la empresa del proveedor, tal como van en sus documentos. */
export interface EmpresaSii {
  razonSocial: string;
  giro: string;
  acteco: number;
  direccion: string;
  comuna: string;
  ciudad?: string;
}

/** La ficha que el SII tiene inscrita para un RUT. */
export interface FichaSii extends EmpresaSii {
  rut: string;
  /** Todas las actividades inscritas, por si el proveedor quiere elegir otra como giro. */
  actividades: { codigo: number; descripcion: string }[];
}

/** Un CAF conectado y su búsqueda del primer folio libre. */
export interface CafSii {
  tipo: TipoDocumento;
  desde: number;
  hasta: number;
  fa: string;
  primerLibre: number | null;
  /** Folios que quedan desde el primer libre, descontando los que la red ya tomó. */
  libres: number | null;
  escaneando: boolean;
  progreso: { revisados: number; folio: number; total: number } | null;
  error: string | null;
}

export type IdPasoSii = 'empresa' | 'resolucion' | 'caf_33' | 'caf_52' | 'caf_61';

/** Un paso de la conexión automática, con el texto del SII cuando lo hay. */
export interface PasoSii {
  id: IdPasoSii;
  estado: 'pendiente' | 'en_curso' | 'listo' | 'omitido' | 'error';
  detalle: string | null;
  /** Texto literal del SII (bloqueo del timbraje, límite de sesiones...). */
  mensajeSii: string | null;
}

/** Lo que ve el panel. */
export interface EstadoConexionSii {
  /** La red emite con esta conexión (certificado, empresa, resolución y CAF de factura con su primer folio libre). */
  conectado: boolean;
  /** Hay un SII configurado por variables de entorno, que se usa mientras la conexión de la app esté incompleta. */
  respaldoVariables: boolean;
  /** SII_LLAVE_CIFRADO válida: sin ella no se puede guardar nada. */
  puedeGuardar: boolean;
  titular: string | null;
  venceEl: string | null;
  rutEmisor: string | null;
  empresa: EmpresaSii | null;
  origenEmpresa: 'sii' | 'manual' | null;
  resolucion: { fecha: string; numero: number; origen: 'sii' | 'manual'; rechazada: boolean } | null;
  cafs: CafSii[];
  /** Última conexión automática: en curso o su resultado. */
  automatico: { activo: boolean; pasos: PasoSii[] } | null;
  /** La sesión del portal del SII sobrevive a reinicios (Postgres y llave de cifrado). */
  sesionPersistente: boolean;
}
