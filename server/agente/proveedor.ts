// Proveedores por WhatsApp: se registran con su certificado digital (con él emiten sus facturas en el SII), suman
// productos a la compra conjunta y ofertan. Registrarse no tiene efecto legal y va paso a paso; ofertar y sumar un
// producto son compromisos: este módulo arma la propuesta y el agente la ejecuta solo tras un sí (server/agente/index.ts).
//
// Registro: "Vender" (o "quiero vender") → link privado al certificado → con el certificado conectado, el RUT con que
// factura (el del titular u otra empresa) → negocio que vende y también compra, y su conexión al SII en segundo plano.
import { validarRut } from '../../shared/rut.ts';
import { dinero } from '../../shared/formato.ts';
import { precioDelProducto, tramosAutomaticos } from '../../shared/precios.ts';
import { normalizar } from './intencion.ts';
import { productoNombrado, productosDe } from './canasta.ts';
import { claveTelefono, enmascarar } from './envios.ts';
import type { Log } from './envios.ts';
import { crearAlmacenBorradoresMemoria, MapaPersistente } from './borradores.ts';
import type { AlmacenBorradores } from './borradores.ts';
import type { EventoDeLaRed, LicitacionSala, Negocio, ProductoCompra, RedProveedores, RedSala } from './puerto.ts';
import * as m from './mensajes.ts';

/** Cómo va la conexión al SII de un proveedor: lista para emitir, todavía conectándose, o con el motivo si no. */
export interface EstadoSiiProveedor {
  readonly listo: boolean;
  readonly enCurso: boolean;
  readonly detalle: string | null;
}

export interface OpcionesProveedores {
  readonly log: Log;
  /** Link privado para subir el certificado (server/certificados). */
  enlaceCertificado(telefono: string): string;
  /** Conecta el SII de la empresa con el certificado del titular (server/conexion-sii). Sin él, las facturas son simuladas. */
  conectarSii?(rutEmpresa: string, rutTitular: string): Promise<void>;
  estadoSii?(rutEmpresa: string): Promise<EstadoSiiProveedor>;
  /** Manda un mensaje fuera de una respuesta (SII listo, te superaron). */
  avisar(telefono: string, texto: string): Promise<void>;
  readonly almacenBorradores?: AlmacenBorradores;
  /**
   * Solo para pruebas (DEMO_PROVEEDOR_SIN_CERTIFICADO=1): mientras espera el certificado, quien escribe su RUT queda
   * registrado como proveedor sin certificado ni conexión al SII. Sus facturas salen simuladas.
   */
  readonly sinCertificado?: boolean;
  /** Cada cuánto revisar si la conexión al SII terminó, y hasta cuántas veces. */
  readonly revisarSiiMs?: number;
  readonly revisionesSii?: number;
}

/** Una acción con compromiso, lista para confirmar con un sí. */
export type PropuestaProveedor = { readonly mensaje: string } & (
  | { readonly tipo: 'ofertar'; readonly licitacionId: string; readonly productoId: string; readonly precio: number }
  | { readonly tipo: 'crear_producto'; readonly licitacionId: string; readonly nombre: string; readonly unidad: string; readonly precio: number }
);

export interface Proveedores {
  cargar(): Promise<void>;
  /** Parte (o retoma) el registro de proveedor de un teléfono. */
  empezar(telefono: string): string;
  /** Si ese teléfono está registrándose como proveedor. */
  registrando(telefono: string): boolean;
  /** Un mensaje durante el registro. */
  atenderRegistro(telefono: string, texto: string): Promise<string>;
  /** El certificado quedó conectado: si se estaba registrando, la pregunta que sigue; si no, null. */
  certificadoConectado(telefono: string, rutTitular: string): string | null;
  proponerOferta(proveedor: Negocio, precio: number, producto?: string): Promise<PropuestaProveedor | string>;
  proponerProducto(proveedor: Negocio, nombre: string, unidad: string, precio: number): Promise<PropuestaProveedor | string>;
  /** Ejecuta una propuesta ya confirmada. */
  ejecutar(proveedor: Negocio, p: PropuestaProveedor): Promise<string>;
  verOfertas(proveedor: Negocio): Promise<string>;
  detener(): void;
}

