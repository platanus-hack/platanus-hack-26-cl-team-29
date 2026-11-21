import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';

// Sesiones del canal web: un token opaco al azar por dispositivo (no un JWT), guardado solo como hash SHA-256: una
// filtración de la tabla no entrega sesiones y "Salir" la revoca al instante. Se entra con el teléfono y un código por
// WhatsApp (server/red/acceso.ts) y la sesión dura DURACION_SESION_MS desde el último uso, así que quien usa la web
// seguido no vuelve a pedir código. La sesión es del negocio, no de un rol: qué puede hacer (comprar, vender o
// ambas) lo decide cada ruta con su negocio. Con Postgres sobreviven a los reinicios. Los tokens nunca van en la foto pública ni en eventos.

const DIA_MS = 24 * 60 * 60_000;
export const DURACION_SESION_MS = 90 * DIA_MS;

export interface Sesion {
  negocioId: string;
}

export interface Sesiones {
  crear(sesion: Sesion): string;
  /** La sesión del token, o null si no existe o venció. Usarla la extiende. */
  buscar(token: string | undefined): Sesion | null;
  revocar(token: string | undefined): void;
}

interface Guardada extends Sesion {
  vence: number;
}

/** Dónde quedan las sesiones además de la memoria. Escribe en segundo plano: `buscar` responde sin esperar. */
interface Persistencia {
  guardar(hash: string, sesion: Guardada): Promise<void>;
  borrar(hash: string): Promise<void>;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const alFallar = (e: unknown) => console.error('[sesiones] no pude guardar la sesión', e);

function sesionesSobre(porHash: Map<string, Guardada>, persistencia: Persistencia | null, ahora: () => number): Sesiones {
  const guardar = (h: string, s: Guardada) => { void persistencia?.guardar(h, s).catch(alFallar); };
  const borrar = (h: string) => {
    porHash.delete(h);
    void persistencia?.borrar(h).catch(alFallar);
  };
  return {
    crear({ negocioId }) {
      const token = randomBytes(24).toString('base64url');
      const s = { negocioId, vence: ahora() + DURACION_SESION_MS };
      porHash.set(hash(token), s);
      guardar(hash(token), s);
      return token;
    },
    buscar(token) {
      if (!token) return null;
      const h = hash(token);
      const s = porHash.get(h);
      if (!s) return null;
      if (s.vence <= ahora()) {
        borrar(h);
        return null;
      }
      // Se extiende a lo más una vez al día: una escritura por día por dispositivo, no una por pedido.
      if (s.vence - ahora() < DURACION_SESION_MS - DIA_MS) {
        s.vence = ahora() + DURACION_SESION_MS;
        guardar(h, s);
      }
      return { negocioId: s.negocioId };
    },
    revocar(token) {
      if (token) borrar(hash(token));
    },
  };
}

/** Solo en memoria: para tests y cuando no hay DATABASE_URL (un reinicio obliga a volver a entrar). */
export function crearSesiones(ahora: () => number = Date.now): Sesiones {
  return sesionesSobre(new Map(), null, ahora);
}

/** En Postgres (tabla `sesiones_web`), con copia en memoria cargada al arrancar. */
export async function crearSesionesPostgres(db: pg.Pool, ahora: () => number = Date.now): Promise<Sesiones> {
  await db.query(`create table if not exists sesiones_web (
    hash text primary key,
    negocio_id text not null,
    vence timestamptz not null
  )`);
  await db.query('delete from sesiones_web where vence <= now()');
  const { rows } = await db.query<{ hash: string; negocio_id: string; vence: Date }>('select hash, negocio_id, vence from sesiones_web');
  const porHash = new Map(rows.map(r => [r.hash, { negocioId: r.negocio_id, vence: r.vence.getTime() }]));
  return sesionesSobre(porHash, {
    async guardar(h, s) {
      await db.query(
        `insert into sesiones_web (hash, negocio_id, vence) values ($1, $2, $3)
         on conflict (hash) do update set vence = excluded.vence`,
        [h, s.negocioId, new Date(s.vence)],
      );
    },
    async borrar(h) {
      await db.query('delete from sesiones_web where hash = $1', [h]);
    },
  }, ahora);
}

/** Igualdad en tiempo constante, para tokens y códigos. */
export function mismoSecreto(enviado: unknown, esperado: string): boolean {
  const a = Buffer.from(String(enviado ?? '')), b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
