import type pg from 'pg';
import { crearRed } from './dominio.ts';
import type { Red } from './dominio.ts';
import { crearRepositorioMemoria, crearRepositorioPostgres } from './repositorio.ts';
import type { Repositorio } from './repositorio.ts';
import { aplicarTelefonosDemo, sembrarSiVacio } from './semilla.ts';
import { crearSiiFalso } from './sii.ts';
import type { PuertoSii } from './sii.ts';

// API pública del dominio de la red. Fuera de server/red/ se importa solo este archivo.
export { crearRed, ErrorRed, precioAjustado } from './dominio.ts';
export type { CodigoError, NuevaOrden, NuevoParticipante, Recepcion, Red } from './dominio.ts';
export { crearRutasRed } from './rutas.ts';
export { crearRepositorioMemoria } from './repositorio.ts';
export { crearSiiFalso } from './sii.ts';
export type { DatosEmision, PuertoSii, ResultadoSii } from './sii.ts';
export { COMPRADOR_DEMO, PROVEEDOR_DEMO } from './semilla.ts';
export type * from './tipos.ts';

/**
 * Arma la red para el servidor: Postgres si hay DATABASE_URL (si falla, memoria),
 * siembra la demo si está vacía y usa el SII falso salvo que se entregue otro.
 */
export async function iniciarRed(db: pg.Pool | null, sii?: PuertoSii): Promise<Red> {
  let repo: Repositorio = crearRepositorioMemoria();
  if (db) {
    try {
      repo = await crearRepositorioPostgres(db);
    } catch (error) {
      console.error('[red] no se pudo usar Postgres, sigo en memoria', error);
    }
  }
  await sembrarSiVacio(repo);
  await aplicarTelefonosDemo(repo);
  return crearRed({ repo, sii: sii ?? crearSiiFalso((await repo.cargar()).documentos) });
}
