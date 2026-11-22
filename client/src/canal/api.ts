// Cliente HTTP del canal web. Dos implementaciones del mismo puerto: la real (rutas /api/red con sesión)
// y la falsa (client/src/canal/falso.ts), que se usa cuando el backend todavía no tiene estas rutas.

import { io } from 'socket.io-client';
import type { Negocio } from '../red/tipos.ts';
import { normalizarEstado } from '../red/derivar.ts';
import type { EventoRed } from '../red/tipos.ts';
import type { ItemCarrito } from './carrito.ts';
import type { TipoDocumento } from '../../../shared/documentos.ts';
import { MENSAJE_LIMITE } from '../../../shared/texto.ts';
import type { CatalogoProveedor, ProductoEscrito } from '../../../shared/catalogo.ts';
import type { ProductoConocido } from '../../../shared/productos.ts';
import type { RutaReparto } from '../../../shared/ruta.ts';
import type { EstadoConexionSii, ConfigRed, DatosEmpresaSii, DatosEntrada, FacturaA, FichaSii, FotoRed, Modo, Recepcion, Tramo, YoComprador, YoProveedor } from './tipos.ts';

export type Entrada = { registro: true } | { token: string; negocio: Negocio };
/** Al tocar el enlace del mensaje: entra, o sigue al registro con el teléfono y el código de ese mensaje. */
export type EntradaPorEnlace = { registro: true; telefono: string; codigo: string } | { token: string; negocio: Negocio };

/** Lo que pide el comprador al iniciar una compra en grupo. `precioHoy`: lo que paga hoy por unidad, si lo sabe. */
export interface NuevaSolicitud {
  producto: string;
  unidad: string;
  cantidad: number;
  precioHoy?: number;
  minutos: number;
}

