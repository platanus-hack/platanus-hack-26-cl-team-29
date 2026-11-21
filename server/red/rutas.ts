import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ErrorRed } from './dominio.ts';
import type { CodigoError, Recepcion, Red } from './dominio.ts';

const ESTADO_HTTP: Record<CodigoError, number> = {
  datos_invalidos: 400,
  no_encontrado: 404,
  transicion_invalida: 409,
  ocupado: 409,
};

/** Rutas `/api/red` del contrato. Requiere `express.json()` montado antes. */
export function crearRutasRed(red: Red, env: NodeJS.ProcessEnv = process.env): express.Router {
  const rutas = express.Router();
  const id = (req: Request) => String(req.params.id);
  const cuerpo = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});

  rutas.get('/estado', (_req, res) => {
    res.json(red.estadoDeLaRed());
  });

  rutas.post('/ordenes', async (req, res) => {
    const b = cuerpo(req);
    res.status(201).json(await red.crearOrden({
      compradorId: String(b.compradorId ?? ''), proveedorId: String(b.proveedorId ?? ''), items: b.items as never,
    }));
  });

  rutas.post('/ordenes/:id/despacho', async (req, res) => {
    const b = cuerpo(req);
    res.json(await red.fijarDespacho(id(req), Number(b.cantidad), typeof b.producto === 'string' ? b.producto : undefined));
  });

  rutas.post('/ordenes/:id/confirmar', async (req, res) => {
    res.json(await red.confirmarOrden(id(req)));
  });

  rutas.post('/ordenes/:id/recepcion', async (req, res) => {
    const b = cuerpo(req);
    const recepcion: Recepcion = b.conforme === true
      ? { conforme: true }
      : { faltante: Number(b.faltante), ...(typeof b.producto === 'string' ? { producto: b.producto } : {}) };
    res.json(await red.registrarRecepcion(id(req), recepcion));
  });

  rutas.post('/ordenes/:id/nota-credito', async (req, res) => {
    res.status(201).json(await red.emitirNotaCredito(id(req)));
  });

  rutas.post('/licitaciones/:id/unirse', async (req, res) => {
    const b = cuerpo(req);
    res.json(await red.unirseALicitacion(id(req), {
      ...(typeof b.negocioId === 'string' ? { negocioId: b.negocioId } : {}),
      nombre: typeof b.nombre === 'string' ? b.nombre : undefined,
      comuna: typeof b.comuna === 'string' ? b.comuna : undefined,
      cantidad: Number(b.cantidad),
    }));
  });

  // Reinicio de la demo, protegido con DEMO_TOKEN. Sin la variable la ruta no existe (404).
  rutas.post('/demo/reiniciar', async (req, res) => {
    const token = env.DEMO_TOKEN;
    if (!token) {
      res.status(404).json({ error: 'no_encontrado', mensaje: 'Ruta no disponible' });
      return;
    }
    const enviado = Buffer.from(String(req.get('x-demo-token') ?? ''));
    const esperado = Buffer.from(token);
    if (enviado.length !== esperado.length || !timingSafeEqual(enviado, esperado)) {
      res.status(403).json({ error: 'token_invalido', mensaje: 'x-demo-token no coincide con DEMO_TOKEN' });
      return;
    }
    res.json(await red.reiniciarDemo());
  });

  rutas.post('/licitaciones/:id/ofertas', async (req, res) => {
    const b = cuerpo(req);
    res.json(await red.ofertar(id(req), {
      proveedorId: String(b.proveedorId ?? ''), precioUnitario: Number(b.precioUnitario), plazoDias: Number(b.plazoDias),
    }));
  });

  rutas.post('/licitaciones/:id/cerrar', async (req, res) => {
    res.json(await red.cerrarLicitacion(id(req)));
  });

  rutas.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ErrorRed)) return next(error);
    res.status(ESTADO_HTTP[error.codigo]).json({ error: error.codigo, mensaje: error.message });
  });

  return rutas;
}
