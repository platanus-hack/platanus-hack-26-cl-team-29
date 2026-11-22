import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { limitarPor } from '../limite.ts';
import { crearReparto, opcionesDesdeEnv, type Reparto } from '../reparto/index.ts';
import { ErrorRed, FALTA_RUT } from './dominio.ts';
import { cuerpo, nuevoComprador, texto } from './peticion.ts';
import type { Recepcion, Red } from './dominio.ts';
import { sinTelefonos } from './publico.ts';
import { formatearRut, validarRut } from '../../shared/rut.ts';
import { telefonoParaWhatsapp } from '../../shared/telefono.ts';
import { puedeComprar, puedeVender } from '../../shared/red.ts';
import { crearEnlacesAcceso, mensajeDeCodigo } from './acceso.ts';
import type { CodigosAcceso, EnlacesAcceso } from './acceso.ts';
import type { Sesion, Sesiones } from './sesiones.ts';
import type { Negocio, OrdenCompra, Tramo } from './tipos.ts';
import type { DatosContribuyente } from './contribuyente.ts';

// Canal web, paralelo a WhatsApp: las mismas acciones y las mismas funciones del dominio.
// Se entra con el teléfono y un código por WhatsApp (`/acceso/*`): la sesión es del negocio de ese teléfono, que puede
// comprar, vender o ambas. Un teléfono nuevo se registra como comprador con su nombre y su RUT; su factura sale a ese RUT.
// Toda acción con efecto legal en el SII exige `confirmado: true` (la web muestra antes un paso de
// confirmación), igual que WhatsApp exige un sí.

/** Resultado de mandar el código: `retenido` si la ventana de 24 h de WhatsApp está cerrada (llega cuando la persona escriba). */
export type EnvioCodigo = 'enviado' | 'retenido' | 'fallido';

