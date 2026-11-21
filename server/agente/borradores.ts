// Lo que el agente lleva a medias por teléfono (el registro antes de comprar, el carrito que se está armando, el
// registro de un proveedor) sobrevive a un reinicio del servidor: cada deploy reinicia el proceso y, sin esto, quien
// estaba registrándose volvía a recibir el saludo. Se guarda en Postgres si hay base; si no, en memoria.
import type pg from 'pg';
import type { Log } from './envios.ts';

export interface AlmacenBorradores {
  /** Todo lo guardado de un espacio (`sala`, `proveedor`), por clave (el teléfono normalizado). */
  cargar(espacio: string): Promise<[string, unknown][]>;
  /** `null` borra la clave; sin clave, borra todo el espacio. */
  guardar(espacio: string, clave: string | null, valor: unknown): Promise<void>;
}

export function crearAlmacenBorradoresMemoria(): AlmacenBorradores {
  const espacios = new Map<string, Map<string, unknown>>();
  const de = (espacio: string) => espacios.get(espacio) ?? espacios.set(espacio, new Map()).get(espacio)!;
  return {
    async cargar(espacio) {
      return [...de(espacio)].map(([k, v]) => [k, structuredClone(v)]);
    },
    async guardar(espacio, clave, valor) {
      if (clave === null) de(espacio).clear();
      else if (valor === null) de(espacio).delete(clave);
      else de(espacio).set(clave, structuredClone(valor));
    },
  };
}

/** Tabla `agente_borradores` (espacio, clave): una fila por teléfono con lo que lleva a medias. */
export async function crearAlmacenBorradores(db: pg.Pool | null, log: Pick<Log, 'error'> = console): Promise<AlmacenBorradores> {
  if (!db) return crearAlmacenBorradoresMemoria();
  try {
    await db.query(`create table if not exists agente_borradores (
      espacio text not null,
      clave text not null,
      datos jsonb not null,
      actualizado_en timestamptz not null default now(),
      primary key (espacio, clave)
    )`);
  } catch (error) {
    log.error('[agente] no se pudo usar Postgres para los borradores, sigo en memoria', error);
    return crearAlmacenBorradoresMemoria();
  }
  return {
    async cargar(espacio) {
      const { rows } = await db.query(`select clave, datos from agente_borradores where espacio = $1`, [espacio]);
      return rows.map(r => [String(r.clave), r.datos]);
    },
    async guardar(espacio, clave, valor) {
      if (clave === null) await db.query(`delete from agente_borradores where espacio = $1`, [espacio]);
      else if (valor === null) await db.query(`delete from agente_borradores where espacio = $1 and clave = $2`, [espacio, clave]);
      else {
        await db.query(
          `insert into agente_borradores (espacio, clave, datos) values ($1, $2, $3::jsonb)
           on conflict (espacio, clave) do update set datos = excluded.datos, actualizado_en = now()`,
          [espacio, clave, JSON.stringify(valor)],
        );
      }
    },
  };
}

/**
 * Un Map que escribe cada cambio en el almacén (en segundo plano, en orden) y se llena con `cargar()` al arrancar.
 * Los valores tienen que ser JSON.
 */
export class MapaPersistente<V> extends Map<string, V> {
  readonly #almacen: AlmacenBorradores;
  readonly #espacio: string;
  readonly #log: Pick<Log, 'error'>;
  #escrituras: Promise<void> = Promise.resolve();

  constructor(almacen: AlmacenBorradores, espacio: string, log: Pick<Log, 'error'> = console) {
    super();
    this.#almacen = almacen;
    this.#espacio = espacio;
    this.#log = log;
  }

  async cargar(): Promise<void> {
    for (const [clave, valor] of await this.#almacen.cargar(this.#espacio)) super.set(clave, valor as V);
  }

  /** Para tests: espera a que se escriba todo lo pendiente. */
  escrito(): Promise<void> {
    return this.#escrituras;
  }

  override set(clave: string, valor: V): this {
    super.set(clave, valor);
    this.#escribir(clave, valor);
    return this;
  }

  override delete(clave: string): boolean {
    const habia = super.delete(clave);
    if (habia) this.#escribir(clave, null);
    return habia;
  }

  override clear(): void {
    super.clear();
    this.#escribir(null, null);
  }

  #escribir(clave: string | null, valor: V | null) {
    this.#escrituras = this.#escrituras
      .then(() => this.#almacen.guardar(this.#espacio, clave, valor))
      .catch(error => this.#log.error(`[agente] no se pudo guardar el borrador (${this.#espacio}):`, error instanceof Error ? error.message : error));
  }
}
