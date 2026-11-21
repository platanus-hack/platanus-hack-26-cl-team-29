import type pg from 'pg';
import type { EmpresaSii } from '../../shared/conexion-sii.ts';
import type { TipoDocumento } from '../../shared/documentos.ts';
import type { GestionFolios } from './reposicion.ts';

// Lo que un proveedor conectó: desde el panel web (fila `proveedor`) o con su certificado por WhatsApp (una fila por
// RUT de su empresa, `rut:<rut>`). Los secretos (el .pfx con su clave y el XML del CAF, que trae la
// llave privada del rango) van cifrados; el resto son datos públicos de la empresa y del rango de folios.

export interface CafGuardado {
  /** XML del CAF en base64, cifrado. */
  cifrado: string;
  desde: number;
  hasta: number;
  /** Fecha de autorización (`FA`), `AAAA-MM-DD`. */
  fa: string;
  /** Primer folio del rango que la app puede usar. Nunca baja. Sin él, falta buscarlo (y el CAF no se usa). */
  primerLibre?: number;
}

export interface ConexionGuardada {
  certificado?: {
    /** JSON `{ pfxBase64, clave }`, cifrado. */
    cifrado: string;
    rut: string;
    venceEl: string;
  };
  rutEmisor?: string;
  empresa?: EmpresaSii;
  /** Datos de la empresa leídos del portal del SII o escritos por el proveedor. */
  origenEmpresa?: 'sii' | 'manual';
  resolucion?: {
    fecha: string;
    numero: number;
    /** Leída del portal del SII o escrita por el proveedor. */
    origen?: 'sii' | 'manual';
    /** El SII rechazó la carátula de un envío con esta resolución (RCT): no se emite con ella hasta corregirla. */
    rechazadaEn?: string;
  };
  /** CAF por tipo: puede haber varios rangos (la reposición suma rangos reobtenidos o pedidos), ordenados por folio. */
  cafs: Partial<Record<`${TipoDocumento}`, CafGuardado[]>>;
  /** Reposición de folios por tipo: espera tras un rechazo, rangos ya barridos y lo último que pasó. */
  folios?: Partial<Record<`${TipoDocumento}`, GestionFolios>>;
  actualizadoEn: string;
}

export interface AlmacenConexion {
  leer(): Promise<ConexionGuardada | null>;
  guardar(conexion: ConexionGuardada): Promise<void>;
  borrar(): Promise<void>;
}

/** Sin base de datos: se pierde al reiniciar el proceso. */
export function crearAlmacenConexionMemoria(): AlmacenConexion {
  let guardada: ConexionGuardada | null = null;
  return {
    async leer() {
      return guardada && structuredClone(guardada);
    },
    async guardar(conexion) {
      guardada = structuredClone(conexion);
    },
    async borrar() {
      guardada = null;
    },
  };
}

/** Tabla `sii_conexion`, una fila por conexión: `proveedor` es la del panel; las de WhatsApp van por RUT de empresa. */
export async function crearAlmacenConexionPostgres(db: pg.Pool, id = 'proveedor'): Promise<AlmacenConexion> {
  await db.query(`create table if not exists sii_conexion (
    id text primary key,
    datos jsonb not null,
    actualizado_en timestamptz not null default now()
  )`);
  return {
    async leer() {
      const { rows } = await db.query(`select datos from sii_conexion where id = $1`, [id]);
      return rows[0]?.datos ?? null;
    },
    async guardar(conexion) {
      await db.query(
        `insert into sii_conexion (id, datos) values ($2, $1::jsonb)
         on conflict (id) do update set datos = excluded.datos, actualizado_en = now()`,
        [JSON.stringify(conexion), id],
      );
    },
    async borrar() {
      await db.query(`delete from sii_conexion where id = $1`, [id]);
    },
  };
}
