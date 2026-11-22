import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { EstadoConexionSii } from '../../shared/conexion-sii.ts';
import { ErrorConexion } from './conexion.ts';
import type { ConexionSii } from './conexion.ts';

// Rutas /api/red/proveedor/sii. Se montan detrás de la sesión del proveedor (rutas-web.ts). Ninguna respuesta lleva
// el certificado, su clave ni el XML de un CAF.

/** La conexión del proveedor de la sesión y, si la hay, la opción de usar la de la demo. */
export interface ConexionDeLaSesion {
  conexion: ConexionSii;
  demo?: { empresa: string; usando: boolean; fijar(usar: boolean): Promise<void> };
}

/**
 * `conexionDe` resuelve la conexión del proveedor de la sesión (por `res.locals.proveedor`). Con una sola conexión
 * (tests y el panel de la demo), todos usan esa.
 */
export function crearRutasConexionSii(conexionDe: ConexionSii | ((res: Response) => Promise<ConexionDeLaSesion>)): express.Router {
  const rutas = express.Router();
  const cuerpo = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
  const deLaSesion = async (res: Response): Promise<ConexionDeLaSesion> =>
    (typeof conexionDe === 'function' ? conexionDe(res) : { conexion: conexionDe });
  /** El estado de su conexión, con la opción demo si existe. */
  const estado = async (res: Response): Promise<EstadoConexionSii> => {
    const { conexion: suya, demo } = await deLaSesion(res);
    return { ...(await suya.estado()), ...(demo ? { demo: { empresa: demo.empresa, usando: demo.usando } } : {}) };
  };
  // Cada pedido trabaja con la conexión del proveedor de su sesión.
  const conexion = async (res: Response) => (await deLaSesion(res)).conexion;

  rutas.get('/', async (_req, res) => {
    res.json(await estado(res));
  });

  // Solo demo: usar (o dejar de usar) la conexión de la empresa de la demo en vez de la suya.
  rutas.post('/demo', async (req, res) => {
    const { demo } = await deLaSesion(res);
    if (!demo) throw new ErrorConexion(400, 'No hay una conexión de demo disponible.');
    await demo.fijar(cuerpo(req).usar === true);
    res.json(await estado(res));
  });

  // "Traer más folios": la misma reposición automática (reobtener primero, pedir solo lo que falta, nunca anular).
  // Con la ruta de operación del equipo (res.locals.operacion) se puede fijar `objetivo`: los folios libres a tener.
  rutas.post('/folios/:tipo', async (req, res) => {
    const objetivo = res.locals.operacion ? cuerpo(req).objetivo : undefined;
    res.json(await (await conexion(res)).traerFolios(req.params.tipo, objetivo));
  });

  rutas.post('/certificado', async (req, res) => {
    const b = cuerpo(req);
    res.json(await (await conexion(res)).subirCertificado(b.pfxBase64, b.clave, b.rutEmisor));
  });

  // Vuelve a correr la conexión automática (ficha, resolución y CAF desde el portal del SII).
  rutas.post('/automatico', async (req, res) => {
    res.json(await (await conexion(res)).conectarAutomatico(cuerpo(req).rutEmisor));
  });

  rutas.post('/empresa/consultar', async (req, res) => {
    res.json(await (await conexion(res)).consultarEmpresa(cuerpo(req).rutEmisor));
  });

  rutas.put('/empresa', async (req, res) => {
    res.json(await (await conexion(res)).guardarEmpresa(cuerpo(req)));
  });

  rutas.post('/caf', async (req, res) => {
    res.json(await (await conexion(res)).subirCaf(cuerpo(req).xmlBase64));
  });

  rutas.post('/caf/:tipo/folio', async (req, res) => {
    res.json(await (await conexion(res)).fijarFolio(req.params.tipo, cuerpo(req).folio));
  });

  rutas.delete('/', async (_req, res) => {
    res.json(await (await conexion(res)).desconectar());
  });

  rutas.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ErrorConexion)) return next(error);
    res.status(error.status).json({ error: 'conexion_sii', mensaje: error.message });
  });

  return rutas;
}
