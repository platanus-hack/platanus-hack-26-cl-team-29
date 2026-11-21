// Dónde quedan los locales encontrados y hasta qué celda va el recorrido. Postgres si hay base; si no, memoria.
import { readFile, rename, writeFile } from 'node:fs/promises';
import type pg from 'pg';
import type { Local } from './osm.ts';

export interface AlmacenLocales {
  /** Guarda los que no existían y devuelve solo esos (un local que cae en dos celdas cuenta una vez). */
  guardar(locales: Local[]): Promise<Local[]>;
  todos(): Promise<Local[]>;
  /** Primera celda que falta recorrer. */
  siguienteCelda(): Promise<number>;
  marcarCelda(siguiente: number): Promise<void>;
}

export function crearAlmacenLocalesMemoria(): AlmacenLocales {
  const locales = new Map<string, Local>();
  let siguiente = 0;
  return {
    async guardar(nuevos) {
      const agregados = nuevos.filter(l => !locales.has(l.id));
      for (const l of agregados) locales.set(l.id, l);
      return agregados;
    },
    async todos() {
      return [...locales.values()];
    },
    async siguienteCelda() {
      return siguiente;
    },
    async marcarCelda(n) {
      siguiente = n;
    },
  };
}

export async function crearAlmacenLocalesPostgres(db: pg.Pool): Promise<AlmacenLocales> {
  await db.query(`create table if not exists locales (
    id text primary key,
    datos jsonb not null,
    distancia_km real not null,
    encontrado_en timestamptz not null default now()
  )`);
  await db.query('create table if not exists locales_recorrido (clave text primary key, siguiente_celda int not null)');
  return {
    async guardar(nuevos) {
      if (!nuevos.length) return [];
      const { rows } = await db.query<{ id: string }>(
        `insert into locales (id, datos, distancia_km)
         select x.id, x.datos, x.distancia from jsonb_to_recordset($1::jsonb) as x(id text, datos jsonb, distancia real)
         on conflict (id) do nothing returning id`,
        [JSON.stringify(nuevos.map(l => ({ id: l.id, datos: l, distancia: l.distanciaKm })))],
      );
      const insertados = new Set(rows.map(r => r.id));
      return nuevos.filter(l => insertados.has(l.id));
    },
    async todos() {
      const { rows } = await db.query<{ datos: Local }>('select datos from locales order by distancia_km');
      return rows.map(r => r.datos);
    },
    async siguienteCelda() {
      const { rows } = await db.query<{ siguiente_celda: number }>("select siguiente_celda from locales_recorrido where clave = 'mut'");
      return rows[0]?.siguiente_celda ?? 0;
    },
    async marcarCelda(n) {
      await db.query(
        `insert into locales_recorrido (clave, siguiente_celda) values ('mut', $1)
         on conflict (clave) do update set siguiente_celda = excluded.siguiente_celda`,
        [n],
      );
    },
  };
}

/** Lo que se guarda en el JSON: la muestra encontrada y hasta qué celda va el recorrido. */
export interface ArchivoLocales {
  siguienteCelda: number;
  locales: Local[];
}

export async function leerArchivoLocales(ruta: string): Promise<ArchivoLocales | null> {
  try {
    const datos = JSON.parse(await readFile(ruta, 'utf8')) as ArchivoLocales;
    return Array.isArray(datos.locales) && Number.isInteger(datos.siguienteCelda) ? datos : null;
  } catch {
    return null;
  }
}

/** Memoria que además vuelca todo a un JSON tras cada celda (escritura atómica). Lo usa el script del explorador. */
export async function crearAlmacenLocalesArchivo(ruta: string): Promise<AlmacenLocales> {
  const memoria = crearAlmacenLocalesMemoria();
  const previo = await leerArchivoLocales(ruta);
  if (previo) {
    await memoria.guardar(previo.locales);
    await memoria.marcarCelda(previo.siguienteCelda);
  }
  const volcar = async () => {
    const locales = (await memoria.todos()).sort((a, b) => a.distanciaKm - b.distanciaKm);
    const datos: ArchivoLocales = { siguienteCelda: await memoria.siguienteCelda(), locales };
    await writeFile(`${ruta}.tmp`, `${JSON.stringify(datos, null, 1)}\n`);
    await rename(`${ruta}.tmp`, ruta);
  };
  return {
    ...memoria,
    async marcarCelda(n) {
      await memoria.marcarCelda(n);
      await volcar();
    },
  };
}

/** Arranca desde el JSON del repo si el almacén está más atrás: producción parte con la muestra ya recorrida. */
export async function sembrarDesdeArchivo(almacen: AlmacenLocales, ruta: string): Promise<number> {
  const archivo = await leerArchivoLocales(ruta);
  if (!archivo || archivo.siguienteCelda <= (await almacen.siguienteCelda())) return 0;
  const nuevos = await almacen.guardar(archivo.locales);
  await almacen.marcarCelda(archivo.siguienteCelda);
  return nuevos.length;
}
