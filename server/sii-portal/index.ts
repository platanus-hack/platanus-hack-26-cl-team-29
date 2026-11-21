// Portal web del SII: API pública del módulo. Todo lo que toca el portal (ficha, resolución, folios) pasa por
// `PortalSii`, que maneja la sesión única por certificado. Fuera de server/sii-portal/ se importa solo este archivo.
import type pg from 'pg';
import { llaveDesdeEnv } from '../conexion-sii/cifrado.ts';
import { crearAlmacenSesionesMemoria, crearAlmacenSesionesPostgres, type AlmacenSesiones } from './almacen.ts';
import { crearCandadoMemoria, crearCandadoPostgres, type Candado } from './candado.ts';
import { crearPortalSii, type Log, type PortalSii } from './portal.ts';

export { crearPortalSii, credencialDe, ESPERA_LIMITE_MS } from './portal.ts';
export type { CertificadoPortal, PortalSii, SesionPortal, Captura, OpcionesPortal } from './portal.ts';
export { crearAlmacenSesionesMemoria, crearAlmacenSesionesPostgres } from './almacen.ts';
export type { AlmacenSesiones, RegistroSesion, RegistroEspera } from './almacen.ts';
export { crearCandadoMemoria, crearCandadoPostgres } from './candado.ts';
export { crearLimitador, INTERVALO_FOLIOS_MS } from './ritmo.ts';
export { ErrorPortal, esErrorPortal } from './errores.ts';
export type { CodigoPortal } from './errores.ts';
export { consultarFicha, leerFicha, separarDomicilio } from './empresa.ts';
export { consultarResolucion, leerResolucion } from './mantenedor.ts';
export type { Resolucion } from './mantenedor.ts';
export { consultarTope, listarReobtenibles, pedirCaf, reobtenerCaf, leerRangos } from './folios.ts';
export type { RangoFolios, TopeFolios } from './folios.ts';
export type { Http, RespuestaHttp } from './http.ts';

/**
 * Portal del servidor: con Postgres y SII_LLAVE_CIFRADO la sesión se guarda cifrada en la base (sobrevive a reinicios y
 * despliegues) y el candado es un advisory lock (vale entre instancias). Sin base o sin llave, todo queda en memoria
 * con un aviso: cada reinicio costará un login, que cuenta contra el cupo de sesiones del SII.
 */
export async function iniciarPortalSii(db: pg.Pool | null, env: NodeJS.ProcessEnv = process.env, log: Log = console): Promise<PortalSii> {
  let almacen: AlmacenSesiones | null = null;
  let candado: Candado = crearCandadoMemoria();
  if (db) {
    candado = crearCandadoPostgres(db);
    try {
      almacen = await crearAlmacenSesionesPostgres(db, llaveDesdeEnv(env));
    } catch (error) {
      log.warn(`[sii-portal] la sesión del SII no se puede guardar en Postgres (${(error as Error).message}); queda en memoria.`);
    }
  }
  if (!almacen) {
    log.warn('[sii-portal] sesión del portal del SII en memoria: cada reinicio o despliegue hará un login nuevo, y cada login cuenta contra el cupo de sesiones del SII. Configura DATABASE_URL y SII_LLAVE_CIFRADO.');
    almacen = crearAlmacenSesionesMemoria();
  }
  return crearPortalSii({ almacen, candado, log });
}
