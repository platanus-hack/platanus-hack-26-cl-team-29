import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { configDemo } from './config-demo.ts';
import { ErrorRed, FALTA_RUT } from './dominio.ts';
import { cuerpo, nuevoComprador, texto } from './peticion.ts';
import type { CodigoError, Recepcion, Red } from './dominio.ts';
import { generarPdf } from '../sii/index.ts';
import { nombreArchivoPdf, tokenPdfValido } from './pdf-enlace.ts';
import { sinTelefonos } from './publico.ts';
import { crearRutasWeb } from './rutas-web.ts';
import { crearSesiones, mismoSecreto } from './sesiones.ts';
import { limitarPor } from '../limite.ts';
import { validarRut } from '../../shared/rut.ts';
import type { Sesiones } from './sesiones.ts';

const ESTADO_HTTP: Record<CodigoError, number> = {
  datos_invalidos: 400,
  confirmacion_requerida: 400,
  no_autorizado: 401,
  prohibido: 403,
  no_encontrado: 404,
  transicion_invalida: 409,
  ocupado: 409,
  sii_no_disponible: 503,
  sin_folios: 409,
};

export interface OpcionesRutas {
  sesiones?: Sesiones;
  /** Pedidos por minuto de un mismo RUT al entrar o sumarse desde la página pública (nunca por IP: la sala comparte el wifi). */
  limitePorMinuto?: number;
  /** Rutas "Conectar mi SII" del proveedor (server/conexion-sii). */
  conexionSii?: express.Router;
  /** Catálogo del proveedor armado desde sus facturas (server/catalogo): el del panel y la ruta de operación del equipo. */
  catalogo?: { proveedor: express.Router; operacion: express.Router };
}

/** Rutas `/api/red` del contrato. Requiere `express.json()` montado antes. */
export function crearRutasRed(red: Red, env: NodeJS.ProcessEnv = process.env, opciones: OpcionesRutas = {}): express.Router {
  const rutas = express.Router();
  const id = (req: Request) => String(req.params.id);
  const porRut = limitarPor(opciones.limitePorMinuto ?? 20, 60_000, req => validarRut(cuerpo(req).rut));
  // Las acciones del presentador comparten un solo token: el límite es para el token, no para cada IP.
  const limitarDemo = limitarPor(20, 60_000, () => 'demo');

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

  // PDF de un documento por su enlace privado (`enlacePdf`). Sin token válido, 404: no se distingue un
  // documento inexistente de uno ajeno.
  rutas.get('/documentos/:id/pdf', async (req, res) => {
    const encontrado = tokenPdfValido(id(req), req.query.t, env) ? red.impresoDeDocumento(id(req)) : null;
    if (!encontrado) {
      res.status(404).json({ error: 'no_encontrado', mensaje: 'Documento no encontrado' });
      return;
    }
    const pdf = await generarPdf(encontrado.impreso);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombreArchivoPdf(encontrado.documento)}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    });
    res.send(pdf);
  });

  rutas.get('/config', (_req, res) => {
    const c = configDemo(env);
    // Sin pisos ni tramos: la canasta para armar el carrito. Los campos sueltos reflejan el primer producto (compatibilidad).
    const productos = c.productos.map(({ id, nombre, unidad, unidadPlural }) => ({ id, nombre, unidad, unidadPlural }));
    res.json({ whatsappNumero: c.whatsappNumero, proveedorLogoUrl: c.proveedorLogoUrl, productos, producto: c.producto, unidad: c.unidad, unidadPlural: c.unidadPlural });
  });

  rutas.post('/ordenes', async (req, res) => {
    const b = cuerpo(req);
    res.status(201).json(await red.crearOrden({
      compradorId: String(b.compradorId ?? ''), proveedorId: String(b.proveedorId ?? ''), items: b.items as never,
    }));
  });

  rutas.post('/ordenes/:id/despacho', async (req, res) => {
    const b = cuerpo(req);
    res.json(await red.fijarDespacho(id(req), Number(b.cantidad), texto(b.producto)));
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

  // Página del QR sin sesión (nombre, comuna y RUT). Un negocio usa /yo/unirse con su sesión; aquí no se
  // acepta `negocioId` ni `telefono`, para que nadie cambie la cantidad de otro. Sin RUT válido no se suma:
  // cada factura sale al RUT de quien compra.
  rutas.post('/licitaciones/:id/unirse', porRut, async (req, res) => {
    const b = cuerpo(req);
    if (typeof b.rut !== 'string' || !b.rut.trim()) throw new ErrorRed('datos_invalidos', FALTA_RUT);
    const negocio = await red.registrarComprador(nuevoComprador(b, b.rut));
    res.json(await red.unirseALicitacion(id(req), {
      negocioId: negocio.id,
      ...(typeof b.productoId === 'string' ? { productoId: b.productoId } : {}),
      cantidad: Number(b.cantidad),
    }));
  });

  rutas.post('/demo/reiniciar', exigirTokenDemo, limitarDemo, async (_req, res) => {
    res.json(await red.reiniciarDemo());
  });

  rutas.post('/licitaciones/:id/ofertas', async (req, res) => {
    const b = cuerpo(req);
    res.json(sinTelefonos(await red.ofertar(id(req), {
      proveedorId: String(b.proveedorId ?? ''), precioUnitario: Number(b.precioUnitario), plazoDias: Number(b.plazoDias),
      ...(typeof b.productoId === 'string' ? { productoId: b.productoId } : {}),
    })));
  });

  rutas.post('/licitaciones/:id/cerrar', async (req, res) => {
    res.json(await red.cerrarLicitacion(id(req)));
  });

  // Respaldo de escenario si WhatsApp falla: el sí del proveedor dado desde la consola.
  rutas.post('/licitaciones/:id/confirmar', exigirTokenDemo, limitarDemo, async (req, res) => {
    res.json(await red.confirmarOrdenesDeLicitacion(id(req)));
  });

  // Carga de XML de facturas de un proveedor, que hace el equipo (server/catalogo/rutas.ts).
  if (opciones.catalogo) rutas.use('/operacion/catalogo', exigirTokenDemo, limitarDemo, opciones.catalogo.operacion);

  rutas.use(crearRutasWeb(red, env, {
    sesiones: opciones.sesiones ?? crearSesiones(), porRut, conexionSii: opciones.conexionSii, catalogo: opciones.catalogo?.proveedor,
  }));

  rutas.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ErrorRed)) return next(error);
    res.status(ESTADO_HTTP[error.codigo]).json({ error: error.codigo, mensaje: error.message });
  });

  return rutas;
}
