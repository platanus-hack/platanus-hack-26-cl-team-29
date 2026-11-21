import type pg from 'pg';
import { crearRed } from './dominio.ts';
import type { Red } from './dominio.ts';
import { crearRepositorioMemoria, crearRepositorioPostgres } from './repositorio.ts';
import type { Repositorio } from './repositorio.ts';
import { aplicarDatosDemo, sembrarSiVacio } from './semilla.ts';
import { iniciarCompetencia } from './competencia.ts';
import { configDemo } from './config-demo.ts';
import { crearSiiFalso } from './sii.ts';
import type { PuertoSii } from './sii.ts';
import { crearSii } from '../sii/index.ts';
import { crearAlmacenFoliosMemoria, crearAlmacenFoliosPostgres } from './folios.ts';
import type { AlmacenFolios } from './folios.ts';
import { crearSiiReal } from './sii-real.ts';
import type { SiiReal } from './sii-real.ts';

// API pública del dominio de la red. Fuera de server/red/ se importa solo este archivo.
export { crearRed, ErrorRed, precioAjustado } from './dominio.ts';
export type { CodigoError, EstadoPublico, NuevaOferta, NuevaOrden, NuevoItem, NuevoParticipante, Recepcion, Red } from './dominio.ts';
export { normalizarProducto, PRODUCTOS_DISPONIBLES } from './catalogo.ts';
export { crearRutasRed } from './rutas.ts';
export { sinTelefonos } from './publico.ts';
export type { SinTelefono } from './publico.ts';
export { crearRepositorioMemoria } from './repositorio.ts';
export { crearSiiFalso } from './sii.ts';
export type { CambioEstadoSii, DatosEmision, PuertoSii, ResultadoSii } from './sii.ts';
export { crearSiiReal } from './sii-real.ts';
export type { SiiReal } from './sii-real.ts';
export { crearAlmacenFoliosMemoria } from './folios.ts';
export type { AlmacenFolios, EstadoFolio, RegistroFolio } from './folios.ts';
export { COMPETIDORES_SALA, COMPRADOR_DEMO, LICITACION_SALA, PROVEEDOR_DEMO, PROVEEDOR_SALA } from './semilla.ts';
export { iniciarCompetencia, PASO_REAL } from './competencia.ts';
export type { Competencia, OpcionesCompetencia } from './competencia.ts';
export { CANTIDAD_MAXIMA, configDemo } from './config-demo.ts';
export type { ConfigDemo } from './config-demo.ts';
export { precioPorVolumen, precioVigente, siguienteTramo, vistaLicitacion } from './compra.ts';
export type * from './tipos.ts';

/**
 * Arma la red para el servidor: Postgres si hay DATABASE_URL (si falla, memoria),
 * siembra la demo si está vacía y usa el SII falso salvo que se entregue otro. Con DEMO_COMPETENCIA
 * distinto de 0, los proveedores ficticios compiten en vivo por la compra conjunta.
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
  await aplicarDatosDemo(repo);
  const red = await crearRed({ repo, sii: sii ?? crearSiiFalso((await repo.cargar()).documentos) });
  if (configDemo().competencia) iniciarCompetencia(red);
  return red;
}

/**
 * SII real (certificación) para la red, con los folios en Postgres si hay base (si falla, memoria).
 * Se usa solo cuando hay SII_PFX_BASE64; sin él la red sigue con su SII falso.
 */
export async function conectarSiiReal(db: pg.Pool | null): Promise<SiiReal> {
  let folios: AlmacenFolios | null = null;
  if (db) {
    try {
      folios = await crearAlmacenFoliosPostgres(db);
    } catch (error) {
      console.error('[red] no se pudo usar Postgres para los folios', error);
    }
  }
  if (!folios) {
    console.warn('[red] folios del SII en memoria: tras un reinicio vuelven al inicio del CAF y el SII rechazará los repetidos. Configura DATABASE_URL.');
    folios = crearAlmacenFoliosMemoria();
  }
  return crearSiiReal({ sii: crearSii(), folios });
}
