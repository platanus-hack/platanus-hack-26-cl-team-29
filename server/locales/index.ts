// Locales de Chile, mostrados desde el MUT hacia afuera: API pública del módulo.
// Fuera de server/locales/ se importa solo este archivo.
//
// GET /api/locales → { locales, avance, totalChile }   (la foto: lo que el explorador ya mostró)
// Socket.io `locales:evento` → { nuevos, avance }   (cada celda recorrida, con sus locales)
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import express from 'express';
import type pg from 'pg';
import { crearAlmacenLocalesMemoria, crearAlmacenLocalesPostgres, type AlmacenLocales } from './almacen.ts';
import { crearExplorador, type Hallazgo } from './explorador.ts';
import { buscarEnCatalogo, recorrido, type Local } from './osm.ts';

export type { Local } from './osm.ts';
export type { Avance, Hallazgo } from './explorador.ts';

/** Catálogo de Chile versionado en el repo (lo arma `scripts/importar-locales-chile.ts`). */
export const ARCHIVO_CATALOGO = 'data/locales-chile.json.gz';
/**
 * reparto: celdas de 25 km con 6 locales cada una, por todo Chile;
 * acumulando: celdas de 2 km con todos sus locales, del MUT hacia afuera.
 */
export const RECORRIDO = { reparto: { ladoKm: 25, porCelda: 6 }, acumulando: { ladoKm: 2 } };
/** Pausa entre celdas: lo justo para que el mapa se vea crecer. */
const ESPERA_MS = 1500;

export async function leerCatalogo(ruta = ARCHIVO_CATALOGO): Promise<Local[]> {
  try {
    return JSON.parse(gunzipSync(await readFile(ruta)).toString('utf8')) as Local[];
  } catch {
    return [];
  }
}

/** Lo que viaja al mapa: lo mínimo para dibujar cada punto. */
const paraMapa = ({ id, nombre, tipo, lat, lng }: Local) => ({ id, nombre, tipo, lat, lng });

export interface LocalesDelServidor {
  rutas: express.Router;
  detener(): void;
}

/**
 * Arranca el explorador en segundo plano. `LOCALES_EXPLORAR=0` lo apaga (la API sigue respondiendo con lo guardado);
 * `LOCALES_ESPERA_MS` cambia la pausa entre celdas.
 */
export async function iniciarLocales(
  db: pg.Pool | null,
  emitir: (h: Hallazgo) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalesDelServidor> {
  let almacen: AlmacenLocales | null = null;
  if (db) {
    try {
      almacen = await crearAlmacenLocalesPostgres(db);
    } catch (error) {
      console.error('[locales] no se pudo usar Postgres, los locales quedan en memoria', error);
    }
  }
  if (!almacen) {
    console.warn('[locales] locales en memoria: tras un reinicio el recorrido vuelve al MUT. Configura DATABASE_URL.');
    almacen = crearAlmacenLocalesMemoria();
  }

  const catalogo = await leerCatalogo();
  if (!catalogo.length) console.warn(`[locales] sin catálogo en ${ARCHIVO_CATALOGO}: el mapa no muestra locales`);
  const explorador = crearExplorador({
    almacen,
    celdas: recorrido(catalogo, RECORRIDO),
    buscar: buscarEnCatalogo(catalogo),
    esperaMs: Number(env.LOCALES_ESPERA_MS) || ESPERA_MS,
    alAvanzar: h => emitir({ ...h, nuevos: h.nuevos.map(paraMapa) as Local[] }),
    registrar: m => console.warn(m),
  });
  if (env.LOCALES_EXPLORAR !== '0' && catalogo.length) {
    explorador.iniciar().catch(error => console.error('[locales] el explorador se detuvo', error));
  }

  const rutas = express.Router();
  rutas.get('/', async (_req, res) => {
    res.json({ locales: (await almacen.todos()).map(paraMapa), avance: await explorador.avance(), totalChile: catalogo.length });
  });
  return { rutas, detener: () => explorador.detener() };
}
