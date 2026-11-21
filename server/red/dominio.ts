import { randomUUID } from 'node:crypto';
import { fechaEnChile } from '../../shared/fecha.ts';
import { sinTildes } from '../../shared/texto.ts';
import { normalizarProducto, precioDe, PRODUCTOS_DISPONIBLES } from './catalogo.ts';
import { neto, precioAjustado, precioPorVolumen, unidadesDe } from '../../shared/precios.ts';
import { precioVigente, preciosVigentes, productoDe, vistaLicitacion } from './compra.ts';
import { CANTIDAD_MAXIMA } from './config-demo.ts';
import { enlacePdf } from './pdf-enlace.ts';
import { sinTelefonos } from './publico.ts';
import type { SinTelefono } from './publico.ts';
import { calcularNota } from './reputacion.ts';
import { conCacheYFila, crearConsultaContribuyenteFalsa } from './contribuyente.ts';
import type { ConsultarContribuyente, DatosContribuyente } from './contribuyente.ts';
import { RUT_INVALIDO, validarRut } from '../../shared/rut.ts';
import { RUBROS } from './tipos.ts';
import { COMPETIDORES_SALA, PROVEEDOR_SALA, sembrar } from './semilla.ts';
import type { DocumentoImpreso } from '../sii/index.ts';
import type { PuertoSii, ResultadoSii } from './sii.ts';
import type { Repositorio } from './repositorio.ts';
import type {
  Coleccion, DatosRed, Documento, EstadoOrden, EstadoRed, EventoRed, Item, ItemCarrito, Licitacion, LicitacionVista, Negocio,
  Oferta, OrdenCompra, Participante, Rubro, TipoDocumento, TipoEventoRed, TipoEventoReputacion,
} from './tipos.ts';

export type CodigoError =
  | 'no_encontrado' | 'transicion_invalida' | 'datos_invalidos' | 'ocupado'
  // Canal web: sin sesión, sesión de otro negocio, o acción legal sin `confirmado: true`.
  | 'no_autorizado' | 'prohibido' | 'confirmacion_requerida'
  // No se pudo consultar un RUT en el SII (corte o sesión caída): se puede intentar de nuevo.
  | 'sii_no_disponible';

