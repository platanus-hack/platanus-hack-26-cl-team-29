import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ErrorRed } from './dominio.ts';
import type { Recepcion, Red } from './dominio.ts';
import { sinTelefonos } from './publico.ts';
import { PROVEEDOR_SALA } from './semilla.ts';
import { mismoSecreto } from './sesiones.ts';
import type { Sesion, Sesiones } from './sesiones.ts';
import type { Negocio, OrdenCompra } from './tipos.ts';

// Canal web, paralelo a WhatsApp: las mismas acciones y las mismas funciones del dominio.
// Comprador: sesión con su nombre (sin teléfono). Proveedor de la sala: sesión con PROVEEDOR_CODIGO.
// Toda acción con efecto legal en el SII exige `confirmado: true` (la web muestra antes un paso de
// confirmación), igual que WhatsApp exige un sí.

export interface OpcionesWeb {
  sesiones: Sesiones;
  limitar: RequestHandler;
  /** Rutas "Conectar mi SII" (server/conexion-sii), montadas en /proveedor/sii detrás de la sesión del proveedor. */
  conexionSii?: express.Router;
}

interface ConSesion extends Request {
  sesion?: Sesion & { negocio: Negocio };
}

export function crearRutasWeb(red: Red, env: NodeJS.ProcessEnv, { sesiones, limitar, conexionSii }: OpcionesWeb): express.Router {
  const rutas = express.Router();
  const id = (req: Request) => String(req.params.id);
  const cuerpo = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
  const tokenDe = (req: Request) => /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];

  /** La sesión válida del pedido, o null. El negocio tiene que seguir existiendo (un reinicio borra el público). */
  function sesionDe(req: Request) {
    const s = sesiones.buscar(tokenDe(req));
    const negocio = s && red.negocioPorId(s.negocioId);
    return s && negocio ? { ...s, negocio } : null;
  }

  const exigir = (rol: Negocio['rol']) => (req: ConSesion, _res: Response, next: NextFunction) => {
    const s = sesionDe(req);
    if (!s || s.rol !== rol) return next(new ErrorRed('no_autorizado', 'Necesitas iniciar sesión'));
    req.sesion = s;
    next();
  };
  const yo = (req: ConSesion) => req.sesion!.negocio;

  const exigirConfirmado = (req: Request) => {
    if (cuerpo(req).confirmado !== true) {
      throw new ErrorRed('confirmacion_requerida', 'Esta acción queda registrada en el SII: confirma con confirmado: true');
    }
  };

  function ordenPropia(ordenId: string, campo: 'compradorId' | 'proveedorId', negocioId: string): OrdenCompra {
    const o = red.estadoDeLaRed().ordenes.find(x => x.id === ordenId);
    if (!o) throw new ErrorRed('no_encontrado', `No existe la orden ${ordenId}`);
    if (o[campo] !== negocioId) throw new ErrorRed('prohibido', 'Esa orden no es tuya');
    return o;
  }

  const documentosDe = (ordenes: OrdenCompra[]) => {
    const ids = new Set(ordenes.map(o => o.id));
    return red.estadoDeLaRed().documentos.filter(d => ids.has(d.ordenId));
  };

  // ---- Comprador ----

  // Crea un negocio comprador con su nombre; si el pedido ya trae una sesión válida de comprador, la reusa.
  rutas.post('/sesion', limitar, async (req, res) => {
    const actual = sesionDe(req);
    if (actual?.rol === 'comprador') {
      res.json({ token: tokenDe(req), negocio: sinTelefonos(actual.negocio) });
      return;
    }
    const b = cuerpo(req);
    const negocio = await red.registrarComprador({
      nombre: typeof b.nombre === 'string' ? b.nombre : '',
      comuna: typeof b.comuna === 'string' ? b.comuna : undefined,
      rubro: typeof b.rubro === 'string' ? b.rubro : undefined,
    });
    res.status(201).json({ token: sesiones.crear({ negocioId: negocio.id, rol: 'comprador' }), negocio: sinTelefonos(negocio) });
  });

  rutas.get('/yo', exigir('comprador'), (req: ConSesion, res) => {
    const negocio = yo(req);
    const estado = red.estadoPublico();
    const ordenes = estado.ordenes.filter(o => o.compradorId === negocio.id);
    const participaciones = estado.licitaciones.flatMap(l => l.participantes
      .filter(p => p.negocioId === negocio.id)
      .map(p => ({
        licitacionId: l.id, producto: l.producto, unidad: l.unidad, unidadPlural: l.unidadPlural, cantidad: p.cantidad,
        precioActual: l.precioActual, precioSolo: l.precioSolo, estado: l.estado, cierraEn: l.cierraEn,
        // El carrito, con el precio vigente y el de comprar solo de cada producto.
        items: p.items.map(i => {
          const producto = l.productos.find(x => x.id === i.productoId);
          return {
            productoId: i.productoId, cantidad: i.cantidad, nombre: producto?.nombre ?? '', unidad: producto?.unidad ?? '',
            unidadPlural: producto?.unidadPlural ?? '', precioActual: producto?.precioActual ?? 0, precioSolo: producto?.precioSolo ?? 0,
          };
        }),
      })));
    res.json({ negocio: sinTelefonos(negocio), ordenes, documentos: documentosDe(ordenes), participaciones });
  });

  rutas.post('/yo/unirse', limitar, exigir('comprador'), async (req: ConSesion, res) => {
    const b = cuerpo(req);
    res.json(await red.unirseALicitacion(String(b.licitacionId ?? ''), {
      negocioId: yo(req).id, cantidad: Number(b.cantidad), ...(typeof b.productoId === 'string' ? { productoId: b.productoId } : {}),
    }));
  });

  // El carrito completo de la compra conjunta: cantidad 0 quita un ítem y un carrito vacío sale.
  rutas.put('/yo/carrito', limitar, exigir('comprador'), async (req: ConSesion, res) => {
    const b = cuerpo(req);
    if (!Array.isArray(b.items)) throw new ErrorRed('datos_invalidos', 'items debe ser una lista de { productoId, cantidad }');
    res.json(await red.actualizarCarrito(String(b.licitacionId ?? ''), { negocioId: yo(req).id, items: b.items as never }));
  });

  rutas.delete('/yo/carrito/:id', limitar, exigir('comprador'), async (req: ConSesion, res) => {
    res.json(await red.salirDeLicitacion(id(req), { negocioId: yo(req).id }));
  });

  rutas.post('/yo/ordenes', exigir('comprador'), async (req: ConSesion, res) => {
    const b = cuerpo(req);
    res.status(201).json(await red.crearOrden({ compradorId: yo(req).id, proveedorId: String(b.proveedorId ?? ''), items: b.items as never }));
  });

  rutas.post('/yo/ordenes/:id/recepcion', exigir('comprador'), async (req: ConSesion, res) => {
    ordenPropia(id(req), 'compradorId', yo(req).id);
    exigirConfirmado(req);
    const b = cuerpo(req);
    const recepcion: Recepcion = b.conforme === true ? { conforme: true } : { faltante: Number(b.faltante) };
    res.json(await red.registrarRecepcion(id(req), recepcion));
  });

  // ---- Proveedor de la sala ----

  rutas.post('/proveedor/sesion', limitar, (req, res) => {
    if (!env.PROVEEDOR_CODIGO) {
      res.status(404).json({ error: 'no_encontrado', mensaje: 'Ruta no disponible' });
      return;
    }
    if (!mismoSecreto(cuerpo(req).codigo, env.PROVEEDOR_CODIGO)) throw new ErrorRed('no_autorizado', 'Código incorrecto');
    const negocio = red.negocioPorId(PROVEEDOR_SALA);
    if (!negocio) throw new ErrorRed('no_encontrado', 'No existe el proveedor de la demo');
    res.status(201).json({ token: sesiones.crear({ negocioId: negocio.id, rol: 'proveedor' }), negocio: sinTelefonos(negocio) });
  });

  rutas.get('/proveedor/yo', exigir('proveedor'), (req: ConSesion, res) => {
    const negocio = yo(req);
    const estado = red.estadoPublico();
    const ordenes = estado.ordenes.filter(o => o.proveedorId === negocio.id);
    const licitaciones = estado.licitaciones.filter(l => l.proveedorId === negocio.id);
    res.json({
      negocio: sinTelefonos(negocio),
      nota: red.notaDeProveedor(negocio.id),
      ordenes,
      documentos: documentosDe(ordenes),
      compraAbierta: licitaciones.find(l => l.estado === 'abierta') ?? null,
      licitaciones,
    });
  });

  function licitacionPropia(req: ConSesion) {
    const l = red.estadoDeLaRed().licitaciones.find(x => x.id === id(req));
    if (!l) throw new ErrorRed('no_encontrado', `No existe la licitación ${id(req)}`);
    if (l.proveedorId !== yo(req).id) throw new ErrorRed('prohibido', 'Esa compra conjunta no es tuya');
    return l.id;
  }

  rutas.post('/proveedor/licitacion/:id/cerrar', exigir('proveedor'), async (req: ConSesion, res) => {
    res.json(await red.cerrarLicitacion(licitacionPropia(req)));
  });

  rutas.post('/proveedor/licitacion/:id/facturar', exigir('proveedor'), async (req: ConSesion, res) => {
    const licitacionId = licitacionPropia(req);
    exigirConfirmado(req);
    res.json(await red.confirmarOrdenesDeLicitacion(licitacionId));
  });

  rutas.post('/proveedor/ordenes/:id/confirmar', exigir('proveedor'), async (req: ConSesion, res) => {
    ordenPropia(id(req), 'proveedorId', yo(req).id);
    exigirConfirmado(req);
    res.json(await red.confirmarOrden(id(req)));
  });

  rutas.post('/proveedor/ordenes/:id/nota-credito', exigir('proveedor'), async (req: ConSesion, res) => {
    ordenPropia(id(req), 'proveedorId', yo(req).id);
    exigirConfirmado(req);
    res.status(201).json(await red.emitirNotaCredito(id(req)));
  });

  if (conexionSii) rutas.use('/proveedor/sii', exigir('proveedor'), conexionSii);

  return rutas;
}
