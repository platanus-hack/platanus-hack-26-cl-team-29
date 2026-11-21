import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { configDemo } from './config-demo.ts';
import { ErrorRed } from './dominio.ts';
import type { CodigoError, Recepcion, Red } from './dominio.ts';
import { sinTelefonos } from './publico.ts';
import { crearRutasWeb } from './rutas-web.ts';
import { crearLimitador, crearSesiones, mismoSecreto } from './sesiones.ts';
import type { Sesiones } from './sesiones.ts';

const ESTADO_HTTP: Record<CodigoError, number> = {
  datos_invalidos: 400,
  confirmacion_requerida: 400,
  no_autorizado: 401,
  prohibido: 403,
  no_encontrado: 404,
  transicion_invalida: 409,
  ocupado: 409,
};

export interface OpcionesRutas {
  sesiones?: Sesiones;
  /** Pedidos por IP y minuto a los endpoints públicos que crean cosas (sesiones y uniones). */
  limitePorMinuto?: number;
}

/** Rutas `/api/red` del contrato. Requiere `express.json()` montado antes. */
export function crearRutasRed(red: Red, env: NodeJS.ProcessEnv = process.env, opciones: OpcionesRutas = {}): express.Router {
  const rutas = express.Router();
  const id = (req: Request) => String(req.params.id);
  const cuerpo = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
  const limitador = crearLimitador(opciones.limitePorMinuto ?? 120, 60_000);
  const limitar = (req: Request, res: Response, next: NextFunction) => {
    if (limitador(req.ip ?? 'sin-ip')) return next();
    res.status(429).json({ error: 'demasiados_pedidos', mensaje: 'Demasiados pedidos seguidos, espera un momento' });
  };

  // Acciones de escenario (reiniciar, confirmar la compra si falla WhatsApp), protegidas con DEMO_TOKEN.
  // Sin la variable la ruta no existe (404).
  const exigirTokenDemo = (req: Request, res: Response, next: NextFunction) => {
    if (!env.DEMO_TOKEN) {
      res.status(404).json({ error: 'no_encontrado', mensaje: 'Ruta no disponible' });
      return;
    }
    if (!mismoSecreto(req.get('x-demo-token'), env.DEMO_TOKEN)) {
      res.status(403).json({ error: 'token_invalido', mensaje: 'x-demo-token no coincide con DEMO_TOKEN' });
      return;
    }
    next();
  };

  rutas.get('/estado', (_req, res) => {
    res.json(red.estadoPublico());
  });

  rutas.get('/config', (_req, res) => {
    const c = configDemo(env);
    res.json({ whatsappNumero: c.whatsappNumero, producto: c.producto, unidad: c.unidad, unidadPlural: c.unidadPlural });
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

  // Página del QR sin sesión: solo público anónimo (nombre, comuna). Un negocio usa /yo/unirse con su sesión;
  // aquí no se acepta `negocioId` ni `telefono`, para que nadie cambie la cantidad de otro.
  rutas.post('/licitaciones/:id/unirse', limitar, async (req, res) => {
    const b = cuerpo(req);
    res.json(await red.unirseALicitacion(id(req), {
      nombre: typeof b.nombre === 'string' ? b.nombre : undefined,
      comuna: typeof b.comuna === 'string' ? b.comuna : undefined,
      cantidad: Number(b.cantidad),
    }));
  });

  rutas.post('/demo/reiniciar', exigirTokenDemo, async (_req, res) => {
    res.json(await red.reiniciarDemo());
  });

  rutas.post('/licitaciones/:id/ofertas', async (req, res) => {
    const b = cuerpo(req);
    res.json(sinTelefonos(await red.ofertar(id(req), {
      proveedorId: String(b.proveedorId ?? ''), precioUnitario: Number(b.precioUnitario), plazoDias: Number(b.plazoDias),
    })));
  });

  rutas.post('/licitaciones/:id/cerrar', async (req, res) => {
    res.json(await red.cerrarLicitacion(id(req)));
  });

  // Respaldo de escenario si WhatsApp falla: el sí del proveedor dado desde la consola.
  rutas.post('/licitaciones/:id/confirmar', exigirTokenDemo, async (req, res) => {
    res.json(await red.confirmarOrdenesDeLicitacion(id(req)));
  });

  rutas.use(crearRutasWeb(red, env, { sesiones: opciones.sesiones ?? crearSesiones(), limitar }));

  rutas.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ErrorRed)) return next(error);
    res.status(ESTADO_HTTP[error.codigo]).json({ error: error.codigo, mensaje: error.message });
  });

  return rutas;
}
