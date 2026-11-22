// "Conectar mi SII": API pública del módulo. Fuera de server/conexion-sii/ se importa solo este archivo.
import { explicarRechazoSii } from '../../shared/sii-rechazos.ts';
import type express from 'express';
import type { Response } from 'express';
import type pg from 'pg';
import { crearAlmacenFolios, crearSiiReal } from '../red/index.ts';
import type { ConsultarContribuyente, DatosContribuyente } from '../red/contribuyente.ts';
import type { AlmacenFolios, EventoRed, Negocio, PuertoSii } from '../red/index.ts';
import type { EstadoConexionSii } from '../../shared/conexion-sii.ts';
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
import type { ConexionDeLaSesion } from './rutas.ts';
import { crearDemoSii } from './demo.ts';
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
  /** La conexión del panel web (la del proveedor de la demo con ficticios). */
  conexion: ConexionSii;
  /**
   * Conecta el SII de un proveedor registrado por WhatsApp con su certificado: guarda el certificado en la conexión
   * de su empresa y parte la conexión automática (ficha, resolución y folios), en segundo plano.
   */
  conectarProveedor(rutEmpresa: string, certificado: { pfx: Buffer; clave: string }): Promise<EstadoConexionSii>;
  /** Estado de la conexión de la empresa de un proveedor (sin secretos). */
  estadoDeProveedor(rutEmpresa: string): Promise<EstadoConexionSii>;
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
 * Arma las conexiones para el servidor: Postgres si hay base (si falla, memoria), el portal del SII con una sesión por
 * certificado (server/sii-portal) y QueryEstDte reales. Hay una conexión por empresa: la del panel web y una por cada
 * proveedor que conectó su certificado por WhatsApp. Cada documento sale con la conexión de quien lo emite; sin una
 * completa, con el SII falso. Solo SII_LLAVE_CIFRADO viene del entorno (cifra lo que se guarda).
 */
