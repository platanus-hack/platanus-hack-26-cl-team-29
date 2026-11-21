import type pg from 'pg';

// Lo que el proveedor conectó desde la web. Los secretos (el .pfx con su clave y el XML del CAF, que trae la
// llave privada del rango) van cifrados; el resto son datos públicos de la empresa y del rango de folios.

export type TipoCaf = 33 | 52 | 61;
export const TIPOS_CAF: readonly TipoCaf[] = [33, 52, 61];

export interface Empresa {
  razonSocial: string;
  giro: string;
  acteco: number;
  direccion: string;
  comuna: string;
  ciudad?: string;
}

export interface CafGuardado {
  /** XML del CAF en base64, cifrado. */
  cifrado: string;
  desde: number;
  hasta: number;
  /** Fecha de autorización (`FA`), `AAAA-MM-DD`. */
  fa: string;
  /** Primer folio que la app puede usar (equivale a SII_FOLIO_DESDE_<tipo>). Nunca baja. Sin él, falta buscarlo. */
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
  empresa?: Empresa;
  /** Datos de la empresa leídos del portal del SII o escritos por el proveedor. */
  origenEmpresa?: 'sii' | 'manual';
  resolucion?: { fecha: string; numero: number };
  cafs: Partial<Record<`${TipoCaf}`, CafGuardado>>;
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

/** Tabla `sii_conexion`, una fila: la red tiene un solo proveedor con SII real. */
export async function crearAlmacenConexionPostgres(db: pg.Pool): Promise<AlmacenConexion> {
  await db.query(`create table if not exists sii_conexion (
    id text primary key,
    datos jsonb not null,
    actualizado_en timestamptz not null default now()
  )`);
  return {
    async leer() {
      const { rows } = await db.query(`select datos from sii_conexion where id = 'proveedor'`);
      return rows[0]?.datos ?? null;
    },
    async guardar(conexion) {
      await db.query(
        `insert into sii_conexion (id, datos) values ('proveedor', $1::jsonb)
         on conflict (id) do update set datos = excluded.datos, actualizado_en = now()`,
        [JSON.stringify(conexion)],
      );
    },
    async borrar() {
      await db.query(`delete from sii_conexion where id = 'proveedor'`);
    },
  };
}