export class ErrorRed extends Error {
  codigo: CodigoError;
  constructor(codigo: CodigoError, mensaje: string) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export type Recepcion = { conforme: true } | { faltante: number; producto?: string };

/** El producto puede venir en texto libre ("sacos de harina"); sin precio, lo pone el catálogo. */
export interface NuevoItem {
  /** Producto de la canasta de la compra conjunta, si viene de ahí. */
  productoId?: string;
  producto: string;
  cantidad: number;
  precioUnitario?: number;
}

export interface NuevaOrden {
  compradorId: string;
  proveedorId: string;
  items: readonly NuevoItem[];
}

/**
 * Quien se suma a la compra conjunta: un negocio ya registrado (`negocioId`, p. ej. la sesión web),
 * alguien por WhatsApp (`telefono`) o el público anónimo de la página del QR (solo `nombre`).
 */
export interface NuevoParticipante {
  negocioId?: string;
  /** Solo interno: el teléfono nunca sale en la foto pública ni en eventos. */
  telefono?: string;
  nombre?: string;
  comuna?: string;
  rubro?: string;
  /** Producto de la canasta; por defecto el primero (compatibilidad con un solo producto). */
  productoId?: string;
  cantidad: number;
}

/** Lo que devuelve `unirseALicitacion`. Todo sin teléfonos. */
export interface ResultadoUnion {
  licitacion: SinTelefono<LicitacionVista>;
  participante: SinTelefono<Participante>;
  /** Precio vigente del producto al que se sumó. */
  precioActual: number;
  /** El total del grupo en ese producto cruzó un tramo y su precio bajó para todos. */
  bajoDePrecio: boolean;
}

/** Quién edita su carrito: un negocio con sesión (`negocioId`) o alguien por WhatsApp (`telefono`). */
export interface DuenoCarrito {
  negocioId?: string;
  /** Solo interno: el teléfono nunca sale en la foto pública ni en eventos. */
  telefono?: string;
  nombre?: string;
  comuna?: string;
  /** Rubro al registrarse (`RUBROS`), opcional. */
  rubro?: string;
  /** RUT del comprador (con o sin puntos y guion). Se consulta en el SII y su factura sale a ese RUT. Solo interno. */
  rut?: string;
}

export interface NuevoCarrito extends DuenoCarrito {
  /** El carrito completo; cantidad 0 quita el ítem y un carrito vacío sale de la compra. Cantidad por ítem 0 a 20. */
  items: readonly ItemCarrito[];
}

export interface NuevoItemCarrito extends DuenoCarrito {
  productoId: string;
  /** Fija la cantidad de ese producto (0 lo quita). */
  cantidad: number;
}

export interface BajadaPrecio {
  productoId: string;
  precioAnterior: number;
  precioNuevo: number;
}

/** Lo que devuelven `actualizarCarrito` y `agregarAlCarrito`. Todo sin teléfonos. */
export interface ResultadoCarrito {
  licitacion: SinTelefono<LicitacionVista>;
  /** El participante con su carrito, o null si quedó fuera (carrito vacío). */
  participante: SinTelefono<Participante> | null;
  /** Productos cuyo precio bajó con este cambio. */
  bajadas: BajadaPrecio[];
}

/** Datos para registrar (o reusar) un negocio comprador. */
export interface NuevoComprador {
  nombre: string;
  comuna?: string;
  /** Rubro (`RUBROS`); uno desconocido queda como `otro`. */
  rubro?: string;
  telefono?: string;
  /** RUT (con o sin puntos y guion): se valida, se consulta en el SII y queda en el negocio. Uno ya registrado (por teléfono o `negocioId`) lo recibe. */
  rut?: string;
  /** Un comprador ya registrado (sesión web): se reusa en vez de crear otro. */
  negocioId?: string;
}

/** Lo que el comprador ve de sí mismo: a quién sale su factura. Solo para su dueño, nunca en datos públicos. */
export interface ContribuyenteDeRut extends DatosContribuyente {
  rut: string;
}

export type NuevaOferta = Omit<Oferta, 'en'>;

export interface Red {
  crearOrden(nueva: NuevaOrden): Promise<OrdenCompra>;
  /** Antes de confirmar: cuántas unidades dirá la guía de despacho (52), si son menos que las pedidas. */
  fijarDespacho(ordenId: string, cantidad: number, producto?: string): Promise<OrdenCompra>;
  confirmarOrden(ordenId: string): Promise<OrdenCompra>;
  registrarRecepcion(ordenId: string, recepcion: Recepcion): Promise<OrdenCompra>;
  emitirNotaCredito(ordenId: string): Promise<Documento>;
  notaDeProveedor(proveedorId: string): number;
  /**
   * Compatibilidad: suma o actualiza un producto del carrito (por defecto el primero de la canasta). Mismo negocio
   * o teléfono: cambia la cantidad de ese producto, no se duplica. Cantidad 1 a 20. El público anónimo suma uno nuevo.
   */
  unirseALicitacion(licitacionId: string, participante: NuevoParticipante): Promise<ResultadoUnion>;
  /** Reemplaza el carrito completo (cantidad 0 quita el ítem; carrito vacío sale). Exige `negocioId` o `telefono`. */
  actualizarCarrito(licitacionId: string, carrito: NuevoCarrito): Promise<ResultadoCarrito>;
  /** Fija la cantidad de un producto del carrito sin tocar los demás (0 lo quita). Exige `negocioId` o `telefono`. */
  agregarAlCarrito(licitacionId: string, item: NuevoItemCarrito): Promise<ResultadoCarrito>;
  /** Saca al negocio de la compra (vacía su carrito). Si no estaba, no cambia nada. */
  salirDeLicitacion(licitacionId: string, quien: Pick<DuenoCarrito, 'negocioId' | 'telefono'>): Promise<{ licitacion: SinTelefono<LicitacionVista> }>;
  /** La compra conjunta abierta más reciente, o null. */
  licitacionAbierta(): SinTelefono<LicitacionVista> | null;
  ofertar(licitacionId: string, oferta: NuevaOferta): Promise<LicitacionVista>;
  /**
   * Cierra y crea una orden por participante (`enviada`) con todos los ítems de su carrito, al proveedor de la
   * compra conjunta y al precio vigente de cada producto. Al público sin negocio le crea un negocio comprador. Sin proveedor fijo
   * (licitación antigua), gana la mejor oferta ajustada y solo compran los negocios.
   * Idempotente: si ya cerró, devuelve las mismas órdenes.
   */
  cerrarLicitacion(licitacionId: string): Promise<OrdenCompra[]>;
  /**
   * El proveedor dijo que sí: confirma todas las órdenes de la compra conjunta y emite todas sus facturas 33
   * (una por comprador, una línea de detalle por producto) en UN sobre del SII. Se puede volver a llamar si el SII falló: solo emite lo que falta. Devuelve las facturas.
   */
  confirmarOrdenesDeLicitacion(licitacionId: string): Promise<Documento[]>;
  /** Registra un negocio comprador, o reusa el del mismo teléfono. Con `rut`, lo consulta en el SII y lo guarda. */
  registrarComprador(datos: NuevoComprador): Promise<Negocio>;
  /**
   * Valida el RUT (módulo 11) y trae sus datos del SII, una sola vez por RUT. `datos_invalidos` si no es válido
   * o el SII no lo conoce; `sii_no_disponible` si la consulta falló. Solo interno.
   */
  consultarRut(rut: string): Promise<ContribuyenteDeRut>;
  /** Solo interno (agente de WhatsApp): a qué teléfono avisar por un negocio. */
  telefonoDeNegocio(negocioId: string): string | null;
  /** Foto interna, con teléfonos: solo para el servidor (agente de WhatsApp). */
  estadoDeLaRed(): EstadoRed;
  /** Foto para pantallas y `GET /api/red/estado`: sin teléfonos. */
  estadoPublico(): EstadoPublico;
  negocioPorTelefono(telefono: string): Negocio | null;
  negocioPorId(id: string): Negocio | null;
  /** Nuevo estado en el SII de un documento ya emitido (veredicto del envío). Emite `documento.actualizado`. */
  actualizarEstadoDocumento(tipo: TipoDocumento, folio: number, estadoSii: string): Promise<Documento | null>;
  /**
   * Solo interno: el documento y su representación impresa (con RUT y TED) para dibujar el PDF, o null si no
   * existe o se emitió sin ella. Nunca va en respuestas JSON ni eventos.
   */
  impresoDeDocumento(documentoId: string): { documento: Documento; impreso: DocumentoImpreso } | null;
  /**
   * Enlace privado (absoluto con PUBLIC_URL) al PDF del documento, o null si no tiene representación impresa.
   * Lo usan el agente de WhatsApp y la web (`pdfUrl`). Solo para el dueño del documento: nunca en datos públicos.
   */
  enlacePdf(documento: Pick<Documento, 'id'>): string | null;
  /** Borra órdenes, documentos y eventos y vuelve a sembrar la demo. No toca los folios del SII. Devuelve la foto pública. */
  reiniciarDemo(): Promise<EstadoPublico>;
  /** Se llama con cada `red:evento`; devuelve la función para dejar de escuchar. */
  escuchar(oyente: (evento: EventoRed) => void): () => void;
}

export type EstadoPublico = SinTelefono<EstadoRed>;

export interface OpcionesRed {
  repo: Repositorio;
  sii: PuertoSii;
  reloj?: () => Date;
  /** Variables de la demo (proveedor, producto, tramos). Por defecto `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Consulta de RUT en el SII, ya con cache y fila. Por defecto la falsa (datos simulados). Ver server/red/contribuyente.ts. */
  consultarContribuyente?: ConsultarContribuyente;
}

export const FALTA_RUT = 'Falta tu RUT: tu factura sale a tu nombre en el SII.';
export const RUT_DESCONOCIDO = 'No encontramos ese RUT en el SII. Revísalo e intenta de nuevo.';
export const SII_NO_DISPONIBLE = 'No pudimos consultar tu RUT en el SII. Intenta de nuevo en un momento.';

const netoDespachado = (items: Item[]) => items.reduce((s, i) => s + (i.cantidadDespachada ?? i.cantidad) * i.precioUnitario, 0);
/** Rubro conocido, sin tildes ni mayúsculas; uno desconocido es `otro` y vacío, undefined. */
export function normalizarRubro(texto: unknown): Rubro | undefined {
  const limpio = sinTildes(String(texto ?? '')).trim();
  if (!limpio) return undefined;
  return (RUBROS as readonly string[]).includes(limpio) ? limpio as Rubro : 'otro';
}

// Solo dígitos y los últimos 9 (móvil chileno), para que "+56 9 1234 5678" y "56912345678" coincidan.
const normalizarTelefono = (t: string) => t.replace(/\D/g, '').slice(-9);

/** Id del único producto de una licitación guardada antes de la canasta. */
const PRODUCTO_UNICO = 'producto';

/** Licitaciones guardadas antes de los tramos o de la canasta: un producto con sus tramos y ofertas, y carritos de un ítem. */
function migrarLicitacion(l: Licitacion) {
  l.tramos ??= [{ desde: 1, precioUnitario: l.precioSolo }];
  l.unidad ??= 'unidad';
  l.unidadPlural ??= 'unidades';
  l.ofertas ??= [];
  if (!l.productos?.length) {
    l.productos = [{
      id: PRODUCTO_UNICO, nombre: l.producto, unidad: l.unidad, unidadPlural: l.unidadPlural, precioSolo: l.precioSolo,
      tramos: l.tramos, ofertas: l.ofertas.map(o => ({ ...o, productoId: PRODUCTO_UNICO })),
    }];
  }
  const primero = l.productos[0]!.id;
  for (const p of l.participantes) p.items ??= [{ productoId: primero, cantidad: p.cantidad }];
}

export async function crearRed({
  repo, sii, reloj = () => new Date(), env = process.env,
  consultarContribuyente = conCacheYFila(crearConsultaContribuyenteFalsa(), { intervaloMs: 0 }),
}: OpcionesRed): Promise<Red> {
  const datos: DatosRed = await repo.cargar();
  for (const l of datos.licitaciones) migrarLicitacion(l);
  const oyentes = new Set<(evento: EventoRed) => void>();
  const enCurso = new Set<string>();
  const ahora = () => reloj().toISOString();
  datos.impresos ??= [];

  // Los eventos van a todas las pantallas: salen sin teléfonos.
  function emitir(tipo: TipoEventoRed, payload: unknown) {
    const evento: EventoRed = { tipo, datos: sinTelefonos(payload), en: ahora() };
    for (const oyente of oyentes) {
      try { oyente(evento); } catch (error) { console.error('[red] oyente falló', error); }
    }
  }

  async function guardar<C extends Coleccion>(coleccion: C, entidad: DatosRed[C][number]) {
    const lista = datos[coleccion] as { id: string }[];
    if (!lista.includes(entidad)) lista.push(entidad);
    await repo.guardar(coleccion, entidad);
  }

  // La compra conjunta recibe a toda la sala a la vez: sus cambios se ponen en fila, no se rechazan.
  const filas = new Map<string, Promise<unknown>>();
  function enFila<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const r = (filas.get(id) ?? Promise.resolve()).then(fn);
    const cola = r.catch(() => {});
    filas.set(id, cola);
    cola.then(() => { if (filas.get(id) === cola) filas.delete(id); });
    return r;
  }

