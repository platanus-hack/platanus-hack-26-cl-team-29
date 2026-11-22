import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { configDemo } from './config-demo.ts';
import { PROVEEDOR_SALA } from './semilla.ts';
import { ErrorRed } from './dominio.ts';
import type { CodigoError, Red } from './dominio.ts';
import { generarPdf } from '../sii/index.ts';
import { nombreArchivoPdf, tokenPdfValido } from './pdf-enlace.ts';
import { crearRutasWeb } from './rutas-web.ts';
import type { EnvioCodigo } from './rutas-web.ts';
import { crearCodigosAcceso } from './acceso.ts';
import { crearSesiones, mismoSecreto } from './sesiones.ts';
import { limitarPor } from '../limite.ts';
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
  falta_tarjeta: 402,
};

export interface OpcionesRutas {
  sesiones?: Sesiones;
  /** Manda el código de acceso por WhatsApp. Sin él (tests), ningún código sale y nadie entra a la web. */
  enviarCodigo?: (telefono: string, texto: string) => Promise<EnvioCodigo>;
  /** Rutas "Conectar mi SII" del proveedor (server/conexion-sii). */
  conexionSii?: express.Router;
  /** Catálogo del proveedor armado desde sus facturas (server/catalogo): el del panel y la ruta de operación del equipo. */
  catalogo?: { proveedor: express.Router; operacion: express.Router };
  /** La biblioteca de productos (server/catalogo/biblioteca.ts), para sugerir al escribir uno nuevo. */
  biblioteca?: { buscar(q: string): readonly { nombre: string; unidad: string }[] };
}

/** Rutas `/api/red` del contrato. Requiere `express.json()` montado antes. */
export function crearRutasRed(red: Red, env: NodeJS.ProcessEnv = process.env, opciones: OpcionesRutas = {}): express.Router {
  const rutas = express.Router();
  const id = (req: Request) => String(req.params.id);
  // Las acciones del presentador comparten un solo token: el límite es para el token, no para cada IP.
  const limitarDemo = limitarPor(20, 60_000, () => 'demo');

  // Acciones de escenario (reiniciar, cerrar o confirmar la compra si falla WhatsApp), protegidas con DEMO_TOKEN.
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

  rutas.post('/demo/reiniciar', exigirTokenDemo, limitarDemo, async (_req, res) => {
    res.json(await red.reiniciarDemo());
  });

  // Cierre de escenario desde el panel del presentador. El proveedor cierra su compra con sesión (rutas-web.ts).
  rutas.post('/licitaciones/:id/cerrar', exigirTokenDemo, limitarDemo, async (req, res) => {
    res.json(await red.cerrarLicitacion(id(req)));
  });

  // Respaldo de escenario si WhatsApp falla: el sí del proveedor dado desde la consola.
  rutas.post('/licitaciones/:id/confirmar', exigirTokenDemo, limitarDemo, async (req, res) => {
    res.json(await red.confirmarOrdenesDeLicitacion(id(req)));
  });

  // Sugerencias al escribir un producto (proveedor en su lista, comprador al iniciar una compra): los que ya existen en
  // la plataforma, con su unidad. Solo nombres de productos, sin datos de nadie.
  rutas.get('/productos', (req, res) => {
    res.json({ productos: opciones.biblioteca?.buscar(String(req.query.q ?? '')) ?? [] });
  });

  // Carga de XML de facturas de un proveedor, que hace el equipo (server/catalogo/rutas.ts).
  if (opciones.catalogo) rutas.use('/operacion/catalogo', exigirTokenDemo, limitarDemo, opciones.catalogo.operacion);

  // Operación del equipo con DEMO_TOKEN, para destrabar la demo sin el teléfono de nadie:
  // - /operacion/sii?proveedor=<id>: las mismas rutas "Conectar mi SII" (estado, folios por tipo, "Traer más folios")
  //   con la conexión de ese proveedor; por defecto, el proveedor de la compra conjunta de la demo.
  // - POST /operacion/sesion { negocioId }: una sesión web como ese negocio, para usar la API como él en una emergencia.
  const sesiones = opciones.sesiones ?? crearSesiones();
  const negocioDeOperacion = (id: unknown) => {
    const n = red.negocioPorId(typeof id === 'string' && id ? id : PROVEEDOR_SALA);
    if (!n) throw new ErrorRed('no_encontrado', 'No existe ese negocio.');
    return n;
  };
  if (opciones.conexionSii) {
    rutas.use('/operacion/sii', exigirTokenDemo, limitarDemo, (req: Request, res: Response, next: NextFunction) => {
      const n = negocioDeOperacion(req.query.proveedor);
      res.locals.proveedor = { id: n.id, ...(n.rut ? { rut: n.rut } : {}), ...(n.vende ? { vende: true } : {}) };
      res.locals.operacion = true;
      next();
    }, opciones.conexionSii);
  }
  rutas.post('/operacion/sesion', exigirTokenDemo, limitarDemo, (req, res) => {
    const n = negocioDeOperacion((req.body as { negocioId?: unknown } | undefined)?.negocioId);
    console.warn(`[operacion] sesión abierta con DEMO_TOKEN como ${n.id}`);
    res.status(201).json({ token: sesiones.crear({ negocioId: n.id }), negocioId: n.id });
  });

  rutas.use(crearRutasWeb(red, env, {
    sesiones, codigos: crearCodigosAcceso(),
    enviarCodigo: opciones.enviarCodigo ?? (async () => 'fallido'),
    conexionSii: opciones.conexionSii, catalogo: opciones.catalogo?.proveedor,
  }));

  rutas.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    // Lo que falla al emitir o al hablar con el SII se anota (sin datos personales): la pantalla lo muestra, el log lo explica.
    const delSii = /\/(confirmar|facturar|nota-credito|recepcion|guias)\b/.test(req.path);
    if (delSii) console.warn(`[red] ${req.method} ${req.path}: ${error instanceof Error ? error.message : String(error)}`);
    if (!(error instanceof ErrorRed)) return next(error);
    res.status(ESTADO_HTTP[error.codigo]).json({ error: error.codigo, mensaje: error.message });
  });

  return rutas;
}
