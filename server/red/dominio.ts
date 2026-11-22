import { randomUUID } from 'node:crypto';
import { fechaEnChile } from '../../shared/fecha.ts';
import { sinTildes } from '../../shared/texto.ts';
import { normalizarProducto, precioDe, PRODUCTOS_DISPONIBLES } from './catalogo.ts';
import { duenoDeTramos, errorDeTramos, neto, ofertasQueCompiten, ordenarTramos, precioDeOferta, precioPorVolumen, puedeCerrarAntes, repartirPorStock, tramosAutomaticos, unidadesDe } from '../../shared/precios.ts';
import { puedeComprar, puedeVender } from '../../shared/red.ts';
import { POR_ENTREGAR } from '../../shared/ruta.ts';
import { pluralDe } from '../../shared/texto.ts';
import { pluralUnidad, unidadDeTexto, type IdUnidad } from '../../shared/unidades.ts';
import { mismoProducto } from '../../shared/productos.ts';
import { candidatasDe, precioVigente as precioVigenteCon, preciosVigentes as preciosVigentesCon, productoDe, repartoDelGrupo, vistaLicitacion as vistaLicitacionCon, vistaProducto as vistaProductoCon } from './compra.ts';
import type { ContextoPrecio } from './compra.ts';
import { CANTIDAD_MAXIMA } from '../../shared/red.ts';

/** Cuánto dura una solicitud de compra en grupo si no se dice: un día. Lo máximo: una semana. */
const MINUTOS_SOLICITUD = 24 * 60;
const MAXIMO_MINUTOS_SOLICITUD = 7 * 24 * 60;
import { enlacePdf } from './pdf-enlace.ts';
import { sinTelefonos } from './publico.ts';
import type { SinTelefono } from './publico.ts';
import { calcularNota } from './reputacion.ts';
import { conCacheYFila, crearConsultaContribuyenteFalsa } from './contribuyente.ts';
import type { ConsultarContribuyente, DatosContribuyente } from './contribuyente.ts';
import { RUT_INVALIDO, RUT_SIN_CONFIRMAR, validarRut } from '../../shared/rut.ts';
import { RUBROS } from './tipos.ts';
import { COMPETIDORES_SALA, LICITACION_SALA, PROVEEDOR_SALA, sembrar } from './semilla.ts';
import type { DocumentoImpreso } from '../sii/index.ts';
import type { PuertoSii, ResultadoSii } from './sii.ts';
import type { Repositorio } from './repositorio.ts';
import type {
  Coleccion, DatosRed, Documento, EstadoOrden, EstadoRed, EventoRed, Ganadora, Item, ItemCarrito, Licitacion, LicitacionVista, Negocio,
  Oferta, OrdenCompra, Participante, ProductoCompra, ProductoCompraVista, Rubro, TipoDocumento, Tramo, TipoEventoRed, TipoEventoReputacion,
} from './tipos.ts';

export type CodigoError =
  | 'no_encontrado' | 'transicion_invalida' | 'datos_invalidos' | 'ocupado'
  // Canal web: sin sesión, sesión de otro negocio, o acción legal sin `confirmado: true`.
  | 'no_autorizado' | 'prohibido' | 'confirmacion_requerida'
  // No se pudo consultar un RUT en el SII (corte o sesión caída): se puede intentar de nuevo.
  | 'sii_no_disponible'
  // No alcanzan los folios del SII para emitir (se intentó reponerlos): nada se envió.
  | 'sin_folios'
  // Crédito Bando: para entrar a una compra hay que tener la tarjeta inscrita (el mensaje trae el enlace para inscribirla).
  | 'falta_tarjeta';

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
  /**
   * Dirección para la factura que confirmó o escribió la persona (WhatsApp). Reemplaza la del SII en sus datos de
   * contribuyente, que son privados y son los que usa la factura. Solo interno.
   */
  direccionFactura?: { direccion: string; comuna: string };
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
  /** Dirección para su factura (la consulta pública del SII no la trae): sin ella, su factura no se puede emitir. */
  direccionFactura?: { direccion: string; comuna: string };
}

/** Lo que el comprador ve de sí mismo: a quién sale su factura. Solo para su dueño, nunca en datos públicos. */
export interface ContribuyenteDeRut extends DatosContribuyente {
  rut: string;
}

export type NuevaOferta = Omit<Oferta, 'en'>;

export interface NuevaSolicitud {
  compradorId: string;
  /** El producto como lo escribe el comprador ("Etiquetas adhesivas 50x30"). */
  producto: string;
  /** Unidad de venta de la lista (`UNIDADES`) o como la escribe la persona ("kg", "la bolsa"). */
  unidad: string;
  cantidad: number;
  /** Lo que paga hoy por unidad, si lo sabe: la referencia del ahorro. Si no, `precioDeReferencia`. */
  precioHoy?: number;
  /** Cuánto dura abierta, en minutos (por defecto un día; máximo una semana). */
  minutos?: number;
}

export interface NuevoProducto {
  proveedorId: string;
  nombre: string;
  /** Unidad de venta en singular ("caja"); el plural se deduce si no viene. */
  unidad: string;
  unidadPlural?: string;
  /** Precio neto por unidad comprando de a una: el primer tramo. */
  precio: number;
  /** Tramos propios (los que sugiere su historial de facturas). Sin ellos, los automáticos desde `precio`. */
  tramos?: Tramo[];
  /** Unidades que tiene para vender, opcional. */
  stock?: number;
}

export interface NuevoProveedor {
  telefono: string;
  /** RUT de la empresa que emite las facturas (con o sin puntos y guion). */
  rut: string;
  /** Nombre de fantasía; por defecto la razón social del SII. */
  nombre?: string;
  comuna?: string;
}

