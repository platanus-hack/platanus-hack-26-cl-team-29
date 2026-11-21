import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ErrorConexion } from './conexion.ts';
import type { ConexionSii } from './conexion.ts';

// Rutas /api/red/proveedor/sii. Se montan detrás de la sesión del proveedor (rutas-web.ts). Ninguna respuesta lleva
// el certificado, su clave ni el XML de un CAF.

export function crearRutasConexionSii(conexion: ConexionSii): express.Router {
  const rutas = express.Router();
  const cuerpo = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});

  rutas.get('/', async (_req, res) => {
    res.json(await conexion.estado());
  });

  // "Traer más folios": la misma reposición automática (reobtener primero, pedir solo lo que falta, nunca anular).
  rutas.post('/folios/:tipo', async (req, res) => {
    res.json(await conexion.traerFolios(req.params.tipo));
  });

  rutas.post('/certificado', async (req, res) => {
    const b = cuerpo(req);
    res.json(await conexion.subirCertificado(b.pfxBase64, b.clave, b.rutEmisor));
  });

  // Vuelve a correr la conexión automática (ficha, resolución y CAF desde el portal del SII).
  rutas.post('/automatico', async (req, res) => {
    res.json(await conexion.conectarAutomatico(cuerpo(req).rutEmisor));
  });

  rutas.post('/empresa/consultar', async (req, res) => {
    res.json(await conexion.consultarEmpresa(cuerpo(req).rutEmisor));
  });

  rutas.put('/empresa', async (req, res) => {
    res.json(await conexion.guardarEmpresa(cuerpo(req)));
  });

  rutas.post('/caf', async (req, res) => {
    res.json(await conexion.subirCaf(cuerpo(req).xmlBase64));
  });

  rutas.post('/caf/:tipo/folio', async (req, res) => {
    res.json(await conexion.fijarFolio(req.params.tipo, cuerpo(req).folio));
  });

  rutas.delete('/', async (_req, res) => {
    res.json(await conexion.desconectar());
  });

  rutas.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ErrorConexion)) return next(error);
    res.status(error.status).json({ error: 'conexion_sii', mensaje: error.message });
  });

  return rutas;
}
