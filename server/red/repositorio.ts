import type pg from 'pg';
import type { Coleccion, DatosRed } from './tipos.ts';

// El dominio trabaja sobre su copia en memoria (un solo proceso) y escribe cada cambio aquí.
export interface Repositorio {
  cargar(): Promise<DatosRed>;
  guardar<C extends Coleccion>(coleccion: C, entidad: DatosRed[C][number]): Promise<void>;
  /** Borra todas las colecciones de la red (solo tablas `red_*`; los folios del SII viven aparte). */
  vaciar(): Promise<void>;
}

const COLECCIONES: Coleccion[] = ['negocios', 'ordenes', 'documentos', 'eventosReputacion', 'licitaciones'];

function datosVacios(): DatosRed {
  return { negocios: [], ordenes: [], documentos: [], eventosReputacion: [], licitaciones: [] };
}

/** Para tests y para cuando no hay DATABASE_URL: se pierde al reiniciar. */
export function crearRepositorioMemoria(): Repositorio {
  const datos = datosVacios();
  return {
    cargar: async () => structuredClone(datos),
    async guardar(coleccion, entidad) {
      const lista = datos[coleccion] as { id: string }[];
      const copia = structuredClone(entidad);
      const i = lista.findIndex(e => e.id === entidad.id);
      if (i >= 0) lista[i] = copia;
      else lista.push(copia);
    },
    async vaciar() {
      Object.assign(datos, datosVacios());
    },
  };
}

// Postgres: una tabla por colección con la entidad completa en jsonb. Los nombres de tabla
// salen de la lista fija de colecciones, nunca de la entrada del usuario.
const tabla = (c: Coleccion) => `red_${c.toLowerCase()}`;

export async function crearRepositorioPostgres(db: pg.Pool): Promise<Repositorio> {
  for (const c of COLECCIONES) {
    await db.query(`create table if not exists ${tabla(c)} (
      n bigserial,
      id text primary key,
      datos jsonb not null
    )`);
  }
  return {
    async cargar() {
      const datos = datosVacios();
      for (const c of COLECCIONES) {
        const { rows } = await db.query(`select datos from ${tabla(c)} order by n`);
        (datos[c] as unknown[]) = rows.map(r => r.datos);
      }
      return datos;
    },
    async guardar(coleccion, entidad) {
      await db.query(
        `insert into ${tabla(coleccion)} (id, datos) values ($1, $2)
         on conflict (id) do update set datos = excluded.datos`,
        [entidad.id, JSON.stringify(entidad)],
      );
    },
    async vaciar() {
      await db.query(`truncate ${COLECCIONES.map(tabla).join(', ')}`);
    },
  };
}