export interface Red {
  crearOrden(nueva: NuevaOrden): Promise<OrdenCompra>;
  /** Antes de confirmar: cuántas unidades dirá la guía de despacho (52), si son menos que las pedidas. */
  fijarDespacho(ordenId: string, cantidad: number, producto?: string): Promise<OrdenCompra>;
  confirmarOrden(ordenId: string): Promise<OrdenCompra>;
  /** Antes de repartir: la guía de despacho (52) de cada pedido por entregar del proveedor que aún no la tiene. */
  emitirGuiasDeReparto(proveedorId: string): Promise<Documento[]>;
  registrarRecepcion(ordenId: string, recepcion: Recepcion): Promise<OrdenCompra>;
  emitirNotaCredito(ordenId: string): Promise<Documento>;
  notaDeProveedor(proveedorId: string): number;
  /** Si el proveedor puede competir y ganar: los de la demo siempre; quien se registró a vender, con su SII conectado. */
  puedeFacturar(proveedorId: string): Promise<boolean>;
  /**
   * Vuelve a revisar quién puede facturar en las compras abiertas (al conectar un SII o reponer folios). Por cada oferta
   * o producto que pasa a competir (o deja de hacerlo) emite `licitacion.producto` con `cambio: 'facturacion'`, y
   * `licitacion.precio_bajo` si el precio del grupo bajó.
   */
  revisarFacturacion(): Promise<void>;
  /**
   * Compatibilidad: suma o actualiza un producto del carrito (por defecto el primero de la canasta). Mismo negocio
   * o teléfono: cambia la cantidad de ese producto, no se duplica. Cantidad desde 1 (sin tope real, ver `CANTIDAD_MAXIMA`). El público anónimo suma uno nuevo.
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
  /**
   * Un comprador inicia una compra en grupo de un producto, con su cantidad: queda como su primer participante y otras
   * pueden estar abiertas a la vez. Sin proveedor fijo: los proveedores ofertan y al cerrar gana la mejor oferta.
   * Emite `licitacion.abierta`.
   */
  abrirSolicitud(s: NuevaSolicitud): Promise<SinTelefono<LicitacionVista>>;
  /**
   * Quien inició una compra en grupo la cierra antes de tiempo, si ya hay oferta y el grupo llegó al mínimo de la que
   * gana (`puedeCerrarAntes`). Igual que al vencer: crea las órdenes y emite `licitacion.cerrada`.
   */
  cerrarAntes(licitacionId: string, negocioId: string): Promise<OrdenCompra[]>;
  /** El producto del catálogo con precio que nombra el texto, o undefined (ver `normalizarProducto`). */
  productoConPrecio(texto: string): string | undefined;
  /** Cierra las compras abiertas cuyo `cierraEn` ya pasó. Devuelve cuántas cerró. */
  cerrarVencidas(): Promise<number>;
  ofertar(licitacionId: string, oferta: NuevaOferta): Promise<LicitacionVista>;
  /**
   * Un proveedor suma un producto a la canasta abierta: nombre, unidad y su precio. Sus tramos salen del precio
   * (`tramosAutomaticos`) y son su oferta por volumen; los demás proveedores pueden ofertar por él. Emite `licitacion.producto`.
   */
  crearProducto(licitacionId: string, producto: NuevoProducto): Promise<{ licitacion: LicitacionVista; producto: ProductoCompraVista }>;
  /**
   * El dueño de un producto (quien lo creó o el proveedor fijo de la compra) cambia sus tramos mientras la compra está
   * abierta (`errorDeTramos`: el precio que ya alcanzó el grupo no sube). Emite `licitacion.producto` con
   * `cambio: 'tramos'` y, si el precio vigente bajó, `licitacion.precio_bajo`.
   */
  fijarTramos(licitacionId: string, productoId: string, proveedorId: string, tramos: Tramo[]): Promise<{ licitacion: LicitacionVista; producto: ProductoCompraVista }>;
  /**
   * Cierra y crea las órdenes (`enviada`). Al público sin negocio le crea un negocio comprador.
   * - Con proveedor fijo (la demo con ficticios): una orden por participante a ese proveedor, al precio vigente de cada producto.
   * - Sin él: cada producto lo gana la mejor oferta ajustada por nota y plazo (`ganadora`); el creador del producto
   *   compite con su tramo. Nadie se compra a sí mismo: las líneas de un participante que también ganó van a la
   *   siguiente mejor oferta, y si no hay otra quedan fuera. Una orden por participante y proveedor ganador.
   * Idempotente: si ya cerró, devuelve las mismas órdenes.
   */
  cerrarLicitacion(licitacionId: string): Promise<OrdenCompra[]>;
  /**
   * Un proveedor dijo que sí: confirma sus órdenes de la compra conjunta y emite sus facturas 33 (una por comprador,
   * una línea por producto) en UN sobre del SII, con su emisor. Sin `proveedorId`, todos (un sobre por proveedor).
   * Se puede volver a llamar si el SII falló: solo emite lo que falta. Devuelve las facturas.
   */
  confirmarOrdenesDeLicitacion(licitacionId: string, proveedorId?: string): Promise<Documento[]>;
  /** Registra un negocio comprador, o reusa el del mismo teléfono. Con `rut`, lo consulta en el SII y lo guarda. */
  registrarComprador(datos: NuevoComprador): Promise<Negocio>;
  /** La dirección para la factura de un comprador con RUT (la consulta pública del SII no la trae). */
  fijarDireccionFactura(negocioId: string, d: { direccion: string; comuna: string }): Promise<Negocio>;
  /**
   * Registra al proveedor de un teléfono con el RUT de su empresa (consultado en el SII), o deja que el comprador de ese
   * teléfono también venda (`vende`). Emite `negocio.registrado`.
   */
  registrarProveedor(datos: NuevoProveedor): Promise<Negocio>;
  /**
   * Valida el RUT (módulo 11) y trae sus datos del SII, una sola vez por RUT. `datos_invalidos` si no es válido
   * o el SII no lo conoce; `sii_no_disponible` si la consulta falló. Con `telefono`, también `datos_invalidos` si
   * ese RUT ya lo registró otro teléfono. Solo interno.
   */
  consultarRut(rut: string, telefono?: string): Promise<ContribuyenteDeRut>;
  /** Solo interno (agente de WhatsApp): a qué teléfono avisar por un negocio. */
  telefonoDeNegocio(negocioId: string): string | null;
  /** Foto interna, con teléfonos: solo para el servidor (agente de WhatsApp). */
  estadoDeLaRed(): EstadoRed;
  /** Foto para pantallas y `GET /api/red/estado`: sin teléfonos. */
  estadoPublico(): EstadoPublico;
  negocioPorTelefono(telefono: string): Negocio | null;
  negocioPorId(id: string): Negocio | null;
  /** Nuevo estado en el SII de un documento ya emitido (veredicto del envío). Emite `documento.actualizado`. */
  actualizarEstadoDocumento(tipo: TipoDocumento, folio: number, estadoSii: string, ordenId?: string, trackId?: string): Promise<Documento | null>;
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
  /**
   * Precio de referencia por unidad de un producto escrito por un comprador (las listas de los proveedores o Mercado
   * Público), para mostrar el ahorro antes de la primera oferta. Sin él, o sin coincidencia, la solicitud parte sin precio.
   */
  precioDeReferencia?: (producto: string, unidad: IdUnidad) => number | undefined;
  /** Si algún proveedor vende ese producto (en su lista). Sin él, no se valida; con él, no se abren compras de lo que nadie vende. */
  existeProducto?: (producto: string, unidad: IdUnidad) => boolean;
  /** Antes de abrir una compra: averigua si lo escrito es un producto que ya existe escrito distinto (server/catalogo/equivalencias.ts). */
  aprenderProducto?: (producto: string, unidad: IdUnidad) => Promise<void>;
  /** ¿Mismo producto? Por defecto `mismoProducto` (nombre exacto); el servidor le suma lo aprendido con Jev. */
  mismoProducto?: (a: { nombre: string; unidad: string }, b: { nombre: string; unidad: string }) => boolean;
  reloj?: () => Date;
  /** Variables de la demo (proveedor, producto, tramos). Por defecto `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Consulta de RUT en el SII, ya con cache y fila. Por defecto la falsa (datos simulados). Ver server/red/contribuyente.ts. */
  consultarContribuyente?: ConsultarContribuyente;
  /**
   * Se llama cuando un negocio entra a una compra conjunta (no al cambiar un carrito que ya tiene); si lanza, no entra.
   * Crédito Bando (server/pagos/) exige ahí la tarjeta inscrita.
   */
  antesDeEntrar?: (n: Negocio) => void | Promise<void>;
  /**
   * Cuánto se espera a la consulta de un RUT antes de seguir con lo declarado (ms) y cuándo se vuelve a consultar un RUT
   * declarado para reemplazarlo por los datos del SII. Por defecto 6 s y 30 s, 2 min y 10 min; los tests los acortan.
   */
  esperaRutMs?: number;
  reintentosRutMs?: readonly number[];
}