interface Registro {
  paso: 'certificado' | 'empresa' | 'rut_empresa';
  rutTitular?: string;
}

const PLAZO_DIAS = 1;

export function crearProveedores(red: RedSala & RedProveedores, o: OpcionesProveedores): Proveedores {
  const registros = new MapaPersistente<Registro>(o.almacenBorradores ?? crearAlmacenBorradoresMemoria(), 'proveedor', o.log);
  /** Quién va ganando cada producto (`licitacion:producto`), para avisarle cuando lo superan. */
  const lideres = new Map<string, string>();
  const revisiones = new Set<ReturnType<typeof setInterval>>();

  async function abierta(): Promise<LicitacionSala | null> {
    return (await red.licitacionAbierta()) ?? null;
  }

  function empezar(telefono: string): string {
    registros.set(claveTelefono(telefono), { paso: 'certificado' });
    o.log.info(`[proveedor] ${enmascarar(telefono)} empezó su registro de proveedor`);
    return m.registroProveedor(o.enlaceCertificado(telefono), o.sinCertificado);
  }

  /** Sin `rutTitular` (prueba sin certificado), no hay conexión al SII: sus facturas salen simuladas. */
  async function registrar(telefono: string, rutEmpresa: string, rutTitular?: string): Promise<string> {
    let negocio: Negocio;
    try {
      negocio = await red.registrarProveedor({ telefono, rut: rutEmpresa });
    } catch (error) {
      const codigo = (error as { codigo?: unknown }).codigo;
      if (codigo !== 'datos_invalidos' && codigo !== 'sii_no_disponible') throw error;
      if (rutTitular) registros.set(claveTelefono(telefono), { paso: 'rut_empresa', rutTitular });
      if (!rutTitular) return `${(error as Error).message}\n\n${m.esperandoCertificado(o.enlaceCertificado(telefono), true)}`;
      return `${(error as Error).message}\n\n${m.PEDIR_RUT_EMPRESA}`;
    }
    registros.delete(claveTelefono(telefono));
    o.log.info(`[proveedor] ${enmascarar(telefono)} quedó como proveedor${rutTitular ? '' : ' sin certificado (prueba)'}`);
    if (!rutTitular) return `${m.proveedorRegistrado(negocio.nombre, false)}\n\n${m.SIN_CERTIFICADO_SIMULADAS}`;
    if (!o.conectarSii) return m.proveedorRegistrado(negocio.nombre, false);
    try {
      await o.conectarSii(rutEmpresa, rutTitular);
      vigilarSii(telefono, rutEmpresa);
    } catch (error) {
      o.log.error(`[proveedor] no se pudo conectar el SII de ${enmascarar(telefono)}:`, error instanceof Error ? error.message : error);
      return `${m.proveedorRegistrado(negocio.nombre, false)}\n\n${m.siiNoConectado(error instanceof Error ? error.message : null)}`;
    }
    return m.proveedorRegistrado(negocio.nombre, true);
  }

  /** La conexión al SII corre en segundo plano (ficha, resolución, folios): se avisa cuando termina. */
  function vigilarSii(telefono: string, rutEmpresa: string) {
    if (!o.estadoSii) return;
    let vueltas = 0;
    const intervalo = setInterval(async () => {
      try {
        const e = await o.estadoSii!(rutEmpresa);
        if (e.enCurso && ++vueltas < (o.revisionesSii ?? 40)) return;
        terminar();
        await o.avisar(telefono, e.listo ? m.SII_LISTO : m.siiNoConectado(e.detalle));
      } catch (error) {
        terminar();
        o.log.error('[proveedor] no se pudo revisar la conexión al SII:', error instanceof Error ? error.message : error);
      }
    }, o.revisarSiiMs ?? 15_000);
    const terminar = () => { clearInterval(intervalo); revisiones.delete(intervalo); };
    intervalo.unref?.();
    revisiones.add(intervalo);
  }

  async function atenderRegistro(telefono: string, texto: string): Promise<string> {
    const clave = claveTelefono(telefono);
    const r = registros.get(clave);
    if (!r) return empezar(telefono);
    const t = normalizar(texto);
    if (/^(cancelar|cancela|no quiero|mejor no|salir)\b/.test(t)) {
      registros.delete(clave);
      return m.REGISTRO_PROVEEDOR_CANCELADO;
    }
    const rut = validarRut(texto.match(/[\d.]+\s*-?\s*[\dkK]/)?.[0] ?? '');
    if (r.paso === 'certificado') {
      if (o.sinCertificado && rut) return registrar(telefono, rut);
      return m.esperandoCertificado(o.enlaceCertificado(telefono), o.sinCertificado);
    }
    if (rut) return registrar(telefono, rut, r.rutTitular!);
    if (r.paso === 'empresa' && (t === '1' || /\b(mi rut|el mio|personal)\b/.test(t))) return registrar(telefono, r.rutTitular!, r.rutTitular!);
    if (r.paso === 'empresa' && (t === '2' || /\b(otra|empresa)\b/.test(t))) {
      registros.set(clave, { ...r, paso: 'rut_empresa' });
      return m.PEDIR_RUT_EMPRESA;
    }
    return r.paso === 'empresa' ? m.preguntarEmpresa(r.rutTitular!) : m.PEDIR_RUT_EMPRESA;
  }

  function certificadoConectado(telefono: string, rutTitular: string): string | null {
    const clave = claveTelefono(telefono);
    if (registros.get(clave)?.paso !== 'certificado') return null;
    registros.set(clave, { paso: 'empresa', rutTitular });
    return m.preguntarEmpresa(rutTitular);
  }

  /** El producto de la compra abierta que nombra el texto, o la lista para elegir. */
  async function productoDe(texto: string | undefined, ejemplo: (p: ProductoCompra) => string): Promise<string | { l: LicitacionSala; producto: ProductoCompra }> {
    const l = await abierta();
    if (!l) return m.SIN_COMPRA_ABIERTA;
    const producto = texto ? productoNombrado(texto, l) : undefined;
    if (!producto) return m.elegirProductoParaOfertar(productosDe(l), ejemplo);
    return { l, producto };
  }

  async function proponerOferta(proveedor: Negocio, precio: number, texto?: string): Promise<PropuestaProveedor | string> {
    const r = await productoDe(texto, p => `oferto ${dinero(precio)} por ${p.nombre.toLowerCase()}`);
    if (typeof r === 'string') return r;
    const { l, producto } = r;
    return { tipo: 'ofertar', licitacionId: l.id, productoId: producto.id, precio, mensaje: m.proponerOferta(producto, precio) };
  }

  async function proponerProducto(_proveedor: Negocio, nombre: string, unidad: string, precio: number): Promise<PropuestaProveedor | string> {
    const l = await abierta();
    if (!l) return m.SIN_COMPRA_ABIERTA;
    if (productosDe(l).some(p => normalizar(p.nombre) === normalizar(nombre))) return m.productoYaExiste(nombre);
    return { tipo: 'crear_producto', licitacionId: l.id, nombre, unidad, precio, mensaje: m.proponerProducto(nombre, unidad, tramosAutomaticos(precio)) };
  }

  async function ejecutar(proveedor: Negocio, p: PropuestaProveedor): Promise<string> {
    if (p.tipo === 'crear_producto') {
      const { producto } = await red.crearProducto(p.licitacionId, { proveedorId: proveedor.id, nombre: p.nombre, unidad: p.unidad, precio: p.precio });
      o.log.info(`[proveedor] ${proveedor.id} sumó ${producto.id} a ${p.licitacionId}`);
      return m.productoCreado(producto);
    }
    const l = await red.ofertar(p.licitacionId, { proveedorId: proveedor.id, productoId: p.productoId, precioUnitario: p.precio, plazoDias: PLAZO_DIAS });
    const producto = productosDe(l).find(x => x.id === p.productoId)!;
    o.log.info(`[proveedor] ${proveedor.id} ofertó en ${p.licitacionId}/${p.productoId}`);
    return m.ofertaHecha(producto, p.precio, lider(producto) === proveedor.id);
  }

  /** Quién va ganando un producto: la oferta más barata, o el creador si su tramo es menor. */
  function lider(p: ProductoCompra): string | undefined {
    const mejor = [...(p.ofertas ?? [])].sort((a, b) => a.precioUnitario - b.precioUnitario)[0];
    if (p.proveedorId && (!mejor || precioDelProducto({ ...p, ofertas: [] }, Math.max(p.totalUnidades, 1)) < mejor.precioUnitario)) return p.proveedorId;
    return mejor?.proveedorId;
  }

  async function verOfertas(proveedor: Negocio): Promise<string> {
    const l = await abierta();
    if (!l) return m.SIN_COMPRA_ABIERTA;
    const mias = productosDe(l).flatMap(p => {
      const propia = p.ofertas?.find(x => x.proveedorId === proveedor.id)?.precioUnitario
        ?? (p.proveedorId === proveedor.id ? precioDelProducto({ ...p, ofertas: [] }, Math.max(p.totalUnidades, 1)) : undefined);
      return propia === undefined ? [] : [{ producto: p, propia, ganando: lider(p) === proveedor.id }];
    });
    return m.estadoDeOfertas(mias, productosDe(l));
  }

  /** Avisa al que iba ganando un producto cuando otro lo supera. */
  async function alOfertar(datos: { licitacionId?: string; productoId?: string; mejor?: boolean; oferta?: { proveedorId?: string; proveedorNombre?: string; precioUnitario?: number }; licitacion?: LicitacionSala }) {
    const { licitacionId, productoId, mejor, oferta, licitacion } = datos;
    if (!licitacionId || !productoId || !oferta?.proveedorId) return;
    const clave = `${licitacionId}:${productoId}`;
    // Sin ofertas vistas antes, el que iba ganando es quien creó el producto (compite con su tramo).
    const producto0 = licitacion ? productosDe(licitacion).find(p => p.id === productoId) : undefined;
    const anterior = lideres.get(clave) ?? producto0?.proveedorId;
    const producto = producto0;
    const ahora = producto ? lider(producto) : mejor ? oferta.proveedorId : anterior;
    if (ahora) lideres.set(clave, ahora);
    if (!anterior || !ahora || anterior === ahora || !producto || typeof oferta.precioUnitario !== 'number') return;
    const telefono = await red.telefonoDeNegocio(anterior);
    if (telefono) await o.avisar(telefono, m.teSuperaron(producto, oferta.proveedorNombre ?? 'Otro proveedor', oferta.precioUnitario));
  }

  const dejarDeEscuchar = red.escuchar((evento: EventoDeLaRed) => {
    if (evento.tipo === 'licitacion.oferta') {
      alOfertar(evento.datos as Parameters<typeof alOfertar>[0]).catch(e => o.log.error('[proveedor] falló el aviso de oferta:', e instanceof Error ? e.message : e));
    }
    if (evento.tipo === 'red.reiniciada') lideres.clear();
  });

  return {
    cargar: () => registros.cargar(),
    empezar,
    registrando: telefono => registros.has(claveTelefono(telefono)),
    atenderRegistro,
    certificadoConectado,
    proponerOferta,
    proponerProducto,
    ejecutar,
    verOfertas,
    detener() {
      dejarDeEscuchar();
      for (const r of revisiones) clearInterval(r);
    },
  };
}
