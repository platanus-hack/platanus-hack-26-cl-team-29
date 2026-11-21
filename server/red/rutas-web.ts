import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { limitarPor } from '../limite.ts';
import { crearReparto, opcionesDesdeEnv, type Reparto } from '../reparto/index.ts';
import { ErrorRed, FALTA_RUT } from './dominio.ts';
import { cuerpo, nuevoComprador } from './peticion.ts';
import type { Recepcion, Red } from './dominio.ts';
import { sinTelefonos } from './publico.ts';
import { PROVEEDOR_SALA } from './semilla.ts';
import { formatearRut } from '../../shared/rut.ts';
import { mismoSecreto } from './sesiones.ts';
import type { Sesion, Sesiones } from './sesiones.ts';
import type { Negocio, OrdenCompra, Tramo } from './tipos.ts';

// Canal web, paralelo a WhatsApp: las mismas acciones y las mismas funciones del dominio.
// Comprador: sesión con su nombre y su RUT (sin teléfono); su factura sale a ese RUT. Proveedor de la sala: sesión con PROVEEDOR_CODIGO.
// Toda acción con efecto legal en el SII exige `confirmado: true` (la web muestra antes un paso de
// confirmación), igual que WhatsApp exige un sí.

export interface OpcionesWeb {
  sesiones: Sesiones;
  /** Límite por RUT para entrar sin sesión (la sala comparte la IP del wifi, así que nunca por IP). */
  porRut: RequestHandler;
  /** Rutas "Conectar mi SII" (server/conexion-sii), montadas en /proveedor/sii detrás de la sesión del proveedor. */
  conexionSii?: express.Router;
  /** Catálogo desde sus facturas (server/catalogo), en /proveedor/catalogo: recibe su id y RUT en `res.locals.proveedor`. */
  catalogo?: express.Router;
  /** Ruta de reparto del proveedor (server/reparto). Sin ella, la de OSRM y Nominatim según el entorno. */
  reparto?: Reparto;
}

interface ConSesion extends Request {
  sesion?: Sesion & { negocio: Negocio };
}

