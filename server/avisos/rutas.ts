import express from 'express';
import type { Request } from 'express';
import { limitarPor } from '../limite.ts';
import type { Red, Sesiones } from '../red/index.ts';
import type { Avisos } from './index.ts';

// Rutas `/api/avisos`: la invitación del comprador con sesión web (la misma sesión de /app y /unirse) y, en público,
// quién invitó a quién (solo nombres e ids de negocio). Requiere `express.json()` montado antes.

export function crearRutasAvisos(avisos: Avisos, red: Pick<Red, 'negocioPorId'>, sesiones: Sesiones): express.Router {
  const rutas = express.Router();
  const comprador = (req: Request) => {
    const s = sesiones.buscar(/^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1]);
    const n = s?.rol === 'comprador' ? red.negocioPorId(s.negocioId) : null;
    return n?.rut ? n : null;
  };
  // Pedir la invitación puede crear un código: límite por negocio, nunca por IP (la sala comparte el wifi).
  const porNegocio = limitarPor(20, 60_000, req => comprador(req)?.id);
  const sinSesion = { error: 'no_autorizado', mensaje: 'Necesitas iniciar sesión' };

  rutas.get('/invitacion', porNegocio, async (req, res) => {
    const n = comprador(req);
    if (!n) return void res.status(401).json(sinSesion);
    res.json(await avisos.invitacionWeb(n));
  });

  rutas.post('/invitado', porNegocio, async (req, res) => {
    const n = comprador(req);
    if (!n) return void res.status(401).json(sinSesion);
    const ref = typeof req.body?.ref === 'string' ? req.body.ref : '';
    res.json({ invitado: ref ? await avisos.invitadoWeb(n, ref) : false });
  });

  rutas.get('/invitaciones', (_req, res) => {
    res.json(avisos.invitaciones());
  });

  return rutas;
}
