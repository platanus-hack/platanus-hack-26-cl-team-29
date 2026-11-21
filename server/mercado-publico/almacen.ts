// Órdenes de Mercado Público ya normalizadas y hasta dónde llegó cada fuente. Postgres si hay base; si no, memoria.
import type pg from 'pg';
import type { OrdenMP } from './normalizar.ts';

export interface AlmacenMercadoPublico {
  /** Guarda por código (una orden repetida se reemplaza) y devuelve las que no estaban. */
  guardar(ordenes: OrdenMP[]): Promise<OrdenMP[]>;
  todas(): Promise<OrdenMP[]>;
  /** Hasta dónde llegó una fuente (el último día traído de la API, la versión del archivo OCDS); null si nunca corrió. */
  marca(clave: string): Promise<string | null>;
  fijarMarca(clave: string, valor: string): Promise<void>;
}

export function crearAlmacenMemoria(): AlmacenMercadoPublico {
  const porCodigo = new Map<string, OrdenMP>();
  const marcas = new Map<string, string>();
  return {
    async guardar(ordenes) {
      const nuevas = ordenes.filter(x => !porCodigo.has(x.codigo));
      for (const x of ordenes) porCodigo.set(x.codigo, x);
      return nuevas;
    },
    todas: async () => [...porCodigo.values()],
    marca: async clave => marcas.get(clave) ?? null,
    async fijarMarca(clave, valor) {
      marcas.set(clave, valor);
    },
  };
}

export async function crearAlmacenPostgres(db: pg.Pool): Promise<AlmacenMercadoPublico> {
  await db.query(`create table if not exists mercado_publico_ordenes (
    codigo text primary key, fecha date not null, orden jsonb not null)`);
  await db.query('create table if not exists mercado_publico_marcas (clave text primary key, valor text not null)');
  return {
    async guardar(ordenes) {
      if (!ordenes.length) return [];
      // xmax = 0 solo en las filas recién insertadas (no en las actualizadas por el conflicto).
      const { rows } = await db.query<{ codigo: string; nueva: boolean }>(
        `insert into mercado_publico_ordenes (codigo, fecha, orden)
         select o->>'codigo', (o->>'fecha')::date, o from jsonb_array_elements($1::jsonb) as o
         on conflict (codigo) do update set fecha = excluded.fecha, orden = excluded.orden
         returning codigo, (xmax = 0) as nueva`,
        [JSON.stringify(ordenes)],
      );
      const nuevas = new Set(rows.filter(r => r.nueva).map(r => r.codigo));
      return ordenes.filter(x => nuevas.has(x.codigo));
    },
    async todas() {
      const { rows } = await db.query<{ orden: OrdenMP }>('select orden from mercado_publico_ordenes order by fecha desc');
      return rows.map(r => r.orden);
    },
    async marca(clave) {
      const { rows } = await db.query<{ valor: string }>('select valor from mercado_publico_marcas where clave = $1', [clave]);
      return rows[0]?.valor ?? null;
    },
    async fijarMarca(clave, valor) {
      await db.query(
        `insert into mercado_publico_marcas (clave, valor) values ($1, $2)
         on conflict (clave) do update set valor = excluded.valor`,
        [clave, valor],
      );
    },
  };
}