export interface CanalApi {
  modo: Modo;
  config(): Promise<ConfigRed>;
  estado(): Promise<FotoRed>;
  /** Manda un código por WhatsApp. `retenido`: la ventana de 24 h está cerrada; llega cuando la persona escriba al número. */
  pedirCodigo(telefono: string): Promise<{ retenido: boolean }>;
  /**
   * Entra con el código: la sesión del negocio de ese teléfono. Si el teléfono no es de la red responde `registro` y
   * se vuelve con el mismo código y los datos del negocio (el servidor consulta el RUT en el SII: tarda un par de segundos).
   */
  entrar(telefono: string, codigo: string, datos?: DatosEntrada): Promise<Entrada>;
  /** Entra con el token del enlace del mensaje (`?entrar=`): sirve una vez y vence con el código. */
  entrarConEnlace(token: string): Promise<EntradaPorEnlace>;
  /** Antes de registrarse, con el código vigente (sin gastarlo): los datos del SII de un RUT para prellenar el registro. */
  consultarRut(telefono: string, codigo: string, rut: string): Promise<FacturaA>;
  /** Revoca la sesión de este dispositivo. */
  cerrarSesion(token: string): Promise<void>;
  yo(token: string): Promise<YoComprador>;
  unirse(token: string, licitacionId: string, cantidad: number): Promise<void>;
  /** Reemplaza el carrito completo de la canasta (cantidad 0 quita; vacío = sale). */
  carrito(token: string, licitacionId: string, items: ItemCarrito[]): Promise<void>;
  /** Productos que ya existen en la plataforma y se parecen a lo escrito, con su unidad (la biblioteca). */
  buscarProductos(q: string): Promise<ProductoConocido[]>;
  /** La dirección de su factura (la consulta pública del SII no la trae). */
  fijarDireccion(token: string, d: { direccion: string; comuna: string }): Promise<void>;
  /** Confirma la recepción de un pedido facturado: llegó todo (acuse en el SII) o faltaron N (reclamo en el SII). */
  recepcion(token: string, ordenId: string, r: Recepcion): Promise<void>;
  /** Quien la inició cierra la compra en grupo antes, si ya llegó al mínimo de la oferta que gana. */
  cerrarSolicitud(token: string, licitacionId: string): Promise<void>;
  /** Inicia una compra en grupo de un producto con su cantidad; devuelve dónde quedó para abrirla. */
  abrirSolicitud(token: string, s: NuevaSolicitud): Promise<{ licitacionId: string; productoId: string }>;
  /** Sale de la compra conjunta (vacía el carrito). */
  salir(token: string, licitacionId: string): Promise<void>;
  yoProveedor(token: string): Promise<YoProveedor>;
  cerrar(token: string, licitacionId: string): Promise<void>;
  facturar(token: string, licitacionId: string): Promise<void>;
  /** Su oferta con tramos en una compra en grupo sin proveedor fijo (reemplaza la que entró desde su lista). */
  ofertar(token: string, licitacionId: string, productoId: string, tramos: Tramo[], minimo?: number): Promise<void>;
  /** Sus tramos por volumen de un producto de la compra abierta (solo el dueño del producto). */
  fijarTramos(token: string, licitacionId: string, productoId: string, tramos: Tramo[]): Promise<void>;
  confirmarOrden(token: string, ordenId: string): Promise<void>;
  /** Su ruta de reparto: los negocios que esperan su pedido, en orden, con su guía de despacho. */
  rutaReparto(token: string): Promise<RutaReparto>;
  /** Emite en el SII la guía de despacho de cada pedido por entregar que no la tiene. */
  emitirGuias(token: string): Promise<void>;
  notaCredito(token: string, ordenId: string): Promise<void>;
  /** "Conectar mi SII" del proveedor. Los secretos solo viajan al subirlos; nunca vuelven. */
  siiEstado(token: string): Promise<EstadoConexionSii>;
  /** Sube el certificado y parte la conexión automática con el RUT de la empresa (vacío: el del titular). */
  siiCertificado(token: string, pfxBase64: string, clave: string, rutEmisor: string): Promise<EstadoConexionSii>;
  /** Vuelve a correr la conexión automática. */
  siiAutomatico(token: string, rutEmisor: string): Promise<EstadoConexionSii>;
  siiConsultarEmpresa(token: string, rutEmisor: string): Promise<FichaSii>;
  siiGuardarEmpresa(token: string, datos: DatosEmpresaSii): Promise<EstadoConexionSii>;
  siiCaf(token: string, xmlBase64: string): Promise<{ estado: EstadoConexionSii; avisos: string[] }>;
  siiFolio(token: string, tipo: number, folio: number): Promise<EstadoConexionSii>;
  /** "Traer más folios": la reposición automática del servidor, en segundo plano. */
  siiTraerFolios(token: string, tipo: TipoDocumento): Promise<EstadoConexionSii>;
  siiDesconectar(token: string): Promise<EstadoConexionSii>;
  /** Solo demo: usar (o dejar de usar) la conexión de la empresa de la demo en vez de la suya. */
  siiUsarDemo(token: string, usar: boolean): Promise<EstadoConexionSii>;
  /**
   * Su catálogo: su lista de productos (`manual`) y las sugerencias de sus facturas. La primera vez llega `armando` y
   * avisa con `catalogo.actualizado`.
   */
  catalogo(token: string): Promise<CatalogoProveedor>;
  /** Agrega un producto a su lista, con sus tramos por cantidad. */
  agregarProducto(token: string, producto: ProductoEscrito): Promise<void>;
  editarProducto(token: string, clave: string, producto: ProductoEscrito): Promise<void>;
  quitarProducto(token: string, clave: string): Promise<void>;
  /** Suma un producto del catálogo a la compra conjunta abierta, con los tramos de su historial. */
  sumarDelCatalogo(token: string, clave: string): Promise<void>;
  /** Avisa cada vez que algo cambia en la red. Devuelve cómo dejar de escuchar. */
  escuchar(alCambiar: (e?: EventoRed) => void): () => void;
}

/** Error para mostrar tal cual a la persona. `sesionVencida` pide volver a entrar. */
export class ErrorCanal extends Error {
  sesionVencida: boolean;
  constructor(mensaje: string, sesionVencida = false) {
    super(mensaje);
    this.sesionVencida = sesionVencida;
  }
}

const SIN_CONEXION = 'No pudimos conectar con la red. Revisa tu conexión e inténtalo de nuevo.';

const MENSAJE_HTTP: Record<number, string> = {
  401: 'Tu sesión venció. Vuelve a entrar.',
  403: 'No tienes permiso para hacer esto.',
  404: 'No encontramos lo que buscas. Puede que ya haya cambiado.',
  409: 'Esto ya cambió en la red. Actualizamos lo que ves.',
  429: MENSAJE_LIMITE,
};

const esJson = (r: Response) => !!r.headers.get('content-type')?.includes('application/json');