  // Evita que dos pedidos simultáneos sobre la misma orden o licitación se pisen
  // mientras se espera al SII o a la base.
  async function conCandado<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (enCurso.has(id)) throw new ErrorRed('ocupado', `${id} se está procesando, intenta de nuevo`);
    enCurso.add(id);
    try { return await fn(); } finally { enCurso.delete(id); }
  }

  function negocio(id: string, rol: Negocio['rol']): Negocio {
    const n = datos.negocios.find(x => x.id === id);
    if (!n) throw new ErrorRed('no_encontrado', `No existe el negocio ${id}`);
    if (n.rol !== rol) throw new ErrorRed('datos_invalidos', `${n.nombre} no es ${rol}`);
    return n;
  }

  function orden(id: string, ...estados: EstadoOrden[]): OrdenCompra {
    const o = datos.ordenes.find(x => x.id === id);
    if (!o) throw new ErrorRed('no_encontrado', `No existe la orden ${id}`);
    if (!estados.includes(o.estado)) {
      throw new ErrorRed('transicion_invalida', `La orden ${id} está ${o.estado}, se esperaba ${estados.join(' o ')}`);
    }
    return o;
  }

  function licitacionEnCurso(id: string): Licitacion {
    const l = datos.licitaciones.find(x => x.id === id);
    if (!l) throw new ErrorRed('no_encontrado', `No existe la licitación ${id}`);
    if (l.estado !== 'abierta') throw new ErrorRed('transicion_invalida', `La licitación ${id} ya cerró`);
    return l;
  }

  function documento(ordenId: string, tipo: TipoDocumento) {
    return datos.documentos.find(d => d.ordenId === ordenId && d.tipo === tipo);
  }

  const notaDeProveedor = (proveedorId: string) => calcularNota(datos.eventosReputacion, proveedorId);

  async function registrarReputacion(proveedorId: string, ordenId: string, tipo: TipoEventoReputacion) {
    const anterior = notaDeProveedor(proveedorId);
    await guardar('eventosReputacion', { id: randomUUID(), proveedorId, ordenId, tipo, en: ahora() });
    const nota = notaDeProveedor(proveedorId);
    if (nota !== anterior) emitir('nota.cambiada', { proveedorId, anterior, nota });
  }

  async function guardarDocumento(ordenId: string, tipo: TipoDocumento, monto: number, r: ResultadoSii) {
    const doc: Documento = { id: randomUUID(), ordenId, tipo, folio: r.folio, trackId: r.trackId, estadoSii: r.estadoSii, monto, emitidoEn: ahora() };
    // Antes que el documento: quien reciba `documento.emitido` ya puede pedir su PDF.
    if (r.impreso) await guardar('impresos', { id: doc.id, impreso: r.impreso });
    await guardar('documentos', doc);
    emitir('documento.emitido', { documento: doc });
    return doc;
  }

  function validarItems(proveedorId: string, items: unknown): Item[] {
    if (!Array.isArray(items) || items.length === 0) throw new ErrorRed('datos_invalidos', 'La orden necesita al menos un ítem');
    return items.map((i: Partial<NuevoItem>) => {
      const texto = String(i?.producto ?? '').trim();
      const producto = normalizarProducto(texto) ?? texto;
      const cantidad = Number(i?.cantidad);
      const precioUnitario = i?.precioUnitario === undefined ? precioDe(proveedorId, producto) : Number(i.precioUnitario);
      const productoId = typeof i?.productoId === 'string' && i.productoId ? i.productoId : undefined;
      if (!producto || !Number.isInteger(cantidad) || cantidad <= 0) {
        throw new ErrorRed('datos_invalidos', 'Cada ítem necesita producto y cantidad entera positiva');
      }
      if (precioUnitario === undefined) {
        throw new ErrorRed('datos_invalidos', `No tenemos precio para "${texto}". Productos: ${PRODUCTOS_DISPONIBLES.join(', ')}`);
      }
      if (!(precioUnitario > 0)) throw new ErrorRed('datos_invalidos', 'El precio debe ser positivo');
      return { ...(productoId ? { productoId } : {}), producto, cantidad, precioUnitario };
    });
  }

  async function crearOrden({ compradorId, proveedorId, items }: NuevaOrden): Promise<OrdenCompra> {
    negocio(compradorId, 'comprador');
    negocio(proveedorId, 'proveedor');
    const nueva: OrdenCompra = {
      // El sufijo hace único el id aunque la demo se reinicie: el SII real lleva los folios por orden y
      // una "OC-1001" nueva tras el reinicio no debe heredar la factura de la anterior.
      id: `OC-${1001 + datos.ordenes.length}-${randomUUID().slice(0, 4).toUpperCase()}`,
      compradorId, proveedorId, items: validarItems(proveedorId, items), estado: 'enviada', creadaEn: ahora(),
    };
    await guardar('ordenes', nueva);
    emitir('orden.creada', { orden: nueva });
    return structuredClone(nueva);
  }

  // Despacho parcial: la guía 52 dirá menos unidades que la orden (y que la factura 33).
  // Es la escena "la OC dice 4, la guía dice 2" que termina en reclamo y nota de crédito.
  function fijarDespacho(ordenId: string, cantidad: number, producto?: string) {
    return conCandado(ordenId, async () => {
      const o = orden(ordenId, 'enviada');
      const item = producto ? o.items.find(i => i.producto === (normalizarProducto(producto) ?? producto)) : o.items[0];
      if (!item) throw new ErrorRed('datos_invalidos', `La orden no tiene ${producto}`);
      if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > item.cantidad) {
        throw new ErrorRed('datos_invalidos', `Lo despachado debe estar entre 0 y ${item.cantidad}`);
      }
      item.cantidadDespachada = cantidad;
      await guardar('ordenes', o);
      return structuredClone(o);
    });
  }

  // El proveedor confirma: recién ahí se emiten la factura 33 (con la OC) y la guía 52.
  // Si el SII falla a mitad, la orden queda confirmada y se puede volver a llamar:
  // solo se emite lo que falta.
  function confirmarOrden(ordenId: string) {
    return conCandado(ordenId, async () => {
      const o = orden(ordenId, 'enviada', 'confirmada');
      const datosEmision = { orden: o, emisor: negocio(o.proveedorId, 'proveedor'), receptor: negocio(o.compradorId, 'comprador') };
      if (o.estado === 'enviada') {
        for (const i of o.items) i.cantidadDespachada ??= i.cantidad;
        o.estado = 'confirmada';
        await guardar('ordenes', o);
        emitir('orden.confirmada', { orden: o });
      }
      if (!documento(o.id, 33)) await guardarDocumento(o.id, 33, neto(o.items), await sii.emitirFactura(datosEmision));
      if (!documento(o.id, 52)) await guardarDocumento(o.id, 52, netoDespachado(o.items), await sii.emitirGuia(datosEmision));
      o.estado = 'facturada';
      await guardar('ordenes', o);
      return structuredClone(o);
    });
  }

  // El comprador informa la recepción. Con faltante se registra el reclamo en el SII.
  function registrarRecepcion(ordenId: string, recepcion: Recepcion) {
    return conCandado(ordenId, async () => {
      const o = orden(ordenId, 'facturada');
      if ('conforme' in recepcion && recepcion.conforme === true) {
        o.estado = 'recibida';
        await guardar('ordenes', o);
        emitir('recepcion.registrada', { orden: o, conforme: true });
        await registrarReputacion(o.proveedorId, o.id, 'entrega_conforme');
        return structuredClone(o);
      }
      const { faltante, producto } = recepcion as { faltante: number; producto?: string };
      const item = producto ? o.items.find(i => i.producto === (normalizarProducto(producto) ?? producto)) : o.items[0];
      if (!item) throw new ErrorRed('datos_invalidos', `La orden no tiene ${producto}`);
      if (!Number.isInteger(faltante) || faltante <= 0 || faltante > item.cantidad) {
        throw new ErrorRed('datos_invalidos', `El faltante debe estar entre 1 y ${item.cantidad}`);
      }
      const factura = documento(o.id, 33);
      if (!factura) throw new ErrorRed('transicion_invalida', `La orden ${o.id} no tiene factura`);
      const comprador = negocio(o.compradorId, 'comprador');
      const motivo = `Faltan ${faltante} de ${item.cantidad} unidades de ${item.producto}`;
      const { estadoSii } = await sii.registrarReclamo({ factura, receptor: comprador, motivo });
      o.estado = 'reclamada';
      o.reclamo = { producto: item.producto, faltante, en: ahora(), estadoSii };
      await guardar('ordenes', o);
      emitir('recepcion.registrada', { orden: o, conforme: false, faltante });
      emitir('reclamo.registrado', { orden: o, reclamo: o.reclamo, motivo });
      await registrarReputacion(o.proveedorId, o.id, 'reclamo');
      return structuredClone(o);
    });
  }

  // El proveedor responde al reclamo con una nota de crédito por lo que faltó.
  // Si es el mismo día del reclamo (hora de Chile), recupera parte de su nota.
  function emitirNotaCredito(ordenId: string) {
    return conCandado(ordenId, async () => {
      const o = orden(ordenId, 'reclamada');
      const reclamo = o.reclamo!;
      const factura = documento(o.id, 33)!;
      const item = o.items.find(i => i.producto === reclamo.producto)!;
      const items = [{ producto: item.producto, cantidad: reclamo.faltante, precioUnitario: item.precioUnitario }];
      const r = await sii.emitirNotaCredito({
        orden: o, emisor: negocio(o.proveedorId, 'proveedor'), receptor: negocio(o.compradorId, 'comprador'), factura, items,
      });
      const doc = await guardarDocumento(o.id, 61, neto(items), r);
      o.estado = 'corregida';
      await guardar('ordenes', o);
      emitir('nota_credito.emitida', { orden: o, documento: doc });
      if (fechaEnChile(doc.emitidoEn) === fechaEnChile(reclamo.en)) await registrarReputacion(o.proveedorId, o.id, 'nota_credito_mismo_dia');
      return structuredClone(doc);
    });
  }

  const textoCorto = (x: unknown) => String(x ?? '').trim().slice(0, 40);

  // RUT del comprador: una consulta al SII por RUT. Primero se busca en los negocios guardados (sobrevive a
  // reinicios del servidor); si no, la consulta del puerto, que ya trae su propia cache y fila.
  async function consultarRut(texto: string): Promise<ContribuyenteDeRut> {
    const rut = validarRut(texto);
    if (!rut) throw new ErrorRed('datos_invalidos', RUT_INVALIDO);
    const conocido = datos.negocios.find(n => n.rut === rut && n.contribuyente)?.contribuyente;
    if (conocido) return { rut, ...structuredClone(conocido) };
    let encontrado: DatosContribuyente | null;
    try {
      encontrado = await consultarContribuyente(rut);
    } catch (error) {
      console.error(`[red] no se pudo consultar un RUT en el SII: ${error instanceof Error ? error.message : String(error)}`);
      throw new ErrorRed('sii_no_disponible', SII_NO_DISPONIBLE);
    }
    if (!encontrado) throw new ErrorRed('datos_invalidos', RUT_DESCONOCIDO);
    return { rut, ...structuredClone(encontrado) };
  }

  const camposRut = ({ rut, ...contribuyente }: ContribuyenteDeRut): Pick<Negocio, 'rut' | 'contribuyente'> => ({ rut, contribuyente });

  /** Deja el RUT y sus datos del SII en el negocio (si cambió) y lo guarda. */
  async function asignarRut(n: Negocio, delSii: ContribuyenteDeRut) {
    if (n.rut === delSii.rut && n.contribuyente) return;
    Object.assign(n, camposRut(delSii));
    await guardar('negocios', n);
  }

  async function registrarComprador({ nombre, comuna, telefono, rubro, rut, negocioId }: NuevoComprador) {
    // La consulta al SII va antes de la fila: una sala que se suma de golpe no espera detrás de cada consulta.
    const delSii = rut === undefined ? undefined : await consultarRut(rut);
    return enFila('compradores', async () => {
      const tel = telefono ? normalizarTelefono(telefono) : '';
      const existente = negocioId ? negocio(negocioId, 'comprador')
        : tel ? datos.negocios.find(n => normalizarTelefono(n.telefono) === tel) : undefined;
      if (existente) {
        if (existente.rol !== 'comprador') throw new ErrorRed('datos_invalidos', `${existente.nombre} es proveedor, no puede comprar en la red`);
        if (delSii) await asignarRut(existente, delSii);
        return structuredClone(existente);
      }
      const limpio = textoCorto(nombre);
      if (!limpio) throw new ErrorRed('datos_invalidos', 'Falta el nombre');
      const r = normalizarRubro(rubro);
      const n: Negocio = {
        id: `n-c-${randomUUID().slice(0, 8)}`, nombre: limpio, comuna: textoCorto(comuna), rol: 'comprador', telefono: telefono?.trim() ?? '',
        ...(r ? { rubro: r } : {}),
      };
      if (delSii) Object.assign(n, camposRut(delSii));
      await guardar('negocios', n);
      return structuredClone(n);
    });
  }

  function validarCantidad(cantidad: number, minimo: 0 | 1) {
    if (!Number.isInteger(cantidad) || cantidad < minimo || cantidad > CANTIDAD_MAXIMA) {
      throw new ErrorRed('datos_invalidos', `La cantidad debe ser un entero entre ${minimo} y ${CANTIDAD_MAXIMA}`);
    }
  }

  function productoDeLicitacion(l: Licitacion, productoId?: string) {
    const p = productoDe(l, productoId);
    if (!p) throw new ErrorRed('datos_invalidos', `No existe el producto ${productoId}. Productos: ${l.productos.map(x => x.id).join(', ')}`);
    return p;
  }

  /** El negocio comprador de quien edita su carrito. Con `crear`, registra el teléfono nuevo. */
  async function compradorDe(q: DuenoCarrito, crear: boolean): Promise<Negocio | undefined> {
    if (q.negocioId) {
      const n = negocio(q.negocioId, 'comprador');
      if (q.rut !== undefined) await asignarRut(n, await consultarRut(q.rut));
      return n;
    }
    if (!q.telefono) return undefined;
    const tel = normalizarTelefono(q.telefono);
    const existente = tel ? datos.negocios.find(n => normalizarTelefono(n.telefono) === tel) : undefined;
    if (existente?.rol === 'proveedor') throw new ErrorRed('datos_invalidos', `${existente.nombre} es proveedor, no puede comprar en la red`);
    if (existente) {
      if (q.rut !== undefined) await asignarRut(existente, await consultarRut(q.rut));
      return existente;
    }
    if (!crear) return undefined;
    return registrarComprador({ nombre: q.nombre ?? '', comuna: q.comuna, telefono: q.telefono, rubro: q.rubro, rut: q.rut });
  }

  /**
   * Cambia el carrito de un participante y avisa: `licitacion.participante` (entra, cambia o sale) y un
   * `licitacion.precio_bajo` por cada producto cuyo precio bajó. Sin negocio (público anónimo) suma uno nuevo.
   */
  async function cambiarCarrito(l: Licitacion, n: Negocio | undefined, anonimo: DuenoCarrito, cambiar: (items: Map<string, number>) => void) {
    const antes = preciosVigentes(l);
    const actual = n ? l.participantes.find(x => x.negocioId === n.id) : undefined;
    const items = new Map((actual?.items ?? []).map(i => [i.productoId, i.cantidad]));
    cambiar(items);
    const carrito = l.productos.filter(p => (items.get(p.id) ?? 0) > 0).map(p => ({ productoId: p.id, cantidad: items.get(p.id)! }));
    const cantidad = carrito.reduce((s, i) => s + i.cantidad, 0);

    let participante: Participante | null;
    let accion: 'entra' | 'cambia' | 'sale';
    if (carrito.length === 0) {
      if (!actual) return { licitacion: sinTelefonos(vistaLicitacion(l)), participante: null, bajadas: [] };
      l.participantes = l.participantes.filter(x => x !== actual);
      participante = null;
      accion = 'sale';
    } else if (actual) {
      Object.assign(actual, { items: carrito, cantidad });
      participante = actual;
      accion = 'cambia';
    } else if (n) {
      participante = {
        negocioId: n.id, nombre: n.nombre, ...(n.comuna ? { comuna: n.comuna } : {}), ...(n.rubro ? { rubro: n.rubro } : {}),
        ...(n.telefono ? { telefono: n.telefono } : {}),
        items: carrito, cantidad, en: ahora(),
      };
      l.participantes.push(participante);
      accion = 'entra';
    } else {
      const nombre = textoCorto(anonimo.nombre);
      if (!nombre) throw new ErrorRed('datos_invalidos', 'Falta el nombre');
      const comuna = textoCorto(anonimo.comuna);
      const rubro = normalizarRubro(anonimo.rubro);
      participante = { nombre, ...(comuna ? { comuna } : {}), ...(rubro ? { rubro } : {}), items: carrito, cantidad, en: ahora() };
      l.participantes.push(participante);
      accion = 'entra';
    }
    await guardar('licitaciones', l);
    const vista = vistaLicitacion(l);
    const evento = participante ?? { ...actual!, items: [], cantidad: 0 };
    emitir('licitacion.participante', { licitacionId: l.id, licitacion: vista, participante: evento, accion });
    const bajadas: BajadaPrecio[] = [];
    for (const p of vista.productos) {
      const precioAnterior = antes.get(p.id)!;
      if (p.precioActual >= precioAnterior) continue;
      bajadas.push({ productoId: p.id, precioAnterior, precioNuevo: p.precioActual });
      emitir('licitacion.precio_bajo', {
        licitacionId: l.id, productoId: p.id, precioAnterior, precioNuevo: p.precioActual, totalUnidades: p.totalUnidades,
      });
    }
    return { licitacion: sinTelefonos(vista), participante: participante && sinTelefonos(participante), bajadas };
  }

  function exigirDueno(q: DuenoCarrito) {
    if (!q.negocioId && !q.telefono) throw new ErrorRed('datos_invalidos', 'El carrito necesita negocioId o telefono');
  }

  function actualizarCarrito(licitacionId: string, c: NuevoCarrito) {
    return enFila(licitacionId, async (): Promise<ResultadoCarrito> => {
      const l = licitacionEnCurso(licitacionId);
      exigirDueno(c);
      if (!Array.isArray(c.items)) throw new ErrorRed('datos_invalidos', 'items debe ser una lista de { productoId, cantidad }');
      const nuevos = c.items.map(i => {
        const cantidad = Number(i?.cantidad);
        validarCantidad(cantidad, 0);
        return { productoId: productoDeLicitacion(l, String(i?.productoId ?? '')).id, cantidad };
      });
      const n = await compradorDe(c, nuevos.some(i => i.cantidad > 0));
      return cambiarCarrito(l, n, c, items => {
        items.clear();
        for (const i of nuevos) items.set(i.productoId, i.cantidad);
      });
    });
  }

  function agregarAlCarrito(licitacionId: string, i: NuevoItemCarrito) {
    return enFila(licitacionId, async (): Promise<ResultadoCarrito> => {
      const l = licitacionEnCurso(licitacionId);
      exigirDueno(i);
      const productoId = productoDeLicitacion(l, String(i.productoId ?? '')).id;
      const cantidad = Number(i.cantidad);
      validarCantidad(cantidad, 0);
      const n = await compradorDe(i, cantidad > 0);
      return cambiarCarrito(l, n, i, items => { items.set(productoId, cantidad); });
    });
  }

  function salirDeLicitacion(licitacionId: string, q: Pick<DuenoCarrito, 'negocioId' | 'telefono'>) {
    return enFila(licitacionId, async () => {
      const l = licitacionEnCurso(licitacionId);
      exigirDueno(q);
      const n = await compradorDe(q, false);
      const { licitacion } = await cambiarCarrito(l, n, q, items => { items.clear(); });
      return { licitacion };
    });
  }

  // Compatibilidad con la compra de un solo producto: fija la cantidad de un producto (por defecto el primero).
  // Un mismo negocio (o teléfono) que vuelve a sumarse cambia su cantidad, no aparece dos veces.
  function unirseALicitacion(licitacionId: string, p: NuevoParticipante) {
    return enFila(licitacionId, async (): Promise<ResultadoUnion> => {
      const l = licitacionEnCurso(licitacionId);
      const cantidad = Number(p.cantidad);
      validarCantidad(cantidad, 1);
      const producto = productoDeLicitacion(l, p.productoId);
      const n = await compradorDe(p, true);
      const r = await cambiarCarrito(l, n, p, items => { items.set(producto.id, cantidad); });
      const precioActual = r.licitacion.productos.find(x => x.id === producto.id)!.precioActual;
      return { licitacion: r.licitacion, participante: r.participante!, precioActual, bajoDePrecio: r.bajadas.some(b => b.productoId === producto.id) };
    });
  }

  function licitacionAbierta() {
    const l = datos.licitaciones.filter(x => x.estado === 'abierta').at(-1);
    return l ? sinTelefonos(vistaLicitacion(l)) : null;
  }

  // Oferta por un producto de la canasta (por defecto el primero). Reemplaza la anterior del mismo proveedor en ese producto.
  function ofertar(licitacionId: string, o: NuevaOferta) {
    return enFila(licitacionId, async () => {
      const l = licitacionEnCurso(licitacionId);
      const proveedor = negocio(o.proveedorId, 'proveedor');
      const producto = productoDeLicitacion(l, o.productoId);
      const antes = precioVigente(l, producto.id);
      const precioUnitario = Number(o.precioUnitario), plazoDias = Number(o.plazoDias);
      if (!(precioUnitario > 0) || !Number.isInteger(plazoDias) || plazoDias < 0) {
        throw new ErrorRed('datos_invalidos', 'La oferta necesita precio positivo y plazo en días enteros');
      }
      const oferta: Oferta = { proveedorId: o.proveedorId, productoId: producto.id, precioUnitario, plazoDias, en: ahora() };
      producto.ofertas = producto.ofertas.filter(x => x.proveedorId !== o.proveedorId).concat(oferta);
      await guardar('licitaciones', l);
      const vista = vistaLicitacion(l);
      const nota = notaDeProveedor(o.proveedorId);
      const unidades = unidadesDe(l, producto.id);
      // La mejor del momento en ese producto: más barata que las demás ofertas y que el precio del tramo alcanzado.
      const mejor = precioUnitario <= precioPorVolumen(producto, unidades)
        && producto.ofertas.every(x => x === oferta || x.precioUnitario > precioUnitario);
      emitir('licitacion.oferta', {
        licitacionId: l.id, productoId: producto.id, licitacion: vista, oferta: { ...oferta, proveedorNombre: proveedor.nombre, nota }, nota, mejor,
      });
      const precioNuevo = precioVigente(l, producto.id);
      if (precioNuevo < antes) {
        emitir('licitacion.precio_bajo', {
          licitacionId: l.id, productoId: producto.id, precioAnterior: antes, precioNuevo, totalUnidades: unidades,
        });
      }
      return vista;
    });
  }

  // Compra conjunta: una orden por participante al proveedor único, al precio del tramo alcanzado.
  // Sin proveedor fijo (licitación antigua): gana el menor precio ajustado por nota y plazo, y solo
  // compran los negocios participantes.
  // Idempotente: cerrar una que ya cerró (p. ej. el agente al llegar `cierraEn` y el proveedor a la vez)
  // devuelve las órdenes ya creadas, sin crear otras ni emitir eventos.
  function cerrarLicitacion(licitacionId: string) {
    return enFila(licitacionId, async () => {
      const yaCerrada = datos.licitaciones.find(x => x.id === licitacionId && x.estado === 'cerrada');
      if (yaCerrada) return structuredClone(datos.ordenes.filter(o => yaCerrada.ordenIds?.includes(o.id)));
      const l = licitacionEnCurso(licitacionId);
      const compras: { participante: Participante; proveedorId: string; precio: (productoId: string) => number }[] = [];
      if (l.proveedorId) {
        negocio(l.proveedorId, 'proveedor');
        const precios = preciosVigentes(l);
        for (const p of l.participantes) compras.push({ participante: p, proveedorId: l.proveedorId, precio: id => precios.get(id)! });
      } else {
        const candidatas = (l.productos[0]?.ofertas ?? []).map(o => {
          const nota = notaDeProveedor(o.proveedorId);
          return { ...o, nota, precioAjustado: precioAjustado(o, nota) };
        });
        candidatas.sort((a, b) => a.precioAjustado - b.precioAjustado);
        if (candidatas[0]) l.ganadora = candidatas[0];
        const g = l.ganadora;
        if (g) for (const p of l.participantes.filter(x => x.negocioId)) compras.push({ participante: p, proveedorId: g.proveedorId, precio: () => g.precioUnitario });
      }
      l.estado = 'cerrada';
      await guardar('licitaciones', l);
      const ordenes: OrdenCompra[] = [];
      const nombres = new Map(l.productos.map(x => [x.id, x.nombre]));
      for (const { participante: p, proveedorId, precio } of compras) {
        p.negocioId ??= (await registrarComprador({ nombre: p.nombre, comuna: p.comuna, telefono: p.telefono, rubro: p.rubro })).id;
        const items = p.items.map(i => ({ productoId: i.productoId, producto: nombres.get(i.productoId) ?? l.producto, cantidad: i.cantidad, precioUnitario: precio(i.productoId) }));
        ordenes.push(await crearOrden({ compradorId: p.negocioId, proveedorId, items }));
      }
      l.ordenIds = ordenes.map(o => o.id);
      await guardar('licitaciones', l);
      emitir('licitacion.cerrada', { licitacion: vistaLicitacion(l), ordenes });
      return ordenes;
    });
  }

  // El proveedor confirma la compra conjunta: todas las facturas 33 en un solo sobre del SII.
  function confirmarOrdenesDeLicitacion(licitacionId: string) {
    return enFila(licitacionId, async () => {
      const l = datos.licitaciones.find(x => x.id === licitacionId);
      if (!l) throw new ErrorRed('no_encontrado', `No existe la licitación ${licitacionId}`);
      if (l.estado !== 'cerrada' || !l.ordenIds) throw new ErrorRed('transicion_invalida', `La licitación ${licitacionId} todavía no cierra`);
      const ordenes = l.ordenIds.map(id => datos.ordenes.find(o => o.id === id)).filter((o): o is OrdenCompra => !!o);
      const ocupada = ordenes.find(o => enCurso.has(o.id));
      if (ocupada) throw new ErrorRed('ocupado', `${ocupada.id} se está procesando, intenta de nuevo`);
      for (const o of ordenes) enCurso.add(o.id);
      try {
        for (const o of ordenes.filter(x => x.estado === 'enviada')) {
          for (const i of o.items) i.cantidadDespachada ??= i.cantidad;
          o.estado = 'confirmada';
          await guardar('ordenes', o);
          emitir('orden.confirmada', { orden: o });
        }
        const confirmadas = ordenes.filter(o => o.estado === 'confirmada');
        const sinFactura = confirmadas.filter(o => !documento(o.id, 33));
        if (sinFactura.length > 0) {
          const resultados = await sii.emitirFacturas(sinFactura.map(o => ({
            orden: o, emisor: negocio(o.proveedorId, 'proveedor'), receptor: negocio(o.compradorId, 'comprador'),
          })));
          for (const [k, o] of sinFactura.entries()) await guardarDocumento(o.id, 33, neto(o.items), resultados[k]!);
        }
        for (const o of confirmadas) {
          o.estado = 'facturada';
          await guardar('ordenes', o);
        }
      } finally {
        for (const o of ordenes) enCurso.delete(o.id);
      }
      const facturas = ordenes.map(o => documento(o.id, 33)).filter((d): d is Documento => !!d);
      const precioSolo = (i: Item) => productoDe(l, i.productoId)?.precioSolo ?? l.precioSolo;
      const ahorroTotal = ordenes.reduce((s, o) => s + o.items.reduce((t, i) => t + (precioSolo(i) - i.precioUnitario) * i.cantidad, 0), 0);
      emitir('licitacion.facturada', {
        licitacionId: l.id, documentos: facturas.length, total: facturas.reduce((s, d) => s + d.monto, 0), ahorroTotal,
      });
      return structuredClone(facturas);
    });
  }

  async function actualizarEstadoDocumento(tipo: TipoDocumento, folio: number, estadoSii: string) {
    const doc = datos.documentos.find(d => d.tipo === tipo && d.folio === folio);
    // Tras reiniciar la demo el documento ya no está en la red, pero su folio sigue usado en el SII.
    if (!doc) return null;
    if (doc.estadoSii !== estadoSii) {
      doc.estadoSii = estadoSii;
      await guardar('documentos', doc);
      emitir('documento.actualizado', { documento: doc });
    }
    return structuredClone(doc);
  }

  async function reiniciarDemo() {
    await repo.vaciar();
    await sembrar(repo, reloj(), env);
    Object.assign(datos, await repo.cargar());
    const estado = estadoPublico();
    emitir('red.reiniciada', estado);
    return estado;
  }

  sii.alCambiarEstado?.(({ tipo, folio, estadoSii }) => {
    actualizarEstadoDocumento(tipo, folio, estadoSii).catch(error => console.error('[red] no se pudo actualizar el documento', error));
  });

  function estadoDeLaRed(): EstadoRed {
    const notas: Record<string, number> = {};
    // El ranking es la historia de proveedores ficticios de harina: la empresa real de la sala no entra (su nota
    // va en su panel), ni sus competidores (su nota viaja en cada `licitacion.oferta`).
    const fuera = new Set<string>([PROVEEDOR_SALA, ...COMPETIDORES_SALA.map(c => c.id)]);
    for (const n of datos.negocios) if (n.rol === 'proveedor' && !fuera.has(n.id)) notas[n.id] = notaDeProveedor(n.id);
    return structuredClone({
      negocios: datos.negocios, ordenes: datos.ordenes, documentos: datos.documentos, notas, licitaciones: datos.licitaciones.map(vistaLicitacion),
    });
  }

  const estadoPublico = () => sinTelefonos(estadoDeLaRed());

  function negocioPorTelefono(telefono: string) {
    const buscado = normalizarTelefono(telefono);
    const n = buscado ? datos.negocios.find(x => normalizarTelefono(x.telefono) === buscado) : undefined;
    return n ? structuredClone(n) : null;
  }

  function impresoDeDocumento(documentoId: string) {
    const documento = datos.documentos.find(d => d.id === documentoId);
    const impreso = datos.impresos.find(i => i.id === documentoId)?.impreso;
    return documento && impreso ? structuredClone({ documento, impreso }) : null;
  }

  function enlaceAlPdf(documento: Pick<Documento, 'id'>) {
    return datos.impresos.some(i => i.id === documento.id) ? enlacePdf(documento, env) : null;
  }

  function negocioPorId(id: string) {
    const n = datos.negocios.find(x => x.id === id);
    return n ? structuredClone(n) : null;
  }

  function telefonoDeNegocio(negocioId: string) {
    return datos.negocios.find(n => n.id === negocioId)?.telefono || null;
  }

  return {
    telefonoDeNegocio,
    negocioPorId,
    impresoDeDocumento,
    enlacePdf: enlaceAlPdf,
    crearOrden, fijarDespacho, confirmarOrden, registrarRecepcion, emitirNotaCredito, notaDeProveedor,
    unirseALicitacion, actualizarCarrito, agregarAlCarrito, salirDeLicitacion, licitacionAbierta, ofertar, cerrarLicitacion, confirmarOrdenesDeLicitacion, registrarComprador, consultarRut, estadoDeLaRed, estadoPublico, negocioPorTelefono, actualizarEstadoDocumento, reiniciarDemo,
    escuchar(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
