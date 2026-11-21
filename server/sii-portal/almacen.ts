// Dónde vive la sesión del portal entre llamadas, procesos y despliegues. Cada login cuenta contra el cupo de
// sesiones del RUT en el SII: una sesión en la memoria del proceso se pierde en cada despliegue y fuerza otro login.
// Por eso, con base de datos, la sesión va a Postgres, cifrada como las credenciales (las cookies sirven para actuar
// en nombre del contribuyente). Guardar es de mejor esfuerzo: si falla, la operación sigue.
import type pg from 'pg';
import { cifrar, descifrar } from '../conexion-sii/cifrado.ts';

/** Sesión guardada de un certificado. */
export interface RegistroSesion {
  /** SHA-256 del certificado (DER). Se compara antes de reutilizar la sesión. */
  huella: string;
  rutTitular: string;
  /** Cabecera `Cookie` de la sesión. Secreto. */
  cookies: string;
  creadaEn: number;
  usadaEn: number;
}

/** Espera tras el límite de sesiones: el cupo es por RUT, no por certificado. */
export interface RegistroEspera {
  rutTitular: string;
  hasta: number;
  mensajeSii: string | null;
}

export interface AlmacenSesiones {
  /** true si sobrevive a un reinicio (Postgres). */
  readonly persistente: boolean;
  leerSesion(huella: string): Promise<RegistroSesion | null>;
  guardarSesion(registro: RegistroSesion): Promise<void>;
  borrarSesion(huella: string): Promise<void>;
  leerEspera(rutTitular: string): Promise<RegistroEspera | null>;
  guardarEspera(espera: RegistroEspera): Promise<void>;
}

export function crearAlmacenSesionesMemoria(): AlmacenSesiones {
  const sesiones = new Map<string, RegistroSesion>();
  const esperas = new Map<string, RegistroEspera>();
  return {
    persistente: false,
    async leerSesion(huella) { const r = sesiones.get(huella); return r ? { ...r } : null; },
    async guardarSesion(r) { sesiones.set(r.huella, { ...r }); },
    async borrarSesion(huella) { sesiones.delete(huella); },
    async leerEspera(rut) { const e = esperas.get(rut); return e ? { ...e } : null; },
    async guardarEspera(e) { esperas.set(e.rutTitular, { ...e }); },
  };
}

/** Tabla `sii_portal_sesion`: una fila por sesión (`sesion:<huella>`) y por espera (`espera:<rut>`), con los datos cifrados. */
export async function crearAlmacenSesionesPostgres(db: pg.Pool, llave: Buffer): Promise<AlmacenSesiones> {
  await db.query(`create table if not exists sii_portal_sesion (
    clave text primary key,
    datos text not null,
    actualizado_en timestamptz not null default now()
  )`);
  const leer = async <T>(clave: string): Promise<T | null> => {
    const { rows } = await db.query('select datos from sii_portal_sesion where clave = $1', [clave]);
    if (!rows[0]) return null;
    try {
      return JSON.parse(descifrar(llave, rows[0].datos as string)) as T;
    } catch {
      // Otra llave o dato alterado: se trata como inexistente (se hará un login nuevo, nunca se usa algo ilegible).
      return null;
    }
  };
  const escribir = async (clave: string, valor: unknown) => {
    await db.query(
      `insert into sii_portal_sesion (clave, datos) values ($1, $2)
       on conflict (clave) do update set datos = excluded.datos, actualizado_en = now()`,
      [clave, cifrar(llave, JSON.stringify(valor))],
    );
  };
  return {
    persistente: true,
    leerSesion: huella => leer<RegistroSesion>(`sesion:${huella}`),
    guardarSesion: r => escribir(`sesion:${r.huella}`, r),
    async borrarSesion(huella) { await db.query('delete from sii_portal_sesion where clave = $1', [`sesion:${huella}`]); },
    leerEspera: rut => leer<RegistroEspera>(`espera:${rut}`),
    guardarEspera: e => escribir(`espera:${e.rutTitular}`, e),
  };
}