async function llamar<T>(ruta: string, opciones: { token?: string; cuerpo?: unknown; metodo?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opciones.cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;
  let r: Response;
  try {
    r = await fetch(`/api/red${ruta}`, {
      method: opciones.metodo ?? (opciones.cuerpo === undefined ? 'GET' : 'POST'),
      headers,
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    });
  } catch {
    throw new ErrorCanal(SIN_CONEXION);
  }
  const datos = esJson(r) ? await r.json().catch(() => null) : null;
  if (!r.ok) {
    // El backend responde { error, mensaje } con el mensaje ya en español.
    // El mensaje de "falta tarjeta" trae el enlace de WhatsApp; en la web se inscribe desde la compra o Crédito.
    if (datos?.error === 'falta_tarjeta') throw new ErrorCanal('Para comprar, inscribe tu tarjeta una vez (en Transbank).');
    const mensaje = typeof datos?.mensaje === 'string' ? datos.mensaje : MENSAJE_HTTP[r.status] ?? `La red respondió con un error (${r.status}).`;
    throw new ErrorCanal(mensaje, r.status === 401);
  }
  if (datos === null && r.status !== 204) throw new ErrorCanal(SIN_CONEXION);
  return datos as T;
}

const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalizarYoProveedor(raw: unknown): YoProveedor {
  const r = (raw ?? {}) as Record<string, unknown>;
  const nota = r.nota && typeof r.nota === 'object' ? (r.nota as Record<string, unknown>) : { nota: r.nota, anterior: r.notaAnterior };
  return {
    proveedor: (r.proveedor ?? r.negocio) as Negocio,
    ordenes: lista(r.ordenes),
    documentos: lista(r.documentos),
    nota: typeof nota.nota === 'number' ? nota.nota : null,
    ...(typeof nota.anterior === 'number' ? { notaAnterior: nota.anterior } : {}),
    ...(Array.isArray(r.licitaciones) ? { licitaciones: r.licitaciones } : {}),
    ...(typeof r.puedeFacturar === 'boolean' ? { puedeFacturar: r.puedeFacturar } : {}),
  };
}

export function crearApiReal(): CanalApi {
  return {
    modo: 'real',
    config: () => llamar('/config'),
    estado: async () => normalizarEstado(await llamar('/estado')) as FotoRed,
    // `destino`: a qué panel lleva el enlace de entrada directa del mensaje.
    pedirCodigo: telefono => llamar('/acceso/codigo', { cuerpo: { telefono, destino: location.pathname.startsWith('/proveedor') ? 'proveedor' : 'app' } }),
    entrarConEnlace: token => llamar('/acceso/enlace', { cuerpo: { token } }),
    entrar: (telefono, codigo, datos) => llamar('/acceso/entrar', { cuerpo: {
      telefono, codigo, ...(datos ? {
        nombre: datos.nombre, rut: datos.rut, ...(datos.comuna ? { comuna: datos.comuna } : {}),
        ...(datos.direccion ? { direccion: datos.direccion } : {}), ...(datos.rubro ? { rubro: datos.rubro } : {}),
      } : {}),
    } }),
    consultarRut: (telefono, codigo, rut) => llamar('/acceso/rut', { cuerpo: { telefono, codigo, rut } }),
    cerrarSesion: async token => { await llamar('/acceso/salir', { token, cuerpo: {} }); },
    yo: async token => {
      const r = await llamar<Partial<YoComprador>>('/yo', { token });
      return { negocio: r.negocio!, facturaA: r.facturaA ?? null, ordenes: lista(r.ordenes), documentos: lista(r.documentos), participaciones: lista(r.participaciones) };
    },
    unirse: async (token, licitacionId, cantidad) => { await llamar('/yo/unirse', { token, cuerpo: { licitacionId, cantidad } }); },
    buscarProductos: async q => (await llamar<{ productos: ProductoConocido[] }>(`/productos?${new URLSearchParams({ q })}`)).productos,
    fijarDireccion: async (token, d) => { await llamar('/yo/direccion', { token, cuerpo: d, metodo: 'PUT' }); },
    recepcion: async (token, ordenId, r) => { await llamar(`/yo/ordenes/${encodeURIComponent(ordenId)}/recepcion`, { token, cuerpo: r }); },
    cerrarSolicitud: async (token, id) => { await llamar(`/yo/solicitudes/${encodeURIComponent(id)}/cerrar`, { token, cuerpo: {} }); },
    abrirSolicitud: async (token, solicitud) => {
      const l = await llamar<{ id: string; productos: { id: string }[] }>('/yo/solicitudes', { token, cuerpo: solicitud });
      return { licitacionId: l.id, productoId: l.productos[0].id };
    },
    carrito: async (token, licitacionId, items) => { await llamar('/yo/carrito', { token, cuerpo: { licitacionId, items }, metodo: 'PUT' }); },
    salir: async (token, licitacionId) => { await llamar(`/yo/carrito/${encodeURIComponent(licitacionId)}`, { token, metodo: 'DELETE' }); },
    yoProveedor: async token => normalizarYoProveedor(await llamar('/proveedor/yo', { token })),
    cerrar: async (token, id) => { await llamar(`/proveedor/licitacion/${encodeURIComponent(id)}/cerrar`, { token, cuerpo: {} }); },
    facturar: async (token, id) => { await llamar(`/proveedor/licitacion/${encodeURIComponent(id)}/facturar`, { token, cuerpo: { confirmado: true } }); },
    ofertar: async (token, id, productoId, tramos, minimo) => {
      await llamar(`/proveedor/licitacion/${encodeURIComponent(id)}/productos/${encodeURIComponent(productoId)}/oferta`, { token, cuerpo: { tramos, ...(minimo ? { minimo } : {}) } });
    },
    fijarTramos: async (token, id, productoId, tramos) => {
      await llamar(`/proveedor/licitacion/${encodeURIComponent(id)}/productos/${encodeURIComponent(productoId)}/tramos`, { token, cuerpo: { tramos }, metodo: 'PUT' });
    },
    rutaReparto: token => llamar('/proveedor/ruta', { token }),
    emitirGuias: async token => { await llamar('/proveedor/ruta/guias', { token, cuerpo: { confirmado: true } }); },
    confirmarOrden: async (token, id) => { await llamar(`/proveedor/ordenes/${encodeURIComponent(id)}/confirmar`, { token, cuerpo: { confirmado: true } }); },
    notaCredito: async (token, id) => { await llamar(`/proveedor/ordenes/${encodeURIComponent(id)}/nota-credito`, { token, cuerpo: { confirmado: true } }); },
    siiEstado: token => llamar('/proveedor/sii', { token }),
    siiCertificado: (token, pfxBase64, clave, rutEmisor) => llamar('/proveedor/sii/certificado', { token, cuerpo: { pfxBase64, clave, rutEmisor } }),
    siiAutomatico: (token, rutEmisor) => llamar('/proveedor/sii/automatico', { token, cuerpo: { rutEmisor } }),
    siiConsultarEmpresa: (token, rutEmisor) => llamar('/proveedor/sii/empresa/consultar', { token, cuerpo: { rutEmisor } }),
    siiGuardarEmpresa: (token, datos) => llamar('/proveedor/sii/empresa', { token, cuerpo: datos, metodo: 'PUT' }),
    siiCaf: (token, xmlBase64) => llamar('/proveedor/sii/caf', { token, cuerpo: { xmlBase64 } }),
    siiFolio: (token, tipo, folio) => llamar(`/proveedor/sii/caf/${tipo}/folio`, { token, cuerpo: { folio } }),
    siiTraerFolios: (token, tipo) => llamar(`/proveedor/sii/folios/${tipo}`, { token, cuerpo: {} }),
    siiDesconectar: token => llamar('/proveedor/sii', { token, metodo: 'DELETE' }),
    siiUsarDemo: (token, usar) => llamar('/proveedor/sii/demo', { token, cuerpo: { usar } }),
    catalogo: token => llamar('/proveedor/catalogo', { token }),
    agregarProducto: async (token, producto) => { await llamar('/proveedor/catalogo/productos', { token, cuerpo: producto }); },
    editarProducto: async (token, clave, producto) => {
      await llamar(`/proveedor/catalogo/productos/${encodeURIComponent(clave)}`, { token, cuerpo: producto, metodo: 'PUT' });
    },
    quitarProducto: async (token, clave) => { await llamar(`/proveedor/catalogo/productos/${encodeURIComponent(clave)}`, { token, metodo: 'DELETE' }); },
    sumarDelCatalogo: async (token, clave) => { await llamar(`/proveedor/catalogo/productos/${encodeURIComponent(clave)}/sumar`, { token, cuerpo: {} }); },
    escuchar(alCambiar) {
      const socket = io();
      socket.on('red:evento', (e: EventoRed) => alCambiar(e));
      socket.on('connect', () => alCambiar());
      return () => { socket.close(); };
    },
  };
}

/** Real si el backend ya responde `GET /api/red/config` con JSON; si no, la red falsa. `?prueba` fuerza la falsa. */
export async function hayBackend(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('prueba')) return false;
  try {
    const r = await fetch('/api/red/config', { headers: { accept: 'application/json' } });
    return r.ok && esJson(r);
  } catch {
    return false;
  }
}
