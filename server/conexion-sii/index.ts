// "Conectar mi SII": API pública del módulo. Fuera de server/conexion-sii/ se importa solo este archivo.
import type express from 'express';
import type pg from 'pg';
import { crearAlmacenFolios, crearSiiReal } from '../red/index.ts';
import type { ConsultarContribuyente, DatosContribuyente } from '../red/contribuyente.ts';
import type { EventoRed, PuertoSii } from '../red/index.ts';
import type { TipoDocumento } from '../../shared/documentos.ts';
import { crearConsultaDocumentos, crearSiiConectado } from '../sii/index.ts';
import { crearAlmacenConexionMemoria, crearAlmacenConexionPostgres } from './almacen.ts';
import type { AlmacenConexion } from './almacen.ts';
import { crearConexionSii } from './conexion.ts';
import type { ConexionSii } from './conexion.ts';

import { crearPortalConexion } from './portal.ts';
import { consultarContribuyentePublico, ErrorStc, iniciarPortalSii } from '../sii-portal/index.ts';
import type { ConsultaPublicaContribuyente } from '../sii-portal/index.ts';
import { crearRutasConexionSii } from './rutas.ts';
import { crearSiiConmutable } from './sii-conmutable.ts';

export { crearConexionSii, ErrorConexion } from './conexion.ts';
export type { ConexionSii, ConfiguracionEmision, OpcionesConexion } from './conexion.ts';
export { crearAlmacenConexionMemoria } from './almacen.ts';
export { crearRutasConexionSii } from './rutas.ts';
export { crearSiiConmutable } from './sii-conmutable.ts';
export { buscarPrimerLibre } from './primer-libre.ts';
export { cifrar, descifrar, llaveDesdeEnv } from './cifrado.ts';
export { leerFicha } from '../sii-portal/index.ts';
export { crearReposicion, GESTION_INICIAL, PLAZO_ANTES_DE_FACTURAR_MS } from './reposicion.ts';
export type { FuenteFolios, GestionFolios, Reposicion } from './reposicion.ts';
export { crearPortalConexion } from './portal.ts';
export type { PortalConexion } from './portal.ts';

export interface ConexionSiiDelServidor {
  conexion: ConexionSii;
  rutas: express.Router;
  /** Para `iniciarRed`: envuelve el SII falso de la red con el que corresponda en cada emisión. */
  sii: (falso: PuertoSii) => PuertoSii;
  /**
   * Para `iniciarRed`: datos de un comprador por su RUT, de la consulta pública STC del SII (sin certificado ni
   * sesión, sin dirección ni comuna).
   */
  consultarContribuyente: ConsultarContribuyente;
  /** Eventos `sii.folios` (folios bajos, reponiéndose o repuestos), con el mismo formato que `red:evento`. */
  escuchar(oyente: (evento: EventoRed) => void): void;
  /** Documentos que se esperan emitir pronto por tipo, para el mínimo de folios (la compra conjunta abierta). */
  fijarDemanda(demanda: (tipo: TipoDocumento) => number): void;
}

/**
 * Arma la conexión para el servidor: Postgres si hay base (si falla, memoria), el portal del SII con su sesión única
 * (server/sii-portal) y QueryEstDte reales. La conexión del panel es la única fuente de configuración del SII: sin
 * ella la red usa el SII falso. Solo SII_LLAVE_CIFRADO viene del entorno (cifra lo que se guarda).
 */
export async function iniciarConexionSii(db: pg.Pool | null, env: NodeJS.ProcessEnv = process.env): Promise<ConexionSiiDelServidor> {
  const folios = await crearAlmacenFolios(db);
  const portal = await iniciarPortalSii(db, env);
  const conexion = crearConexionSii({
    almacen: await almacenDe(db),
    env,
    portal: crearPortalConexion(portal),
    sesionPersistente: portal.persistente,
    crearConsulta: (pfx, clave, rutEmisor) => crearConsultaDocumentos({ pfx, clave }, rutEmisor),
    tomados: tipo => folios.tomados(tipo),
  });
  // RUT de terceros: siempre la consulta pública STC, sin certificado ni sesión. El portal con certificado no sirve
  // para terceros (falla y suma segundos por comprador). Si la STC no responde, el error llega a la red con el texto
  // del SII y el registro sigue con la dirección que declare la persona.
  const consultarContribuyente: ConsultarContribuyente = async rut => {
    try {
      return datosDeStc(await consultarContribuyentePublico(rut));
    } catch (error) {
      if (error instanceof ErrorStc && error.noRegistrado) return null;
      throw error;
    }
  };
  return {
    conexion,
    consultarContribuyente,
    rutas: crearRutasConexionSii(conexion),
    sii: falso => crearSiiConmutable({
      falso, conexion,
      crearReal: ({ sii, rangos }) => crearSiiReal({ sii: crearSiiConectado(sii), folios, rangos: tipo => rangos[tipo as TipoDocumento] ?? [] }),
    }),
    escuchar(oyente) {
      conexion.folios.escuchar(aviso => oyente({ tipo: 'sii.folios', datos: aviso, en: new Date().toISOString() }));
    },
    fijarDemanda: demanda => conexion.folios.fijarDemanda(demanda),
  };
}

/** Tope de la razón social y del giro en el DTE: se recortan aquí para no prellenar un valor que el SII rechace. */
const MAX_RAZON_SOCIAL = 100;
const MAX_GIRO = 80;

/**
 * La STC traducida a los datos de la red. Un RUT sin inicio de actividades (el SII responde `registrado: true`, nombre
 * "**" y sin giros) no puede recibir factura: null. Giros con descripción, recortados y sin repetidos, en el orden del
 * SII (el primero es el giro). La STC no trae dirección ni comuna: quedan vacías y la factura usa las que declare la
 * persona o, sin ellas, el receptor de respaldo.
 */
function datosDeStc(c: ConsultaPublicaContribuyente): DatosContribuyente | null {
  if (!c.inicioActividades || !/[\p{L}\d]/u.test(c.nombre)) return null;
  const vistos = new Set<string>();
  const actividades: DatosContribuyente['actividades'] = [];
  for (const g of c.giros) {
    const glosa = g.descripcion.trim().slice(0, MAX_GIRO);
    if (!glosa || vistos.has(glosa)) continue;
    vistos.add(glosa);
    actividades.push({ codigo: g.codigo.trim(), glosa });
  }
  return {
    razonSocial: c.nombre.trim().slice(0, MAX_RAZON_SOCIAL),
    giro: actividades[0]?.glosa ?? '',
    direccion: '',
    comuna: '',
    actividades,
  };
}

/** Postgres si hay base (si falla, memoria). */
async function almacenDe(db: pg.Pool | null): Promise<AlmacenConexion> {
  if (db) {
    try {
      return await crearAlmacenConexionPostgres(db);
    } catch (error) {
      console.error('[conexion-sii] no se pudo usar Postgres, la conexión queda en memoria', error);
    }
  }
  console.warn('[conexion-sii] conexión con el SII en memoria: se pierde al reiniciar. Configura DATABASE_URL.');
  return crearAlmacenConexionMemoria();
}