export interface OpcionesWeb {
  sesiones: Sesiones;
  codigos: CodigosAcceso;
  /** Enlaces de entrada directa que van en el mensaje del código. Sin ellos, unos en memoria. */
  enlaces?: EnlacesAcceso;
  /** Manda el texto con el código al WhatsApp del teléfono (solo dígitos, con código de país). */
  enviarCodigo: (telefono: string, texto: string) => Promise<EnvioCodigo>;
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

export function crearRutasWeb(red: Red, env: NodeJS.ProcessEnv, { sesiones, codigos, enlaces = crearEnlacesAcceso(), enviarCodigo, conexionSii, catalogo, reparto }: OpcionesWeb): express.Router {
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

  // Un mismo negocio puede comprar y vender: cada ruta pide lo que hace (`puedeComprar` / `puedeVender`), no un rol.
  const PUEDE = {
    comprador: { puede: puedeComprar, falta: 'Tu negocio no compra en la red.' },
    proveedor: { puede: puedeVender, falta: 'Tu negocio no vende en la red. Regístralo como proveedor por WhatsApp.' },
  };
  const exigir = (accion: keyof typeof PUEDE) => (req: ConSesion, _res: Response, next: NextFunction) => {
    const s = sesionDe(req);
    if (!s) return next(new ErrorRed('no_autorizado', 'Necesitas iniciar sesión'));
    if (!PUEDE[accion].puede(s.negocio)) return next(new ErrorRed('prohibido', PUEDE[accion].falta));
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
  // El acceso limita por teléfono (cuántos códigos y cuántos intentos) y, holgado, por IP: el equipo comparte el wifi.
  const HORA = 60 * MINUTO;
  const telefonoDe = (req: Request) => telefonoParaWhatsapp(texto(cuerpo(req).telefono) ?? '');
  const codigosPorTelefono = limitarPor(5, HORA, telefonoDe);
  const entradasPorTelefono = limitarPor(30, HORA, telefonoDe);
  const consultasRutPorTelefono = limitarPor(30, HORA, telefonoDe);
  const canjesPorToken = limitarPor(10, HORA, req => texto(cuerpo(req).token) ?? null);
  // Tope por IP solo contra abusos: una sala entera entra desde el mismo WiFi (una IP pública), así que es alto. El límite
  // que protege a cada persona es por teléfono (arriba). 30 por minuto bloqueaba a 60 personas sumándose a la vez.
  const porIp = limitarPor(600, MINUTO, req => req.ip ?? 'sin-ip');

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

  /** A quién sale una factura, como lo ve su dueño: sin actividades ni teléfonos. */
  const datosDeFactura = (rut: string, c: DatosContribuyente) => ({
    rut: formatearRut(rut), razonSocial: c.razonSocial, giro: c.giro, direccion: c.direccion, comuna: c.comuna, ...(c.simulado ? { simulado: true } : {}),
  });

  // ---- Acceso: el teléfono y un código por WhatsApp ----

  const exigirTelefono = (req: Request) => {
    const telefono = telefonoDe(req);
    if (!telefono) throw new ErrorRed('datos_invalidos', 'Escribe tu número de WhatsApp, por ejemplo 9 1234 5678.');
    return telefono;
  };

  /** El código vigente de ese teléfono, sin gastarlo: lo gasta solo `/acceso/entrar` al crear la sesión. */
  const exigirCodigo = (telefono: string, b: Record<string, unknown>) => {
    const verificacion = codigos.verificar(telefono, (texto(b.codigo) ?? '').replace(/\D/g, ''));
    if (verificacion !== 'ok') {
      throw new ErrorRed('no_autorizado', verificacion === 'vencido' ? 'El código venció. Pide uno nuevo.' : 'El código no coincide. Revisa el último que te llegó.');
    }
  };

  // El enlace para entrar directo, solo con URL pública configurada (PUBLIC_URL): nunca se arma desde un encabezado
  // del pedido, porque el enlace lleva una llave de entrada y alguien podría pedirla para otro número con su dominio.
  const urlPublica = env.PUBLIC_URL?.trim().replace(/\/+$/, '');
  const enlaceDeEntrada = (telefono: string, codigo: string, destino: unknown) =>
    urlPublica ? `${urlPublica}/${destino === 'proveedor' ? 'proveedor' : 'app'}?entrar=${enlaces.crear(telefono, codigo)}` : undefined;

    /** Gasta el código del teléfono y responde la sesión nueva del negocio. */
  const entrarComo = (res: Response, telefono: string, negocio: Negocio) => {
    codigos.consumir(telefono);
    res.status(201).json({ token: sesiones.crear({ negocioId: negocio.id }), negocio: sinTelefonos(negocio) });
  };

  // Se manda a cualquier teléfono válido, registrado o no: la respuesta no dice si el número es de la red.
  rutas.post('/acceso/codigo', porIp, codigosPorTelefono, async (req, res) => {
    const telefono = exigirTelefono(req);
    const codigo = codigos.generar(telefono);
    const envio = await enviarCodigo(telefono, mensajeDeCodigo(codigo, enlaceDeEntrada(telefono, codigo, cuerpo(req).destino)));
    if (envio === 'fallido') {
      res.status(503).json({ error: 'whatsapp_no_disponible', mensaje: 'No pudimos mandarte el código por WhatsApp. Inténtalo de nuevo en un rato.' });
      return;
    }
    res.json({ retenido: envio === 'retenido' });
  });

  // Con el código correcto entra el negocio de ese teléfono. Si no hay ninguno, responde `registro: true` sin gastar
  // el código, y la persona vuelve con el mismo código, su nombre y su RUT para registrarse como comprador.
  rutas.post('/acceso/entrar', porIp, entradasPorTelefono, async (req, res) => {
    const telefono = exigirTelefono(req);
    const b = cuerpo(req);
    exigirCodigo(telefono, b);
    let negocio = red.negocioPorTelefono(telefono);
    if (!negocio) {
      const rut = texto(b.rut)?.trim();
      if (!rut || !texto(b.nombre)?.trim()) {
        res.json({ registro: true });
        return;
      }
      negocio = await red.registrarComprador({ ...nuevoComprador(b, rut), telefono });
    }
    entrarComo(res, telefono, negocio);
  });

  // El enlace del mensaje: entra como `/acceso/entrar` con el código que ese token guarda. El token sirve una vez; si el
  // teléfono no es de la red, responde `registro` con su teléfono y su código (los mismos del mensaje que tocó) para
  // seguir con el formulario sin escribirlos.
  rutas.post('/acceso/enlace', porIp, canjesPorToken, async (req, res) => {
    const guardado = enlaces.canjear(texto(cuerpo(req).token) ?? '');
    if (!guardado) throw new ErrorRed('no_autorizado', 'El enlace venció o ya se usó. Pide un código nuevo.');
    const { telefono, codigo } = guardado;
    exigirCodigo(telefono, { codigo });
    const negocio = red.negocioPorTelefono(telefono);
    if (negocio) entrarComo(res, telefono, negocio);
    else res.json({ registro: true, telefono, codigo });
  });

  // Antes de registrarse: los datos del SII de un RUT para prellenar el formulario. Pide el código ya verificado (sin
  // gastarlo) y respeta el RUT atado a su teléfono; limita por teléfono, nunca por IP (el público comparte el wifi).
  rutas.post('/acceso/rut', consultasRutPorTelefono, async (req, res) => {
    const telefono = exigirTelefono(req);
    const b = cuerpo(req);
    exigirCodigo(telefono, b);
    try {
      const { rut, ...contribuyente } = await red.consultarRut(texto(b.rut) ?? '', telefono);
      res.json(datosDeFactura(rut, contribuyente));
    } catch (error) {
      // El SII no respondió: no es un error de la persona. Escribe sus datos y el registro sigue (se confirma después).
      if (!(error instanceof ErrorRed) || error.codigo !== 'sii_no_disponible') throw error;
      res.json({ rut: formatearRut(validarRut(texto(b.rut))!), razonSocial: '', giro: '', comuna: '', sinConfirmar: true });
    }
  });

  rutas.post('/acceso/salir', (req, res) => {
    sesiones.revocar(tokenDe(req));
    res.status(204).end();
  });

  // ---- Comprador ----

  // Comprar exige RUT: un negocio registrado por WhatsApp sin RUT todavía no arma carrito en la web.
  const exigirRut = (n: Negocio) => {
    if (!n.rut) throw new ErrorRed('datos_invalidos', FALTA_RUT);
  };

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
    const facturaA = negocio.rut && c ? datosDeFactura(negocio.rut, c) : null;
    res.json({ negocio: sinTelefonos(negocio), facturaA, ordenes, documentos: documentosDe(ordenes), participaciones });
  });