export async function iniciarConexionSii(db: pg.Pool | null, env: NodeJS.ProcessEnv = process.env): Promise<ConexionSiiDelServidor> {
  const portal = await iniciarPortalSii(db, env);
  const portalConexion = crearPortalConexion(portal);
  const foliosDe = new Map<ConexionSii, AlmacenFolios>();
  const oyentes: ((evento: EventoRed) => void)[] = [];
  let demanda: ((tipo: TipoDocumento) => number) | null = null;

  /** Una conexión con su almacén y sus folios, avisando con `sii.folios` y con la demanda de la compra abierta. */
  function crear(almacen: AlmacenConexion, folios: AlmacenFolios): ConexionSii {
    const conexion = crearConexionSii({
      almacen, env, portal: portalConexion, sesionPersistente: portal.persistente,
      crearConsulta: (pfx, clave, rutEmisor) => crearConsultaDocumentos({ pfx, clave }, rutEmisor),
      tomados: tipo => folios.tomados(tipo),
    });
    foliosDe.set(conexion, folios);
    conexion.folios.escuchar(aviso => { for (const o of oyentes) o({ tipo: 'sii.folios', datos: aviso, en: new Date().toISOString() }); });
    if (demanda) conexion.folios.fijarDemanda(demanda);
    return conexion;
  }

  const almacenPanel = await almacenDe(db);
  const conexion = crear(almacenPanel, await crearAlmacenFolios(db));
  const porRut = new Map<string, Promise<ConexionSii>>();
  const demo = await crearDemoSii(db);

  /**
   * La conexión de la empresa de un proveedor. Si es la misma empresa conectada desde el panel, esa (comparten folios:
   * nunca dos conexiones gastan el mismo CAF). Si no, la suya, creada la primera vez que se pide.
   */
  async function conexionDeRut(rut: string): Promise<ConexionSii> {
    if ((await almacenPanel.leer())?.rutEmisor === rut) return conexion;
    let c = porRut.get(rut);
    if (!c) {
      c = (async () => crear(await almacenDe(db, `rut:${rut}`), await crearAlmacenFolios(db, rut)))();
      porRut.set(rut, c);
      // Si falla (por ejemplo, la base), no queda guardado el fallo: el próximo pedido lo intenta de nuevo.
      c.catch(() => { if (porRut.get(rut) === c) porRut.delete(rut); });
    }
    return c;
  }

  /**
   * Quien emite: un proveedor registrado por WhatsApp usa la conexión de su empresa (o la del panel si eligió la de la
   * demo); los demás, la del panel.
   */
  const conexionDe = async (emisor: Negocio | undefined) =>
    (emisor?.vende && emisor.rut && !demo.usa(emisor.rut) ? conexionDeRut(emisor.rut) : conexion);

  /** La conexión del proveedor de la sesión del panel y, si el panel está conectado, la opción de usarla (demo). */
  async function deLaSesion(res: Response): Promise<ConexionDeLaSesion> {
    const p = res.locals.proveedor as { rut?: string; vende?: boolean } | undefined;
    if (!p?.vende || !p.rut) return { conexion };
    const rut = p.rut;
    const panel = await conexion.estado();
    const usando = demo.usa(rut);
    const opcion = panel.conectado && panel.empresa && panel.rutEmisor !== rut
      ? { demo: { empresa: panel.empresa.razonSocial, usando, fijar: (usar: boolean) => demo.fijar(rut, usar) } }
      : {};
    return { conexion: usando && opcion.demo ? conexion : await conexionDeRut(rut), ...opcion };
  }
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
    rutas: crearRutasConexionSii(deLaSesion),
    async conectarProveedor(rutEmpresa, { pfx, clave }) {
      const c = await conexionDeRut(rutEmpresa);
      // La empresa ya conectada desde el panel no se vuelve a conectar: reemplazar su certificado repetiría la
      // conexión automática (ficha, resolución y folios) en el SII sin necesidad.
      if (c === conexion) {
        const estado = await c.estado();
        if (estado.conectado) return estado;
      }
      return c.subirCertificado(pfx.toString('base64'), clave, rutEmpresa);
    },
    estadoDeProveedor: async rutEmpresa => (await conexionDeRut(rutEmpresa)).estado(),
    sii: falso => crearSiiConmutable({
      falso, conexionDe,
      crearReal: ({ sii, rangos }, c) => crearSiiReal({ sii: crearSiiConectado(sii), folios: foliosDe.get(c)!, rangos: tipo => rangos[tipo as TipoDocumento] ?? [] }),
    }),
    escuchar(oyente) {
      oyentes.push(oyente);
    },
    fijarDemanda(d) {
      demanda = d;
      for (const c of foliosDe.keys()) c.folios.fijarDemanda(d);
    },
  };
}

/**
 * La conexión en una línea para WhatsApp: si ya emite, si la conexión automática sigue corriendo, y si no, por qué
 * (el primer paso con error, con el texto del SII si lo hay).
 */
export function resumenDeConexion(e: EstadoConexionSii): { listo: boolean; enCurso: boolean; detalle: string | null; detalleSii: string | null } {
  const error = e.automatico?.pasos.find(p => p.estado === 'error');
  // Para la persona, un rechazo conocido va explicado; el texto completo del SII sigue en `detalleSii` para el log.
  const detalleSii = error ? `${error.detalle ?? 'el SII no respondió'}${error.mensajeSii ? ` (el SII dice: «${error.mensajeSii}»)` : ''}` : null;
  const detalle = explicarRechazoSii(error?.mensajeSii) ?? detalleSii;
  return { listo: e.conectado, enCurso: e.automatico?.activo ?? false, detalle, detalleSii };
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

/** Postgres si hay base (si falla, memoria). `id`: `proveedor` (el panel) o `rut:<rut>` (un proveedor por WhatsApp). */
async function almacenDe(db: pg.Pool | null, id?: string): Promise<AlmacenConexion> {
  if (db) {
    try {
      return await crearAlmacenConexionPostgres(db, id);
    } catch (error) {
      console.error('[conexion-sii] no se pudo usar Postgres, la conexión queda en memoria', error);
    }
  }
  console.warn('[conexion-sii] conexión con el SII en memoria: se pierde al reiniciar. Configura DATABASE_URL.');
  return crearAlmacenConexionMemoria();
}
