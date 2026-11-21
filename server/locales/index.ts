// Locales alrededor del MUT: API pública del módulo. Fuera de server/locales/ se importa solo este archivo.
//
// GET /api/locales → { locales, avance }   (la foto completa)
// Socket.io `locales:evento` → { nuevos, avance }   (cada celda recorrida, con los locales que no estaban)
import express from 'express';
import type pg from 'pg';
import { crearAlmacenLocalesMemoria, crearAlmacenLocalesPostgres, sembrarDesdeArchivo, type AlmacenLocales } from './almacen.ts';
import { crearExplorador, type Hallazgo } from './explorador.ts';
import { buscarEnOsm, MUT, recorrido } from './osm.ts';

export { crearAlmacenLocalesArchivo } from './almacen.ts';
export { crearExplorador } from './explorador.ts';
export { buscarEnOsm } from './osm.ts';
export type { Local } from './osm.ts';
export type { Avance, Hallazgo } from './explorador.ts';

export const RADIO_KM = 30;
/**
 * Siempre una muestra, nunca el catastro completo:
 * reparto: cada 6 km se busca en un cuadrado de 1,5 km y se toman 8 locales (~100 celdas, la zona entera en ~25 min);
 * acumulando: celdas de 2 km con 12 locales cada una, del MUT hacia afuera (~780 celdas, unas 3 horas).
 */
const RECORRIDO = { reparto: { ladoKm: 6, cajaKm: 1.5, porCelda: 8 }, acumulando: { ladoKm: 2, porCelda: 12 } };
const ESPERA_MS = 15_000;
/** Muestra ya recorrida, versionada en el repo (la arma `scripts/explorar-locales.ts`). */
export const ARCHIVO_LOCALES = 'data/locales-mut.json';
export const CELDAS = recorrido(MUT, RADIO_KM, RECORRIDO);

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
  const sembrados = await sembrarDesdeArchivo(almacen, ARCHIVO_LOCALES);
  if (sembrados) console.warn(`[locales] ${sembrados} locales cargados desde ${ARCHIVO_LOCALES}`);

  const explorador = crearExplorador({
    almacen,
    celdas: CELDAS,
    buscar: buscarEnOsm,
    esperaMs: Number(env.LOCALES_ESPERA_MS) || ESPERA_MS,
    alAvanzar: emitir,
    registrar: m => console.warn(m),
  });
  if (env.LOCALES_EXPLORAR !== '0') {
    explorador.iniciar().catch(error => console.error('[locales] el explorador se detuvo', error));
  }

  const rutas = express.Router();
  rutas.get('/', async (_req, res) => {
    res.json({ locales: await almacen.todos(), avance: explorador.avance(), centro: MUT, radioKm: RADIO_KM });
  });
  return { rutas, detener: () => explorador.detener() };
}
