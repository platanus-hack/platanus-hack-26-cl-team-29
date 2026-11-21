// Exclusión por certificado: un solo trabajo a la vez con la misma sesión del portal. Así hay un solo login aunque
// lleguen llamadas concurrentes (la segunda encuentra la sesión que dejó la primera) y las solicitudes de una misma
// sesión van en serie (las cookies del balanceador del SII se rompen con solicitudes concurrentes).
//
// En el proceso, una cola por clave. Con Postgres, además, un advisory lock tomado sobre una conexión dedicada (un
// cliente sacado del pool y retenido hasta soltarlo: el lock se toma y se suelta en la misma conexión), con reintento
// corto y espera máxima larga, porque un flujo de folios puede tardar minutos.
import { createHash } from 'node:crypto';
import type pg from 'pg';

export interface Candado {
  conCandado<T>(clave: string, trabajo: () => Promise<T>): Promise<T>;
}

export function crearCandadoMemoria(): Candado {
  const colas = new Map<string, Promise<unknown>>();
  return {
    conCandado(clave, trabajo) {
      const previo = colas.get(clave) ?? Promise.resolve();
      const turno = previo.catch(() => {}).then(trabajo);
      const cola = turno.catch(() => {});
      colas.set(clave, cola);
      void cola.then(() => { if (colas.get(clave) === cola) colas.delete(clave); });
      return turno;
    },
  };
}

/** Dos enteros de 32 bits para `pg_try_advisory_lock(int, int)` a partir de la clave. */
function llavesDe(clave: string): [number, number] {
  const h = createHash('sha256').update(`sii-portal:${clave}`).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

export interface OpcionesCandadoPostgres {
  reintentoMs?: number;
  esperaMaxMs?: number;
  esperar?: (ms: number) => Promise<void>;
}

export function crearCandadoPostgres(db: pg.Pool, opciones: OpcionesCandadoPostgres = {}): Candado {
  const local = crearCandadoMemoria();
  const reintentoMs = opciones.reintentoMs ?? 250;
  const esperaMaxMs = opciones.esperaMaxMs ?? 30 * 60_000;
  const esperar = opciones.esperar ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  return {
    conCandado(clave, trabajo) {
      return local.conCandado(clave, async () => {
        const [a, b] = llavesDe(clave);
        const conexion = await db.connect();
        try {
          const limite = Date.now() + esperaMaxMs;
          for (;;) {
            const { rows } = await conexion.query('select pg_try_advisory_lock($1::int, $2::int) as tomado', [a, b]);
            if (rows[0]?.tomado) break;
            if (Date.now() >= limite) throw new Error('Otra instancia del servidor tiene ocupada la sesión del SII de este certificado.');
            await esperar(reintentoMs);
          }
          try {
            return await trabajo();
          } finally {
            await conexion.query('select pg_advisory_unlock($1::int, $2::int)', [a, b]).catch(() => {});
          }
        } finally {
          conexion.release();
        }
      });
    },
  };
}