export function crearRutasWeb(red: Red, env: NodeJS.ProcessEnv, { sesiones, porRut, conexionSii, catalogo, reparto }: OpcionesWeb): express.Router {
  const rutas = express.Router();
  const rutaDeReparto = reparto ?? crearReparto(red, opcionesDesdeEnv(env));
  const id = (req: Request) => String(req.params.id);
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

  // Límites por negocio con sesión, holgados para que nadie que toca rápido los alcance. El carrito ya junta los
  // toques seguidos en un envío cada 400 ms; las acciones del proveedor que van al SII son pocas por minuto.
  const MINUTO = 60_000;
  const porNegocio = (maximo: number) => limitarPor(maximo, MINUTO, (req: ConSesion) => req.sesion?.negocio.id);
  const limitarCarrito = porNegocio(300);
  const limitarProveedor = porNegocio(30);
  const limitarRuta = porNegocio(120);
  const limitarSii = limitarPor(30, MINUTO, (req: ConSesion) => (req.method === 'GET' ? null : req.sesion?.negocio.id));
  // El ingreso del proveedor es la única ruta por IP: frena que se adivine el código y no la usa el público.
  const porIp = limitarPor(20, MINUTO, req => req.ip ?? 'sin-ip');

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

  // Solo en las respuestas al dueño (/yo, /proveedor/yo): cada documento con el enlace privado a su PDF.
  const documentosDe = (ordenes: OrdenCompra[]) => {
    const ids = new Set(ordenes.map(o => o.id));
    return red.estadoDeLaRed().documentos
      .filter(d => ids.has(d.ordenId))
      .map(d => {
        const pdfUrl = red.enlacePdf(d);
        return pdfUrl ? { ...d, pdfUrl } : d;
      });
  };

  // ---- Comprador ----

  // Comprar exige RUT: sin él (sesión anterior a este cambio) no se arma carrito; se vuelve a entrar con /sesion.
  const exigirRut = (n: Negocio) => {
    if (!n.rut) throw new ErrorRed('datos_invalidos', FALTA_RUT);
  };

  // Crea un negocio comprador con su nombre y su RUT (consultado en el SII); si el pedido ya trae una sesión
  // válida de comprador, la reusa (y si trae un RUT, se lo deja).
  rutas.post('/sesion', porRut, async (req, res) => {
    const b = cuerpo(req);
    const rut = typeof b.rut === 'string' && b.rut.trim() ? b.rut : undefined;
    const actual = sesionDe(req);
    if (actual?.rol === 'comprador') {
      if (!rut && !actual.negocio.rut) throw new ErrorRed('datos_invalidos', FALTA_RUT);
      const negocio = rut ? await red.registrarComprador({ negocioId: actual.negocio.id, nombre: actual.negocio.nombre, rut }) : actual.negocio;
      res.json({ token: tokenDe(req), negocio: sinTelefonos(negocio) });
      return;
    }
    if (!rut) throw new ErrorRed('datos_invalidos', FALTA_RUT);
    const negocio = await red.registrarComprador(nuevoComprador(b, rut));
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
    // A quién sale su factura: solo a su dueño (nunca en la foto pública ni en eventos).
    const c = negocio.contribuyente;
    const facturaA = negocio.rut && c
      ? { rut: formatearRut(negocio.rut), razonSocial: c.razonSocial, giro: c.giro, comuna: c.comuna, ...(c.simulado ? { simulado: true } : {}) }
      : null;
    res.json({ negocio: sinTelefonos(negocio), facturaA, ordenes, documentos: documentosDe(ordenes), participaciones });
  });

  rutas.post('/yo/unirse', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    exigirRut(yo(req));
    const b = cuerpo(req);
    res.json(await red.unirseALicitacion(String(b.licitacionId ?? ''), {
      negocioId: yo(req).id, cantidad: Number(b.cantidad), ...(typeof b.productoId === 'string' ? { productoId: b.productoId } : {}),
    }));
  });

  // El carrito completo de la compra conjunta: cantidad 0 quita un ítem y un carrito vacío sale.
  rutas.put('/yo/carrito', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    exigirRut(yo(req));
    const b = cuerpo(req);
    if (!Array.isArray(b.items)) throw new ErrorRed('datos_invalidos', 'items debe ser una lista de { productoId, cantidad }');
    res.json(await red.actualizarCarrito(String(b.licitacionId ?? ''), { negocioId: yo(req).id, items: b.items as never }));
  });

  rutas.delete('/yo/carrito/:id', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    res.json(await red.salirDeLicitacion(id(req), { negocioId: yo(req).id }));
  });

  rutas.post('/yo/ordenes', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    const b = cuerpo(req);
    res.status(201).json(await red.crearOrden({ compradorId: yo(req).id, proveedorId: String(b.proveedorId ?? ''), items: b.items as never }));
  });

  rutas.post('/yo/ordenes/:id/recepcion', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    ordenPropia(id(req), 'compradorId', yo(req).id);
    exigirConfirmado(req);
    const b = cuerpo(req);
    const recepcion: Recepcion = b.conforme === true ? { conforme: true } : { faltante: Number(b.faltante) };
    res.json(await red.registrarRecepcion(id(req), recepcion));
  });

  // ---- Proveedor de la sala ----

  rutas.post('/proveedor/sesion', porIp, (req, res) => {
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

  // Su ruta de reparto: los negocios que esperan su pedido, en orden, con su guía de despacho. Solo para él.
  rutas.get('/proveedor/ruta', exigir('proveedor'), limitarRuta, async (req: ConSesion, res) => {
    res.json(await rutaDeReparto(yo(req).id));
  });

  rutas.post('/proveedor/ruta/guias', exigir('proveedor'), limitarProveedor, async (req: ConSesion, res) => {
    exigirConfirmado(req);
    res.status(201).json(await red.emitirGuiasDeReparto(yo(req).id));
  });

  function licitacionPropia(req: ConSesion) {
    const l = red.estadoDeLaRed().licitaciones.find(x => x.id === id(req));
    if (!l) throw new ErrorRed('no_encontrado', `No existe la licitación ${id(req)}`);
    if (l.proveedorId !== yo(req).id) throw new ErrorRed('prohibido', 'Esa compra conjunta no es tuya');
    return l.id;
  }

  rutas.post('/proveedor/licitacion/:id/cerrar', exigir('proveedor'), limitarProveedor, async (req: ConSesion, res) => {
    res.json(await red.cerrarLicitacion(licitacionPropia(req)));
  });

  rutas.post('/proveedor/licitacion/:id/facturar', exigir('proveedor'), limitarProveedor, async (req: ConSesion, res) => {
    const licitacionId = licitacionPropia(req);
    exigirConfirmado(req);
    res.json(await red.confirmarOrdenesDeLicitacion(licitacionId));
  });

  // Sus tramos por volumen, mientras la compra está abierta. El dominio exige que el producto sea suyo.
  rutas.put('/proveedor/licitacion/:id/productos/:productoId/tramos', exigir('proveedor'), limitarProveedor, async (req: ConSesion, res) => {
    const r = await red.fijarTramos(id(req), String(req.params.productoId), yo(req).id, cuerpo(req).tramos as Tramo[]);
    res.json(sinTelefonos(r));
  });

  rutas.post('/proveedor/ordenes/:id/confirmar', exigir('proveedor'), limitarProveedor, async (req: ConSesion, res) => {
    ordenPropia(id(req), 'proveedorId', yo(req).id);
    exigirConfirmado(req);
    res.json(await red.confirmarOrden(id(req)));
  });

  rutas.post('/proveedor/ordenes/:id/nota-credito', exigir('proveedor'), limitarProveedor, async (req: ConSesion, res) => {
    ordenPropia(id(req), 'proveedorId', yo(req).id);
    exigirConfirmado(req);
    res.status(201).json(await red.emitirNotaCredito(id(req)));
  });

  if (conexionSii) rutas.use('/proveedor/sii', exigir('proveedor'), limitarSii, conexionSii);
  if (catalogo) {
    rutas.use('/proveedor/catalogo', exigir('proveedor'), porNegocio(60), (req: ConSesion, res: Response, next: NextFunction) => {
      res.locals.proveedor = { id: yo(req).id, ...(yo(req).rut ? { rut: yo(req).rut } : {}) };
      next();
    }, catalogo);
  }

  return rutas;
}