export const FALTA_RUT = 'Falta tu RUT: tu factura sale a tu nombre en el SII.';
export const RUT_DESCONOCIDO = 'No encontramos ese RUT en el SII. Revísalo e intenta de nuevo.';
export const RUT_DE_OTRO_TELEFONO = 'Ese RUT ya está registrado con otro número de teléfono. Escribe el RUT de tu negocio.';
export const SII_NO_DISPONIBLE = RUT_SIN_CONFIRMAR;

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
  // Compras en grupo de un comprador abiertas antes de guardar quién la inició: la inició el primero que se sumó.
  if (!l.iniciadaPor && !l.proveedorId && l.id !== LICITACION_SALA && l.participantes?.length) {
    const primero = [...l.participantes].sort((a, b) => (a.en ?? '').localeCompare(b.en ?? ''))[0];
    if (primero?.negocioId) l.iniciadaPor = primero.negocioId;
  }
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
  consultarContribuyente = conCacheYFila(crearConsultaContribuyenteFalsa(), { intervaloMs: 0 }), antesDeEntrar, precioDeReferencia, existeProducto,
  aprenderProducto, mismoProducto: esMismo = mismoProducto,
  esperaRutMs = 6000, reintentosRutMs = [30_000, 120_000, 600_000],
}: OpcionesRed): Promise<Red> {
  const datos: DatosRed = await repo.cargar();
  const aSiMismo = env.DEMO_COMPRA_A_SI_MISMO === '1';
  const sinCertificado = env.DEMO_PROVEEDOR_SIN_CERTIFICADO === '1';
  for (const l of datos.licitaciones) migrarLicitacion(l);
  // La subida al SII va en segundo plano dentro del proceso: un documento que arranca `enviando` quedó a medias por
  // un reinicio. Pudo llegar o no, así que queda en revisión (se consulta, nunca se reenvía).
  for (const d of datos.documentos) {
    if (d.estadoSii !== 'enviando') continue;
    d.estadoSii = 'incierto';
    await repo.guardar('documentos', d);
    console.warn(`[red] ${d.tipo} folio ${d.folio}: quedó enviándose al SII al reiniciar, queda en revisión`);
  }
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
    if (!(rol === 'comprador' ? puedeComprar : puedeVender)(n)) throw new ErrorRed('datos_invalidos', `${n.nombre} no es ${rol}`);
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
  // El precio que ve el grupo y el del cierre salen de las mismas funciones (compra.ts), con la nota de cada proveedor.
  const ctxPrecio: ContextoPrecio = { notaDe: notaDeProveedor, ahora };
  const precioVigente = (l: Licitacion, productoId?: string) => precioVigenteCon(l, productoId, ctxPrecio);
  const preciosVigentes = (l: Licitacion) => preciosVigentesCon(l, ctxPrecio);
  const vistaLicitacion = (l: Licitacion) => vistaLicitacionCon(l, ctxPrecio);
  const vistaProducto = (l: Licitacion, p: ProductoCompra) => vistaProductoCon(l, p, ctxPrecio);

  async function registrarReputacion(proveedorId: string, ordenId: string, tipo: TipoEventoReputacion) {
    const anterior = notaDeProveedor(proveedorId);
    await guardar('eventosReputacion', { id: randomUUID(), proveedorId, ordenId, tipo, en: ahora() });
    const nota = notaDeProveedor(proveedorId);
    if (nota !== anterior) emitir('nota.cambiada', { proveedorId, anterior, nota });
  }

  // La subida al SII va en segundo plano y puede responder antes de que el documento se guarde: su estado espera aquí.
  const estadosAdelantados = new Map<string, { estadoSii: string; trackId?: string }>();
  const claveDocumento = (tipo: number, folio: number, ordenId: string) => `${tipo}:${folio}:${ordenId}`;

  async function guardarDocumento(ordenId: string, tipo: TipoDocumento, monto: number, r: ResultadoSii) {
    const doc: Documento = { id: randomUUID(), ordenId, tipo, folio: r.folio, trackId: r.trackId, estadoSii: r.estadoSii, monto, emitidoEn: ahora() };
    // Antes que el documento: quien reciba `documento.emitido` ya puede pedir su PDF.
    if (r.impreso) await guardar('impresos', { id: doc.id, impreso: r.impreso });
    // Justo antes de que el documento exista (sin await entre medio): lo que el SII ya respondió en segundo plano.
    const clave = claveDocumento(tipo, r.folio, ordenId);
    const adelantado = estadosAdelantados.get(clave);
    estadosAdelantados.delete(clave);
    if (adelantado) Object.assign(doc, adelantado);
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
  /** El proveedor dice que sí: la guía despacha lo pedido (si no se fijó otra cantidad). */
  async function confirmar(o: OrdenCompra) {
    for (const i of o.items) i.cantidadDespachada ??= i.cantidad;
    o.estado = 'confirmada';
    await guardar('ordenes', o);
    emitir('orden.confirmada', { orden: o });
  }

  function confirmarOrden(ordenId: string) {
    return conCandado(ordenId, async () => {
      const o = orden(ordenId, 'enviada', 'confirmada');
      const datosEmision = { orden: o, emisor: negocio(o.proveedorId, 'proveedor'), receptor: negocio(o.compradorId, 'comprador') };
      if (o.estado === 'enviada') await confirmar(o);
      if (!documento(o.id, 33)) await guardarDocumento(o.id, 33, neto(o.items), await sii.emitirFactura(datosEmision));
      if (!documento(o.id, 52)) await guardarDocumento(o.id, 52, netoDespachado(o.items), await sii.emitirGuia(datosEmision));
      o.estado = 'facturada';
      await guardar('ordenes', o);
      return structuredClone(o);
    });
  }

  // La compra conjunta factura en lote sin guía: antes de salir a repartir, el proveedor emite la guía 52 de cada
  // pedido por entregar que no la tiene, una por una. Si el SII falla a mitad, se vuelve a llamar y sigue con las que faltan.
  async function emitirGuiasDeReparto(proveedorId: string) {
    const sinGuia = () => datos.ordenes.filter(o => o.proveedorId === proveedorId && POR_ENTREGAR.includes(o.estado) && !documento(o.id, 52));
    const emitidas: Documento[] = [];
    for (const { id } of sinGuia()) {
      await conCandado(id, async () => {
        const o = datos.ordenes.find(x => x.id === id);
        if (!o || !sinGuia().includes(o)) return;
        const r = await sii.emitirGuia({ orden: o, emisor: negocio(o.proveedorId, 'proveedor'), receptor: negocio(o.compradorId, 'comprador') });
        emitidas.push(await guardarDocumento(o.id, 52, netoDespachado(o.items), r));
      });
    }
    return structuredClone(emitidas);
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
      const { estadoSii } = await sii.registrarReclamo({ factura, receptor: comprador, motivo, emisor: negocio(o.proveedorId, 'proveedor') });
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
  /**
   * Un RUT es del teléfono que lo registró primero: otro teléfono no puede usarlo ni ver los datos que se
   * guardaron con él (nombre y dirección declarados). Los negocios sin teléfono no reclaman su RUT.
   */
  function exigirRutDelTelefono(rut: string, telefono: string | undefined) {
    const tel = telefono ? normalizarTelefono(telefono) : '';
    if (tel && datos.negocios.some(n => n.rut === rut && n.telefono && normalizarTelefono(n.telefono) !== tel)) {
      throw new ErrorRed('datos_invalidos', RUT_DE_OTRO_TELEFONO);
    }
  }

  async function consultarRut(texto: string, telefono?: string): Promise<ContribuyenteDeRut> {
    const rut = validarRut(texto);
    if (!rut) throw new ErrorRed('datos_invalidos', RUT_INVALIDO);
    exigirRutDelTelefono(rut, telefono);
    const conocido = datos.negocios.find(n => n.rut === rut && n.contribuyente)?.contribuyente;
    if (conocido && !conocido.declarado) return { rut, ...structuredClone(conocido) };
    let encontrado: DatosContribuyente | null;
    try {
      encontrado = await conEspera(consultarContribuyente(rut));
    } catch (error) {
      // Lo declarado antes sirve de respaldo mientras el SII no responda.
      if (conocido) return { rut, ...structuredClone(conocido) };
      // El texto del SII (página pública, sin datos de sesión) dice por qué rechazó: sin él no se puede diagnosticar.
      const delSii = (error as { mensajeSii?: unknown } | null)?.mensajeSii;
      const detalle = typeof delSii === 'string' && delSii ? ` | SII: ${delSii.replace(/\s+/g, ' ').slice(0, 300)}` : '';
      console.error(`[red] no se pudo consultar un RUT en el SII: ${error instanceof Error ? error.message : String(error)}${detalle}`);
      throw new ErrorRed('sii_no_disponible', SII_NO_DISPONIBLE);
    }
    if (!encontrado) throw new ErrorRed('datos_invalidos', RUT_DESCONOCIDO);
    // El SII manda en razón social y giro; la dirección que dio la persona se queda si el SII no trae una.
    const direccion = encontrado.direccion && encontrado.comuna ? {} : conocido ? { direccion: conocido.direccion, comuna: conocido.comuna } : {};
    return { rut, ...structuredClone(encontrado), ...direccion };
  }

  /** La consulta del SII con un tope de espera: nadie se queda esperando si el SII está lento o bloquea (la consulta sigue en la fila). */
  function conEspera<T>(consulta: Promise<T>): Promise<T> {
    let tope: ReturnType<typeof setTimeout> | undefined;
    const vencida = new Promise<never>((_, rechazar) => {
      tope = setTimeout(() => rechazar(new Error(`el SII no respondió en ${esperaRutMs} ms`)), esperaRutMs);
    });
    return Promise.race([consulta, vencida]).finally(() => clearTimeout(tope));
  }

  /**
   * Un negocio que quedó con datos declarados (el SII no respondió al registrarse) se vuelve a consultar más tarde, por
   * la misma fila de consultas: cuando el SII responde, sus datos reemplazan a los declarados (`asignarRut`).
   */
  function confirmarRutDespues(negocioId: string, intento = 0) {
    const espera = reintentosRutMs[intento];
    if (espera === undefined) return;
    const t = setTimeout(async () => {
      const n = datos.negocios.find(x => x.id === negocioId);
      if (!n?.rut || !n.contribuyente?.declarado) return;
      try {
        const delSii = await consultarContribuyente(n.rut);
        if (!delSii) return void console.error(`[red] el SII no conoce el RUT declarado del negocio ${n.id}: queda con lo declarado`);
        // La dirección que dio la persona manda sobre la del SII (como en `conDireccion`): el SII confirma razón social y giro.
        const { direccion, comuna } = n.contribuyente;
        await asignarRut(n, { rut: n.rut, ...delSii, ...(direccion && comuna ? { direccion, comuna } : {}) });
        emitir('negocio.actualizado', { negocio: n });
      } catch {
        confirmarRutDespues(negocioId, intento + 1);
      }
    }, espera);
    t.unref?.();
  }

  const camposRut = ({ rut, ...contribuyente }: ContribuyenteDeRut): Pick<Negocio, 'rut' | 'contribuyente'> => ({ rut, contribuyente });

  /**
   * Los datos del SII de su RUT, sin perder la dirección que ya había dado para ese mismo RUT: la consulta pública no
   * trae dirección, y volver a consultarla (por ejemplo, al registrarse como proveedor) no debe borrarla.
   */
  const camposRutConservando = (n: Negocio, delSii: ContribuyenteDeRut): Pick<Negocio, 'rut' | 'contribuyente'> => {
    const nuevos = camposRut(delSii);
    const antes = n.rut === delSii.rut ? n.contribuyente : undefined;
    if (!antes || !nuevos.contribuyente) return nuevos;
    return { ...nuevos, contribuyente: { ...nuevos.contribuyente, direccion: nuevos.contribuyente.direccion || antes.direccion, comuna: nuevos.contribuyente.comuna || antes.comuna } };
  };

  /** Deja el RUT y sus datos del SII en el negocio (si cambió o reemplazan a los declarados) y lo guarda. */
  async function asignarRut(n: Negocio, delSii: ContribuyenteDeRut) {
    if (n.rut === delSii.rut && n.contribuyente && (delSii.declarado || !n.contribuyente.declarado)) return;
    exigirRutDelTelefono(delSii.rut, n.telefono);
    Object.assign(n, camposRutConservando(n, delSii));
    await guardar('negocios', n);
    if (delSii.declarado) confirmarRutDespues(n.id);
  }

  async function registrarComprador({ nombre, comuna, telefono, rubro, rut, negocioId, direccionFactura }: NuevoComprador) {
    // La consulta al SII va antes de la fila: una sala que se suma de golpe no espera detrás de cada consulta. Si el SII no
    // responde, sigue con lo que escribió la persona (declarado) y se confirma después.
    const delSii = rut === undefined ? undefined : await rutParaFactura({ rut, nombre, telefono, direccionFactura }, false);
    return enFila('compradores', async () => {
      const tel = telefono ? normalizarTelefono(telefono) : '';
      const existente = negocioId ? negocio(negocioId, 'comprador')
        : tel ? datos.negocios.find(n => normalizarTelefono(n.telefono) === tel) : undefined;
      if (existente) {
        if (!puedeComprar(existente)) throw new ErrorRed('datos_invalidos', `${existente.nombre} es proveedor, no puede comprar en la red`);
        if (delSii) await asignarRut(existente, delSii);
        return structuredClone(await conDireccion(existente, { direccionFactura }));
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
      if (delSii?.declarado) confirmarRutDespues(n.id);
      return structuredClone(await conDireccion(n, { direccionFactura }));
    });
  }

  async function registrarProveedor({ telefono, rut, nombre, comuna }: NuevoProveedor) {
    const tel = normalizarTelefono(telefono ?? '');
    if (!tel) throw new ErrorRed('datos_invalidos', 'Falta el teléfono del proveedor');
    // Sin respuesta del SII, el registro sigue con el nombre que dio: sus facturas salen con la ficha de su conexión al SII.
    const delSii = await rutParaFactura({ rut, nombre, telefono }, false);
    return enFila('compradores', async () => {
      const existente = datos.negocios.find(n => normalizarTelefono(n.telefono) === tel);
      const n: Negocio = existente ?? {
        id: `n-p-${randomUUID().slice(0, 8)}`, nombre: textoCorto(nombre) || textoCorto(delSii.razonSocial),
        comuna: textoCorto(comuna) || textoCorto(delSii.comuna), rol: 'proveedor', telefono: telefono.trim(),
      };
      n.vende = true;
      Object.assign(n, camposRutConservando(n, delSii));
      await guardar('negocios', n);
      if (delSii.declarado) confirmarRutDespues(n.id);
      emitir('negocio.registrado', { negocio: n });
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

  async function fijarDireccionFactura(negocioId: string, d: { direccion: string; comuna: string }) {
    const n = negocio(negocioId, 'comprador');
    if (!n.rut || !n.contribuyente) throw new ErrorRed('datos_invalidos', 'Primero registra el RUT de tu negocio');
    if (!textoCorto(d?.direccion) || !textoCorto(d?.comuna)) throw new ErrorRed('datos_invalidos', 'Escribe la dirección y la comuna');
    return structuredClone(await conDireccion(n, { direccionFactura: d }));
  }

  /** La dirección que dio la persona reemplaza la del SII en sus datos de contribuyente (los que usa la factura). */
  async function conDireccion(n: Negocio, q: DuenoCarrito): Promise<Negocio> {
    const d = q.direccionFactura;
    if (!d || !n.contribuyente) return n;
    const direccion = textoCorto(d.direccion), comuna = textoCorto(d.comuna);
    if (!direccion || !comuna || (n.contribuyente.direccion === direccion && n.contribuyente.comuna === comuna)) return n;
    n.contribuyente = { ...n.contribuyente, direccion, comuna };
    await guardar('negocios', n);
    return n;
  }

  /**
   * Los datos de factura de un RUT: los del SII; si el SII no responde o rechaza la consulta (pasa en certificación con
   * RUT que no son de empresas en certificación) y la persona dio su dirección, los que declaró: su factura igual sale a
   * su RUT, con el nombre de su negocio. Un RUT inválido o que el SII dice que no existe sigue fallando.
   */
  async function rutParaFactura(q: Pick<DuenoCarrito, 'rut' | 'nombre' | 'telefono' | 'direccionFactura'>, exigirDireccion = true): Promise<ContribuyenteDeRut> {
    try {
      return await consultarRut(q.rut!, q.telefono);
    } catch (error) {
      const rut = validarRut(q.rut);
      const d = q.direccionFactura;
      if (!(error instanceof ErrorRed) || error.codigo !== 'sii_no_disponible' || !rut || (exigirDireccion && !d)) throw error;
      return {
        rut, razonSocial: textoCorto(q.nombre) || 'Sin razón social', giro: 'Sin informar',
        direccion: textoCorto(d?.direccion), comuna: textoCorto(d?.comuna), actividades: [], declarado: true,
      };
    }
  }

  /** El negocio comprador de quien edita su carrito. Con `crear`, registra el teléfono nuevo. */
  async function compradorDe(q: DuenoCarrito, crear: boolean): Promise<Negocio | undefined> {
    if (q.negocioId) {
      const n = negocio(q.negocioId, 'comprador');
      if (q.rut !== undefined) await asignarRut(n, await rutParaFactura(q));
      return conDireccion(n, q);
    }
    if (!q.telefono) return undefined;
    const tel = normalizarTelefono(q.telefono);
    const existente = tel ? datos.negocios.find(n => normalizarTelefono(n.telefono) === tel) : undefined;
    if (existente && !puedeComprar(existente)) throw new ErrorRed('datos_invalidos', `${existente.nombre} es proveedor, no puede comprar en la red`);
    if (existente) {
      if (q.rut !== undefined) await asignarRut(existente, await rutParaFactura(q));
      return conDireccion(existente, q);
    }
    if (!crear) return undefined;
    // El RUT se asigna después de crear el negocio: así su factura puede salir con los datos declarados si el SII no responde.
    const nuevo = await registrarComprador({ nombre: q.nombre ?? '', comuna: q.comuna, telefono: q.telefono, rubro: q.rubro });
    const n = negocio(nuevo.id, 'comprador');
    if (q.rut !== undefined) await asignarRut(n, await rutParaFactura(q));
    return conDireccion(n, q);
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
    if (n && !actual && carrito.length) await antesDeEntrar?.(n);

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

  /** `licitacion.precio_bajo` si el precio vigente del producto quedó bajo `antes`. */
  /**
   * Si un proveedor puede competir: los de la semilla de la demo siempre (facturan con el SII de la demo o el falso);
   * uno que se registró para vender (`vende`), solo si puede emitir facturas reales hoy. Nadie gana una compra que no
   * puede facturar.
   */
  async function puedeFacturar(proveedorId: string): Promise<boolean> {
    const n = datos.negocios.find(x => x.id === proveedorId);
    // DEMO_PROVEEDOR_SIN_CERTIFICADO=1: prueba explícita de vender sin certificado (facturas simuladas).
    if (!n?.vende || sinCertificado) return true;
    return (await sii.puedeFacturar?.(n)) ?? true;
  }

  /** Marca en la canasta las ofertas y productos de quien todavía no puede facturar (`pendienteSii`). */
  async function marcarFacturacion(l: Licitacion): Promise<void> {
    const cache = new Map<string, Promise<boolean>>();
    const puede = (id: string) => { if (!cache.has(id)) cache.set(id, puedeFacturar(id)); return cache.get(id)!; };
    for (const p of l.productos) {
      for (const o of p.ofertas) {
        if (await puede(o.proveedorId)) delete o.pendienteSii;
        else o.pendienteSii = true;
      }
      if (p.proveedorId && !(await puede(p.proveedorId))) p.creadorPendienteSii = true;
      else delete p.creadorPendienteSii;
    }
  }

  async function revisarFacturacion(): Promise<void> {
    for (const { id } of datos.licitaciones.filter(x => x.estado === 'abierta')) {
      await enFila(id, async () => {
        const l = datos.licitaciones.find(x => x.id === id && x.estado === 'abierta');
        if (!l) return;
        const marca = () => new Map<string, boolean>(l.productos.flatMap(p => [
          ...p.ofertas.map(o => [`${p.id}|${o.proveedorId}`, !!o.pendienteSii] as const),
          ...(p.proveedorId ? [[`${p.id}|${p.proveedorId}|creador`, !!p.creadorPendienteSii] as const] : []),
        ]));
        const antes = marca();
        const precios = preciosVigentes(l);
        await marcarFacturacion(l);
        const cambios = [...marca()].filter(([clave, pendiente]) => antes.get(clave) !== pendiente).map(([clave]) => clave.split('|'));
        if (!cambios.length) return;
        await guardar('licitaciones', l);
        const licitacion = vistaLicitacion(l);
        const despues = marca();
        for (const [productoId, proveedorId, creador] of cambios) {
          const producto = l.productos.find(p => p.id === productoId)!;
          const compite = !despues.get([productoId, proveedorId, creador].filter(Boolean).join('|'));
          emitir('licitacion.producto', {
            licitacionId: l.id, licitacion, producto: vistaProducto(l, producto), cambio: 'facturacion', compite,
            proveedorNombre: datos.negocios.find(n => n.id === proveedorId)?.nombre ?? 'Un proveedor',
          });
        }
        for (const p of l.productos) avisarSiBajo(l, p.id, precios.get(p.id)!, unidadesDe(l, p.id));
      });
    }
  }

  function avisarSiBajo(l: Licitacion, productoId: string, antes: number, totalUnidades: number) {
    const precioNuevo = precioVigente(l, productoId);
    if (precioNuevo < antes) emitir('licitacion.precio_bajo', { licitacionId: l.id, productoId, precioAnterior: antes, precioNuevo, totalUnidades });
  }

  // Oferta por un producto de la canasta (por defecto el primero). Reemplaza la anterior del mismo proveedor en ese producto.
  function ofertar(licitacionId: string, o: NuevaOferta) {
    return enFila(licitacionId, async () => {
      const l = licitacionEnCurso(licitacionId);
      const proveedor = negocio(o.proveedorId, 'proveedor');
      const producto = productoDeLicitacion(l, o.productoId);
      const antes = precioVigente(l, producto.id);
      const tramos = o.tramos?.length ? ordenarTramos(o.tramos.map(t => ({ desde: Number(t?.desde), precioUnitario: Number(t?.precioUnitario) }))) : undefined;
      const problema = tramos && errorDeTramos(tramos);
      if (problema) throw new ErrorRed('datos_invalidos', problema);
      const precioUnitario = tramos ? tramos[0].precioUnitario : Number(o.precioUnitario), plazoDias = Number(o.plazoDias);
      if (!(precioUnitario > 0) || !Number.isInteger(plazoDias) || plazoDias < 0) {
        throw new ErrorRed('datos_invalidos', 'La oferta necesita precio positivo y plazo en días enteros');
      }
      const minimo = Number(o.minimo);
      if (o.minimo !== undefined && (!Number.isInteger(minimo) || minimo < 1)) throw new ErrorRed('datos_invalidos', 'El pedido mínimo es una cantidad entera');
      const stock = Number(o.stock);
      if (o.stock !== undefined && (!Number.isInteger(stock) || stock < 0)) throw new ErrorRed('datos_invalidos', 'El stock es una cantidad entera, 0 o más');
      const oferta: Oferta = {
        proveedorId: o.proveedorId, productoId: producto.id, precioUnitario, ...(tramos ? { tramos } : {}), ...(o.automatica ? { automatica: true } : {}),
        ...(o.minimo !== undefined ? { minimo } : {}), ...(o.stock !== undefined ? { stock } : {}), plazoDias, en: ahora(),
      };
      producto.ofertas = producto.ofertas.filter(x => x.proveedorId !== o.proveedorId).concat(oferta);
      await marcarFacturacion(l);
      await guardar('licitaciones', l);
      const vista = vistaLicitacion(l);
      const nota = notaDeProveedor(o.proveedorId);
      const unidades = unidadesDe(l, producto.id);
      // La mejor del momento en ese producto: más barata que las demás ofertas y que el precio del tramo alcanzado.
      const suya = precioDeOferta(oferta, unidades);
      const mejor = !oferta.pendienteSii && (!producto.tramos.length || suya <= precioPorVolumen(producto, unidades))
        && ofertasQueCompiten(producto.ofertas).every(x => x === oferta || precioDeOferta(x, unidades) > suya);
      emitir('licitacion.oferta', {
        licitacionId: l.id, productoId: producto.id, licitacion: vista, oferta: { ...oferta, proveedorNombre: proveedor.nombre, nota }, nota, mejor,
      });
      avisarSiBajo(l, producto.id, antes, unidades);
      return vista;
    });
  }

  function abrirSolicitud(n: NuevaSolicitud) {
    return enFila('abrir-solicitud', async () => {
      const comprador = negocio(n.compradorId, 'comprador');
      const nombre = String(n.producto ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const unidad = unidadDeTexto(String(n.unidad ?? '') || 'unidad');
      if (!unidad) throw new ErrorRed('datos_invalidos', 'Elige la unidad de venta de la lista (caja, bolsa, kilo...)');
      await aprenderProducto?.(nombre, unidad).catch(() => {});
      if (existeProducto && !existeProducto(nombre, unidad)) {
        throw new ErrorRed('datos_invalidos', `Ningún proveedor vende "${nombre}" todavía: cuando alguno lo agregue a su lista, podrás comprarlo en grupo`);
      }
      const cantidad = Number(n.cantidad);
      if (nombre.length < 3) throw new ErrorRed('datos_invalidos', 'Escribe qué producto quieres comprar');
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAXIMA) throw new ErrorRed('datos_invalidos', `La cantidad va de 1 a ${CANTIDAD_MAXIMA}`);
      const hoy = Number(n.precioHoy);
      const referencia = Number.isInteger(hoy) && hoy > 0 ? hoy : precioDeReferencia?.(nombre, unidad) ?? 0;
      const repetida = datos.licitaciones.find(x => x.estado === 'abierta' && x.productos.some(p => esMismo(p, { nombre, unidad })));
      if (repetida) throw new ErrorRed('datos_invalidos', `Ya hay una compra en grupo abierta de "${nombre}": súmate a ella`);
      const pedidos = Number(n.minutos);
      const minutos = Number.isInteger(pedidos) && pedidos > 0 ? Math.min(pedidos, MAXIMO_MINUTOS_SOLICITUD) : MINUTOS_SOLICITUD;
      let k = datos.licitaciones.length + 1;
      while (datos.licitaciones.some(x => x.id === `L-${k}`)) k++;
      const producto: ProductoCompra = { id: idDeProducto({ productos: [] }, nombre), nombre, unidad, unidadPlural: pluralUnidad(unidad), precioSolo: referencia, tramos: [], ofertas: [] };
      const l: Licitacion = {
        id: `L-${k}`, productos: [producto], producto: nombre, unidad, unidadPlural: producto.unidadPlural, comuna: comprador.comuna, iniciadaPor: comprador.id,
        cierraEn: new Date(reloj().getTime() + minutos * 60_000).toISOString(), precioSolo: referencia, tramos: [],
        participantes: [], ofertas: [], estado: 'abierta',
      };
      await guardar('licitaciones', l);
      emitir('licitacion.abierta', { licitacionId: l.id, licitacion: vistaLicitacion(l) });
      return l.id;
    }).then(async id => {
      const { licitacion } = await actualizarCarrito(id, { negocioId: n.compradorId, items: [{ productoId: datos.licitaciones.find(x => x.id === id)!.productos[0].id, cantidad: Number(n.cantidad) }] });
      return licitacion;
    });
  }

  async function cerrarAntes(licitacionId: string, negocioId: string) {
    const l = licitacionEnCurso(licitacionId);
    if (l.iniciadaPor !== negocioId) throw new ErrorRed('prohibido', 'Solo quien inició la compra en grupo la puede cerrar antes');
    const listo = l.productos.every(p => puedeCerrarAntes(p.ofertas, unidadesDe(l, p.id)));
    if (!listo) throw new ErrorRed('transicion_invalida', 'Todavía no se puede cerrar: falta una oferta o llegar al pedido mínimo del proveedor');
    return cerrarLicitacion(licitacionId);
  }

  async function cerrarVencidas() {
    const vencidas = datos.licitaciones.filter(l => l.estado === 'abierta' && Date.parse(l.cierraEn) <= reloj().getTime());
    for (const l of vencidas) await cerrarLicitacion(l.id);
    return vencidas.length;
  }

  /** Id legible y único del producto en la canasta: "Café molido 1 kg" → "cafe-molido-1-kg". */
  function idDeProducto(l: Pick<Licitacion, 'productos'>, nombre: string) {
    const base = sinTildes(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'producto';
    let id = base;
    for (let k = 2; l.productos.some(p => p.id === id); k++) id = `${base}-${k}`;
    return id;
  }

  /** Los tramos propios validados (el primero, al precio de comprar solo) o los automáticos. */
  function tramosDelProducto(precio: number, tramos?: Tramo[]): Tramo[] {
    if (!tramos) return tramosAutomaticos(precio);
    const propios = ordenarTramos(tramos.map(t => ({ desde: Number(t?.desde), precioUnitario: Number(t?.precioUnitario) })));
    const problema = errorDeTramos(propios) ?? (propios[0].precioUnitario !== precio ? 'El primer tramo es el precio de comprar solo' : null);
    if (problema) throw new ErrorRed('datos_invalidos', problema);
    return propios;
  }

  function crearProducto(licitacionId: string, n: NuevoProducto) {
    return enFila(licitacionId, async () => {
      const l = licitacionEnCurso(licitacionId);
      const proveedor = negocio(n.proveedorId, 'proveedor');
      const nombre = String(n.nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const unidad = String(n.unidad ?? '').trim().toLowerCase().slice(0, 20);
      const precio = Number(n.precio);
      if (nombre.length < 3 || !unidad) throw new ErrorRed('datos_invalidos', 'El producto necesita nombre y unidad de venta');
      if (!Number.isInteger(precio) || precio <= 0) throw new ErrorRed('datos_invalidos', 'El precio debe ser un entero positivo, en pesos');
      if (l.productos.some(p => sinTildes(p.nombre) === sinTildes(nombre))) {
        throw new ErrorRed('datos_invalidos', `"${nombre}" ya está en la canasta: oferta por él`);
      }
      const producto: ProductoCompra = {
        id: idDeProducto(l, nombre), nombre, unidad, unidadPlural: String(n.unidadPlural ?? '').trim() || pluralDe(unidad),
        precioSolo: precio, tramos: tramosDelProducto(precio, n.tramos), ofertas: [], proveedorId: proveedor.id,
        ...(Number.isInteger(n.stock) && n.stock! >= 0 ? { stock: n.stock } : {}),
      };
      l.productos.push(producto);
      await marcarFacturacion(l);
      await guardar('licitaciones', l);
      const licitacion = vistaLicitacion(l);
      const vista = vistaProducto(l, producto);
      emitir('licitacion.producto', { licitacionId: l.id, licitacion, producto: vista, proveedorNombre: proveedor.nombre });
      return { licitacion, producto: vista };
    });
  }

  function fijarTramos(licitacionId: string, productoId: string, proveedorId: string, tramos: Tramo[]) {
    return enFila(licitacionId, async () => {
      const l = licitacionEnCurso(licitacionId);
      const proveedor = negocio(proveedorId, 'proveedor');
      const producto = productoDeLicitacion(l, productoId);
      if (duenoDeTramos(producto, l) !== proveedor.id) throw new ErrorRed('prohibido', 'Solo quien vende ese producto fija sus tramos');
      const nuevos = ordenarTramos((Array.isArray(tramos) ? tramos : []).map(t => ({ desde: Number(t?.desde), precioUnitario: Number(t?.precioUnitario) })));
      const unidades = unidadesDe(l, producto.id);
      const error = errorDeTramos(nuevos, { unidades, precio: precioPorVolumen(producto, unidades) });
      if (error) throw new ErrorRed('datos_invalidos', error);
      const antes = precioVigente(l, producto.id);
      producto.tramos = nuevos;
      await guardar('licitaciones', l);
      const licitacion = vistaLicitacion(l);
      const vista = vistaProducto(l, producto);
      emitir('licitacion.producto', { licitacionId: l.id, licitacion, producto: vista, proveedorNombre: proveedor.nombre, cambio: 'tramos' });
      avisarSiBajo(l, producto.id, antes, unidades);
      return { licitacion, producto: vista };
    });
  }

  /**
   * Compra de cada participante sin proveedor fijo: por cada línea, las mejores ofertas que no sean suyas, dentro del
   * stock de cada proveedor (`repartirPorStock`, la misma regla del precio que ve el grupo). Todos pagan el precio del
   * grupo (`precioVigente`), que es lo que vieron en vivo; solo si alguien no puede comprarse a sí mismo y le toca un
   * proveedor más caro que ese precio, esa línea va al precio de ese proveedor.
   */
  function comprasPorProducto(l: Licitacion) {
    const candidatas = new Map(l.productos.map(p => [p.id, candidatasDe(l, p, ctxPrecio)]));
    const precios = preciosVigentes(l);
    for (const p of l.productos) {
      const g = repartoDelGrupo(l, p, ctxPrecio).partes[0]?.candidata;
      if (g) p.ganadora = g;
    }
    const compras: { participante: Participante; proveedorId: string; precio: (productoId: string) => number; items: ItemCarrito[] }[] = [];
    const sinProveedor: { productoId: string; cantidad: number }[] = [];
    /** Unidades ya asignadas a cada proveedor, por producto, para no pasar su stock. */
    const asignado = new Map(l.productos.map(p => [p.id, new Map<string, number>()]));
    for (const participante of l.participantes) {
      const porProveedor = new Map<string, { items: ItemCarrito[]; precios: Map<string, number> }>();
      for (const i of participante.items) {
        // Nadie se compra a sí mismo, salvo en la demo con DEMO_COMPRA_A_SI_MISMO=1 (para probar todo con un teléfono).
        const saltar = (c: Ganadora) => !aSiMismo && c.proveedorId === participante.negocioId;
        const { partes, falta } = repartirPorStock(candidatas.get(i.productoId) ?? [], i.cantidad, asignado.get(i.productoId), saltar);
        for (const { candidata: g, cantidad } of partes) {
          const grupo = porProveedor.get(g.proveedorId) ?? { items: [], precios: new Map<string, number>() };
          grupo.items.push({ ...i, cantidad });
          grupo.precios.set(i.productoId, Math.max(precios.get(i.productoId) ?? g.precioUnitario, g.precioUnitario));
          porProveedor.set(g.proveedorId, grupo);
        }
        if (falta > 0) sinProveedor.push({ productoId: i.productoId, cantidad: falta });
      }
      for (const [proveedorId, { items, precios: suyos }] of porProveedor) {
        compras.push({ participante, proveedorId, items, precio: id => suyos.get(id)! });
      }
    }
    return { compras, sinProveedor };
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
      let compras: ReturnType<typeof comprasPorProducto>['compras'] = [];
      let sinProveedor: ReturnType<typeof comprasPorProducto>['sinProveedor'] = [];
      if (l.proveedorId) {
        negocio(l.proveedorId, 'proveedor');
        const precios = preciosVigentes(l);
        for (const p of l.participantes) compras.push({ participante: p, proveedorId: l.proveedorId, items: p.items, precio: id => precios.get(id)! });
      } else {
        // Se vuelve a revisar al cerrar: quien conectó su SII después de ofertar compite; quien lo perdió, no.
        await marcarFacturacion(l);
        ({ compras, sinProveedor } = comprasPorProducto(l));
      }
      l.estado = 'cerrada';
      await guardar('licitaciones', l);
      const ordenes: OrdenCompra[] = [];
      const nombres = new Map(l.productos.map(x => [x.id, x.nombre]));
      for (const { participante: p, proveedorId, precio, items } of compras) {
        p.negocioId ??= (await registrarComprador({ nombre: p.nombre, comuna: p.comuna, telefono: p.telefono, rubro: p.rubro })).id;
        const lineas = items.map(i => ({ productoId: i.productoId, producto: nombres.get(i.productoId) ?? l.producto, cantidad: i.cantidad, precioUnitario: precio(i.productoId) }));
        ordenes.push(await crearOrden({ compradorId: p.negocioId, proveedorId, items: lineas }));
      }
      l.ordenIds = ordenes.map(o => o.id);
      await guardar('licitaciones', l);
      emitir('licitacion.cerrada', { licitacion: vistaLicitacion(l), ordenes, sinProveedor });
      return ordenes;
    });
  }

  // Un proveedor confirma su parte de la compra conjunta: sus facturas 33 en un solo sobre del SII, con su emisor.
  function confirmarOrdenesDeLicitacion(licitacionId: string, proveedorId?: string) {
    return enFila(licitacionId, async () => {
      const l = datos.licitaciones.find(x => x.id === licitacionId);
      if (!l) throw new ErrorRed('no_encontrado', `No existe la licitación ${licitacionId}`);
      if (l.estado !== 'cerrada' || !l.ordenIds) throw new ErrorRed('transicion_invalida', `La licitación ${licitacionId} todavía no cierra`);
      const ordenes = l.ordenIds.map(id => datos.ordenes.find(o => o.id === id))
        .filter((o): o is OrdenCompra => !!o && (!proveedorId || o.proveedorId === proveedorId));
      const ocupada = ordenes.find(o => enCurso.has(o.id));
      if (ocupada) throw new ErrorRed('ocupado', `${ocupada.id} se está procesando, intenta de nuevo`);
      for (const o of ordenes) enCurso.add(o.id);
      try {
        for (const o of ordenes.filter(x => x.estado === 'enviada')) await confirmar(o);
        const confirmadas = ordenes.filter(o => o.estado === 'confirmada');
        // Un sobre por emisor: cada proveedor factura con su propio RUT y sus folios.
        const sobres = new Map<string, OrdenCompra[]>();
        for (const o of confirmadas.filter(x => !documento(x.id, 33))) sobres.set(o.proveedorId, [...(sobres.get(o.proveedorId) ?? []), o]);
        for (const sobre of sobres.values()) {
          const resultados = await sii.emitirFacturas(sobre.map(o => ({
            orden: o, emisor: negocio(o.proveedorId, 'proveedor'), receptor: negocio(o.compradorId, 'comprador'),
          })));
          for (const [k, o] of sobre.entries()) await guardarDocumento(o.id, 33, neto(o.items), resultados[k]!);
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
        licitacionId: l.id, ...(proveedorId ? { proveedorId } : {}), documentos: facturas.length, total: facturas.reduce((s, d) => s + d.monto, 0), ahorroTotal,
      });
      return structuredClone(facturas);
    });
  }

  async function actualizarEstadoDocumento(tipo: TipoDocumento, folio: number, estadoSii: string, ordenId?: string, trackId?: string) {
    const doc = datos.documentos.find(d => d.tipo === tipo && d.folio === folio && (!ordenId || d.ordenId === ordenId));
    // Tras reiniciar la demo el documento ya no está en la red, pero su folio sigue usado en el SII.
    if (!doc) return null;
    if (doc.estadoSii !== estadoSii || (trackId && doc.trackId !== trackId)) {
      doc.estadoSii = estadoSii;
      if (trackId) doc.trackId = trackId;
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

  sii.alCambiarEstado?.(({ tipo, folio, estadoSii, ordenId, trackId }) => {
    // Sin el documento todavía (la emisión aún no lo guarda), el estado espera a `guardarDocumento`.
    if (ordenId && !datos.documentos.some(d => d.tipo === tipo && d.folio === folio && d.ordenId === ordenId)) {
      estadosAdelantados.set(claveDocumento(tipo, folio, ordenId), { estadoSii, ...(trackId ? { trackId } : {}) });
      return;
    }
    actualizarEstadoDocumento(tipo, folio, estadoSii, ordenId, trackId).catch(error => console.error('[red] no se pudo actualizar el documento', error));
  });

  function estadoDeLaRed(): EstadoRed {
    const notas: Record<string, number> = {};
    // El ranking es la historia de proveedores ficticios de harina: la empresa real de la sala no entra (su nota
    // va en su panel), ni sus competidores (su nota viaja en cada `licitacion.oferta`).
    const fuera = new Set<string>([PROVEEDOR_SALA, ...COMPETIDORES_SALA.map(c => c.id)]);
    for (const n of datos.negocios) if (puedeVender(n) && !fuera.has(n.id)) notas[n.id] = notaDeProveedor(n.id);
    return structuredClone({
      negocios: datos.negocios, ordenes: datos.ordenes, documentos: datos.documentos, notas, licitaciones: datos.licitaciones.map(l => vistaLicitacion(l)),
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
    puedeFacturar,
    revisarFacturacion,
    unirseALicitacion, actualizarCarrito, agregarAlCarrito, salirDeLicitacion, licitacionAbierta, abrirSolicitud, cerrarAntes, cerrarVencidas, productoConPrecio: normalizarProducto, ofertar, crearProducto, fijarTramos, cerrarLicitacion, confirmarOrdenesDeLicitacion, emitirGuiasDeReparto, registrarComprador, fijarDireccionFactura, registrarProveedor, consultarRut, estadoDeLaRed, estadoPublico, negocioPorTelefono, actualizarEstadoDocumento, reiniciarDemo,
    escuchar(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