  // La dirección de su factura: la consulta pública del SII no la trae y sin ella la factura no se emite.
  rutas.put('/yo/direccion', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    const b = cuerpo(req);
    // Los datos del SII no vuelven en la respuesta: la pantalla los vuelve a pedir en /yo.
    await red.fijarDireccionFactura(yo(req).id, { direccion: String(b.direccion ?? ''), comuna: String(b.comuna ?? '') });
    res.json({ ok: true });
  });

  rutas.post('/yo/unirse', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    exigirRut(yo(req));
    const b = cuerpo(req);
    res.json(await red.unirseALicitacion(String(b.licitacionId ?? ''), {
      negocioId: yo(req).id, cantidad: Number(b.cantidad), ...(typeof b.productoId === 'string' ? { productoId: b.productoId } : {}),
    }));
  });

  // El carrito completo de la compra conjunta: cantidad 0 quita un ítem y un carrito vacío sale.
  // El comprador inicia una compra en grupo de un producto (una solicitud): otros se suman y los proveedores ofertan.
  rutas.post('/yo/solicitudes', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    exigirRut(yo(req));
    const { producto, unidad, cantidad, precioHoy, minutos } = cuerpo(req);
    const l = await red.abrirSolicitud({
      compradorId: yo(req).id, producto: String(producto ?? ''), unidad: String(unidad ?? ''), cantidad: Number(cantidad),
      ...(precioHoy ? { precioHoy: Number(precioHoy) } : {}), ...(minutos ? { minutos: Number(minutos) } : {}),
    });
    res.status(201).json(l);
  });

  // Quien inició la compra en grupo la cierra antes, si ya llegó al mínimo de la oferta que gana.
  rutas.post('/yo/solicitudes/:id/cerrar', exigir('comprador'), limitarCarrito, async (req: ConSesion, res) => {
    res.json(await red.cerrarAntes(id(req), yo(req).id));
  });

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

  // ---- Proveedor ----

  rutas.get('/proveedor/yo', exigir('proveedor'), async (req: ConSesion, res) => {
    const negocio = yo(req);
    const estado = red.estadoPublico();
    const ordenes = estado.ordenes.filter(o => o.proveedorId === negocio.id);
    const licitaciones = estado.licitaciones.filter(l => l.proveedorId === negocio.id);
    res.json({
      negocio: sinTelefonos(negocio),
      nota: red.notaDeProveedor(negocio.id),
      puedeFacturar: await red.puedeFacturar(negocio.id),
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

  // Su oferta en una compra en grupo sin proveedor fijo: sus tramos para ese producto. Reemplaza la que entró sola
  // desde su lista; gana al cerrar si es el mejor precio para el volumen del grupo.
  rutas.post('/proveedor/licitacion/:id/productos/:productoId/oferta', exigir('proveedor'), limitarProveedor, async (req: ConSesion, res) => {
    const { tramos, minimo } = cuerpo(req) as { tramos?: Tramo[]; minimo?: unknown };
    if (!Array.isArray(tramos) || !tramos.length) throw new ErrorRed('datos_invalidos', 'La oferta necesita sus tramos');
    const r = await red.ofertar(id(req), {
      proveedorId: yo(req).id, productoId: String(req.params.productoId), precioUnitario: Number(tramos[0]?.precioUnitario), tramos, plazoDias: 1,
      ...(minimo ? { minimo: Number(minimo) } : {}),
    });
    res.status(201).json(sinTelefonos(r));
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

  // Su conexión al SII: la de su empresa (por su RUT) o, solo en la demo, la del panel si la eligió.
  if (conexionSii) {
    rutas.use('/proveedor/sii', exigir('proveedor'), limitarSii, (req: ConSesion, res: Response, next: NextFunction) => {
      const n = yo(req);
      res.locals.proveedor = { id: n.id, ...(n.rut ? { rut: n.rut } : {}), ...(n.vende ? { vende: true } : {}) };
      next();
    }, conexionSii);
  }
  if (catalogo) {
    rutas.use('/proveedor/catalogo', exigir('proveedor'), porNegocio(60), (req: ConSesion, res: Response, next: NextFunction) => {
      res.locals.proveedor = { id: yo(req).id, ...(yo(req).rut ? { rut: yo(req).rut } : {}) };
      next();
    }, catalogo);
  }

  return rutas;
}
