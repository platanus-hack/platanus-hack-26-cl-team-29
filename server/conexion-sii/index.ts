// "Conectar mi SII": API pública del módulo. Fuera de server/conexion-sii/ se importa solo este archivo.
import type express from 'express';
import type pg from 'pg';
import { crearAlmacenFolios, crearSiiReal } from '../red/index.ts';
import type { PuertoSii } from '../red/index.ts';
import { crearConsultaDocumentos, crearSii } from '../sii/index.ts';
import { crearAlmacenConexionMemoria, crearAlmacenConexionPostgres } from './almacen.ts';
import type { AlmacenConexion } from './almacen.ts';
import { crearConexionSii } from './conexion.ts';
import type { ConexionSii } from './conexion.ts';
import { crearLectorPortal } from './portal.ts';
import { crearRutasConexionSii } from './rutas.ts';
import { crearSiiConmutable } from './sii-conmutable.ts';

export { crearConexionSii, ErrorConexion } from './conexion.ts';
export type { ConexionSii, EstadoConexion, EstadoCaf, OpcionesConexion } from './conexion.ts';
export { crearAlmacenConexionMemoria } from './almacen.ts';
export { crearRutasConexionSii } from './rutas.ts';
export { crearSiiConmutable } from './sii-conmutable.ts';
export { buscarPrimerLibre } from './primer-libre.ts';
export { cifrar, descifrar, llaveDesdeEnv } from './cifrado.ts';
export { leerFicha } from './portal.ts';

export interface ConexionSiiDelServidor {
  conexion: ConexionSii;
  rutas: express.Router;
  /** Para `iniciarRed`: envuelve el SII falso de la red con el que corresponda en cada emisión. */
  sii: (falso: PuertoSii) => PuertoSii;
}

/**
 * Arma la conexión para el servidor: Postgres si hay base (si falla, memoria), lector del portal y QueryEstDte reales.
 * El SII por variables de entorno (SII_PFX_BASE64) queda de respaldo mientras la conexión de la app esté incompleta.
 */
export async function iniciarConexionSii(db: pg.Pool | null, env: NodeJS.ProcessEnv = process.env): Promise<ConexionSiiDelServidor> {
  const folios = await crearAlmacenFolios(db);
  let almacen: AlmacenConexion | null = null;
  if (db) {
    try {
      almacen = await crearAlmacenConexionPostgres(db);
    } catch (error) {
      console.error('[conexion-sii] no se pudo usar Postgres, la conexión queda en memoria', error);
    }
  }
  if (!almacen) {
    console.warn('[conexion-sii] conexión con el SII en memoria: se pierde al reiniciar. Configura DATABASE_URL.');
    almacen = crearAlmacenConexionMemoria();
  }
  const conexion = crearConexionSii({
    almacen,
    env,
    leerEmpresa: crearLectorPortal(),
    crearConsulta: (pfx, clave, rutEmisor) => crearConsultaDocumentos({ pfx, clave }, rutEmisor),
    ultimoUsado: tipo => folios.ultimo(tipo),
  });
  const respaldo = env.SII_PFX_BASE64 ? crearSiiReal({ sii: crearSii({ env }), folios, env }) : undefined;
  return {
    conexion,
    rutas: crearRutasConexionSii(conexion),
    sii: falso => crearSiiConmutable({
      falso, respaldo, conexion, env,
      crearReal: variables => crearSiiReal({ sii: crearSii({ env: variables }), folios, env: variables }),
    }),
  };
}
