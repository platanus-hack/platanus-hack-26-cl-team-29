// Cliente HTTP del canal web. Dos implementaciones del mismo puerto: la real (rutas /api/red con sesión)
// y la falsa (client/src/canal/falso.ts), que se usa cuando el backend todavía no tiene estas rutas.

import { io } from 'socket.io-client';
import type { Negocio, OrdenCompra } from '../red/tipos.ts';
import { normalizarEstado } from '../red/derivar.ts';
import type { EventoRed } from '../red/tipos.ts';
import type { ItemCarrito } from './carrito.ts';
import type { ConexionSii, ConfigRed, DatosEmpresaSii, FichaSii, FotoRed, Modo, Recepcion, YoComprador, YoProveedor } from './tipos.ts';

export interface ItemPedido {
  producto: string;
  cantidad: number;
}

export interface CanalApi {
  modo: Modo;
  config(): Promise<ConfigRed>;
  estado(): Promise<FotoRed>;
  sesion(nombre: string, comuna: string, rubro?: string): Promise<{ token: string; negocio: Negocio }>;
  yo(token: string): Promise<YoComprador>;
  unirse(token: string, licitacionId: string, cantidad: number): Promise<void>;
  /** Reemplaza el carrito completo de la canasta (cantidad 0 quita; vacío = sale). */
  carrito(token: string, licitacionId: string, items: ItemCarrito[]): Promise<void>;
  /** Sale de la compra conjunta (vacía el carrito). */
  salir(token: string, licitacionId: string): Promise<void>;
  pedir(token: string, proveedorId: string, items: ItemPedido[]): Promise<OrdenCompra>;
  recepcion(token: string, ordenId: string, r: Recepcion): Promise<void>;
  sesionProveedor(codigo: string): Promise<{ token: string }>;
  yoProveedor(token: string): Promise<YoProveedor>;
  cerrar(token: string, licitacionId: string): Promise<void>;
  facturar(token: string, licitacionId: string): Promise<void>;
  confirmarOrden(token: string, ordenId: string): Promise<void>;
  notaCredito(token: string, ordenId: string): Promise<void>;
  /** "Conectar mi SII" del proveedor. Los secretos solo viajan al subirlos; nunca vuelven. */
  siiEstado(token: string): Promise<ConexionSii>;
  siiCertificado(token: string, pfxBase64: string, clave: string): Promise<ConexionSii>;
  siiConsultarEmpresa(token: string, rutEmisor: string): Promise<FichaSii>;
  siiGuardarEmpresa(token: string, datos: DatosEmpresaSii): Promise<ConexionSii>;
  siiCaf(token: string, xmlBase64: string): Promise<{ estado: ConexionSii; avisos: string[] }>;
  siiFolio(token: string, tipo: number, folio: number): Promise<ConexionSii>;
  siiDesconectar(token: string): Promise<ConexionSii>;
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
  };
}

export function crearApiReal(): CanalApi {
  return {
    modo: 'real',
    config: () => llamar('/config'),
    estado: async () => normalizarEstado(await llamar('/estado')) as FotoRed,
    sesion: (nombre, comuna, rubro) => llamar('/sesion', { cuerpo: { nombre, ...(comuna ? { comuna } : {}), ...(rubro ? { rubro } : {}) } }),
    yo: async token => {
      const r = await llamar<Partial<YoComprador>>('/yo', { token });
      return { negocio: r.negocio!, ordenes: lista(r.ordenes), documentos: lista(r.documentos), participaciones: lista(r.participaciones) };
    },
    unirse: async (token, licitacionId, cantidad) => { await llamar('/yo/unirse', { token, cuerpo: { licitacionId, cantidad } }); },
    carrito: async (token, licitacionId, items) => { await llamar('/yo/carrito', { token, cuerpo: { licitacionId, items }, metodo: 'PUT' }); },
    salir: async (token, licitacionId) => { await llamar(`/yo/carrito/${encodeURIComponent(licitacionId)}`, { token, metodo: 'DELETE' }); },
    pedir: (token, proveedorId, items) => llamar('/yo/ordenes', { token, cuerpo: { proveedorId, items } }),
    recepcion: async (token, ordenId, r) => { await llamar(`/yo/ordenes/${encodeURIComponent(ordenId)}/recepcion`, { token, cuerpo: r }); },
    sesionProveedor: codigo => llamar('/proveedor/sesion', { cuerpo: { codigo } }),
    yoProveedor: async token => normalizarYoProveedor(await llamar('/proveedor/yo', { token })),
    cerrar: async (token, id) => { await llamar(`/proveedor/licitacion/${encodeURIComponent(id)}/cerrar`, { token, cuerpo: {} }); },
    facturar: async (token, id) => { await llamar(`/proveedor/licitacion/${encodeURIComponent(id)}/facturar`, { token, cuerpo: { confirmado: true } }); },
    confirmarOrden: async (token, id) => { await llamar(`/proveedor/ordenes/${encodeURIComponent(id)}/confirmar`, { token, cuerpo: { confirmado: true } }); },
    notaCredito: async (token, id) => { await llamar(`/proveedor/ordenes/${encodeURIComponent(id)}/nota-credito`, { token, cuerpo: { confirmado: true } }); },
    siiEstado: token => llamar('/proveedor/sii', { token }),
    siiCertificado: (token, pfxBase64, clave) => llamar('/proveedor/sii/certificado', { token, cuerpo: { pfxBase64, clave } }),
    siiConsultarEmpresa: (token, rutEmisor) => llamar('/proveedor/sii/empresa/consultar', { token, cuerpo: { rutEmisor } }),
    siiGuardarEmpresa: (token, datos) => llamar('/proveedor/sii/empresa', { token, cuerpo: datos, metodo: 'PUT' }),
    siiCaf: (token, xmlBase64) => llamar('/proveedor/sii/caf', { token, cuerpo: { xmlBase64 } }),
    siiFolio: (token, tipo, folio) => llamar(`/proveedor/sii/caf/${tipo}/folio`, { token, cuerpo: { folio } }),
    siiDesconectar: token => llamar('/proveedor/sii', { token, metodo: 'DELETE' }),
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
