import type pg from 'pg';
import { crearRed } from './dominio.ts';
import type { OpcionesRed, Red } from './dominio.ts';
import { crearRepositorioMemoria, crearRepositorioPostgres } from './repositorio.ts';
import type { Repositorio } from './repositorio.ts';
import { aplicarDatosDemo, sembrarSiVacio } from './semilla.ts';
import { iniciarCompetencia } from './competencia.ts';
import { configDemo } from './config-demo.ts';
import { crearSiiFalso } from './sii.ts';
import type { PuertoSii } from './sii.ts';
import { crearAlmacenFoliosMemoria, crearAlmacenFoliosPostgres } from './folios.ts';
import type { AlmacenFolios } from './folios.ts';
import { conCacheYFila, crearConsultaContribuyenteFalsa } from './contribuyente.ts';
import type { ConsultarContribuyente } from './contribuyente.ts';
import type { Negocio } from './tipos.ts';

// API pública del dominio de la red. Fuera de server/red/ se importa solo este archivo.
export { crearRed, ErrorRed, FALTA_RUT, normalizarRubro, RUT_DE_OTRO_TELEFONO, RUT_DESCONOCIDO, SII_NO_DISPONIBLE } from './dominio.ts';
export { RUBROS } from './tipos.ts';
export type {
  OpcionesRed,
  BajadaPrecio, CodigoError, ContribuyenteDeRut, DuenoCarrito, EstadoPublico, NuevaOferta, NuevaOrden, NuevoCarrito, NuevoItem, NuevoItemCarrito,
  NuevoParticipante, NuevoProducto, NuevoProveedor, Recepcion, Red, ResultadoCarrito, ResultadoUnion,
} from './dominio.ts';
export { crearRutasRed } from './rutas.ts';
export { crearSesiones, crearSesionesPostgres, mismoSecreto } from './sesiones.ts';
export type { Sesiones } from './sesiones.ts';
export { sinTelefonos } from './publico.ts';
export { enlacePdf, nombreArchivoPdf, tokenPdf, tokenPdfValido } from './pdf-enlace.ts';
export type { SinTelefono } from './publico.ts';
export { crearRepositorioMemoria } from './repositorio.ts';
export { crearSiiFalso, receptorDelComprador } from './sii.ts';
export { conCacheYFila, crearConsultaContribuyenteFalsa } from './contribuyente.ts';
export type { ActividadEconomica, ConsultarContribuyente, DatosContribuyente, OpcionesFila } from './contribuyente.ts';
export type { CambioEstadoSii, DatosEmision, PuertoSii, ResultadoSii } from './sii.ts';
export { crearSiiReal, faltanFolios, receptoresDe } from './sii-real.ts';
export type { SiiReal } from './sii-real.ts';
export { crearAlmacenFoliosMemoria, foliosLibres, siguienteEnRango, siguienteFolio } from './folios.ts';
export type { RangoFolios } from './folios.ts';
export type { AlmacenFolios, EstadoFolio, RegistroFolio } from './folios.ts';
export { COMPETIDORES_SALA, COMPRADOR_DEMO, LICITACION_SALA, PROVEEDOR_DEMO, PROVEEDOR_SALA } from './semilla.ts';
export { iniciarCompetencia, PASO_REAL, pisosDeProducto } from './competencia.ts';
export type { Competencia, OpcionesCompetencia } from './competencia.ts';
export { configDemo } from './config-demo.ts';
export { CANTIDAD_MAXIMA } from '../../shared/red.ts';
export type { ConfigDemo, ProductoDemo } from './config-demo.ts';
export { precioVigente, productoDe, vistaLicitacion } from './compra.ts';
export type * from './tipos.ts';
export type { DocumentoImpreso } from '../sii/index.ts';

export interface OpcionesIniciarRed {
  /**
   * Consulta de RUT en el SII. Costura con la sesión compartida del portal del SII: cuando exista, se pasa aquí
   * su consulta (esta red nunca abre su propia sesión). Sin ella, la falsa. Siempre se envuelve con cache por RUT
   * y fila de 1 consulta por segundo.
   */
  consultarContribuyente?: ConsultarContribuyente;
  /** Ver `OpcionesRed.antesDeEntrar` (crédito Bando: tarjeta inscrita antes de comprar). */
  antesDeEntrar?: (n: Negocio) => void | Promise<void>;
  /** Ver `OpcionesRed.precioDeReferencia` (listas de los proveedores y Mercado Público). */
  precioDeReferencia?: OpcionesRed['precioDeReferencia'];
  existeProducto?: OpcionesRed['existeProducto'];
  aprenderProducto?: OpcionesRed['aprenderProducto'];
  mismoProducto?: OpcionesRed['mismoProducto'];
}

/**
 * Arma la red para el servidor: Postgres si hay DATABASE_URL (si falla, memoria),
 * siembra la demo si está vacía y usa el SII falso salvo que se entregue otro. Con DEMO_FICTICIOS=1 (y
 * DEMO_COMPETENCIA distinto de 0), los proveedores ficticios compiten en vivo por la compra conjunta.
 */
export async function iniciarRed(
  db: pg.Pool | null, sii?: PuertoSii | ((falso: PuertoSii) => PuertoSii), opciones: OpcionesIniciarRed = {},
): Promise<Red> {
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
  const falso = crearSiiFalso((await repo.cargar()).documentos);
  const consultarContribuyente = conCacheYFila(opciones.consultarContribuyente ?? crearConsultaContribuyenteFalsa());
  const red = await crearRed({ repo, sii: typeof sii === 'function' ? sii(falso) : sii ?? falso, consultarContribuyente, antesDeEntrar: opciones.antesDeEntrar, precioDeReferencia: opciones.precioDeReferencia, existeProducto: opciones.existeProducto,
    aprenderProducto: opciones.aprenderProducto, mismoProducto: opciones.mismoProducto });
  if (configDemo().competencia) iniciarCompetencia(red);
  return red;
}

/** Folios del SII real de un emisor en Postgres si hay base (si falla, memoria). `''` es la conexión del panel. */
export async function crearAlmacenFolios(db: pg.Pool | null, rutEmisor = ''): Promise<AlmacenFolios> {
  let folios: AlmacenFolios | null = null;
  if (db) {
    try {
      folios = await crearAlmacenFoliosPostgres(db, rutEmisor);
    } catch (error) {
      console.error('[red] no se pudo usar Postgres para los folios', error);
    }
  }
  if (!folios) {
    console.warn('[red] folios del SII en memoria: tras un reinicio vuelven al inicio del CAF y el SII rechazará los repetidos. Configura DATABASE_URL.');
    folios = crearAlmacenFoliosMemoria();
  }
  return folios;
}
