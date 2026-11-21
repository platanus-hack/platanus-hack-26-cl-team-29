import { randomUUID } from 'node:crypto';
import { normalizarProducto, precioDe, PRODUCTOS_DISPONIBLES } from './catalogo.ts';
import { precioPorVolumen, totalUnidades, vistaLicitacion } from './compra.ts';
import { CANTIDAD_MAXIMA } from './config-demo.ts';
import { sinTelefonos } from './publico.ts';
import type { SinTelefono } from './publico.ts';
import { calcularNota } from './reputacion.ts';
import { PROVEEDOR_SALA, sembrar } from './semilla.ts';
import type { PuertoSii } from './sii.ts';
import type { Repositorio } from './repositorio.ts';
import type {
  Coleccion, DatosRed, Documento, EstadoOrden, EstadoRed, EventoRed, Item, Licitacion, LicitacionVista, Negocio,
  Oferta, OrdenCompra, Participante, TipoDocumento, TipoEventoRed, TipoEventoReputacion,
} from './tipos.ts';

export type CodigoError =
  | 'no_encontrado' | 'transicion_invalida' | 'datos_invalidos' | 'ocupado'
  // Canal web: sin sesión, sesión de otro negocio, o acción legal sin `confirmado: true`.
  | 'no_autorizado' | 'prohibido' | 'confirmacion_requerida';

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
  cantidad: number;
}

/** Lo que devuelve `unirseALicitacion`. Todo sin teléfonos. */
export interface ResultadoUnion {
  licitacion: SinTelefono<LicitacionVista>;
  participante: SinTelefono<Participante>;
  precioActual: number;
  /** El total del grupo cruzó un tramo y el precio bajó para todos. */
  bajoDePrecio: boolean;
}

/** Datos para registrar (o reusar) un negocio comprador. */
export interface NuevoComprador {
  nombre: string;
  comuna?: string;
  telefono?: string;
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
  /** Suma o actualiza (mismo negocio o mismo teléfono: cambia la cantidad, no se duplica). Cantidad 1 a 20. */
  unirseALicitacion(licitacionId: string, participante: NuevoParticipante): Promise<ResultadoUnion>;
  /** La compra conjunta abierta más reciente, o null. */
  licitacionAbierta(): SinTelefono<LicitacionVista> | null;
  ofertar(licitacionId: string, oferta: NuevaOferta): Promise<LicitacionVista>;
  /**
   * Cierra y crea una orden por participante (`enviada`), al proveedor de la compra conjunta y al precio
   * del tramo alcanzado. Al público sin negocio le crea un negocio comprador. Sin proveedor fijo
   * (licitación antigua), gana la mejor oferta ajustada y solo compran los negocios.
   */
  cerrarLicitacion(licitacionId: string): Promise<OrdenCompra[]>;
  /**
   * El proveedor dijo que sí: confirma todas las órdenes de la compra conjunta y emite todas sus facturas 33
   * en UN sobre del SII. Se puede volver a llamar si el SII falló: solo emite lo que falta. Devuelve las facturas.
   */
  confirmarOrdenesDeLicitacion(licitacionId: string): Promise<Documento[]>;
  /** Registra un negocio comprador, o reusa el del mismo teléfono. */
  registrarComprador(datos: NuevoComprador): Promise<Negocio>;
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
}

const ZONA = 'America/Santiago';
const dia = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(iso));
const neto = (items: Item[]) => items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0);
const netoDespachado = (items: Item[]) => items.reduce((s, i) => s + (i.cantidadDespachada ?? i.cantidad) * i.precioUnitario, 0);
// Solo dígitos y los últimos 9 (móvil chileno), para que "+56 9 1234 5678" y "56912345678" coincidan.
const normalizarTelefono = (t: string) => t.replace(/\D/g, '').slice(-9);

// Puntaje de una oferta en la licitación: el precio, castigado por mala nota y por plazo largo.
//   precioAjustado = precioUnitario * (1 + 0.1 * (5 - nota)) * (1 + 0.01 * plazoDias)
// Gana el menor. Así un proveedor 0.8 puntos peor necesita ser ~8% más barato para ganar.
export function precioAjustado(oferta: NuevaOferta, nota: number): number {
  return Math.round(oferta.precioUnitario * (1 + 0.1 * (5 - nota)) * (1 + 0.01 * oferta.plazoDias));
}

export async function crearRed({ repo, sii, reloj = () => new Date(), env = process.env }: OpcionesRed): Promise<Red> {
  const datos: DatosRed = await repo.cargar();
  // Licitaciones guardadas antes de los tramos: un solo tramo al precio de comprar solo.
  for (const l of datos.licitaciones) {
    l.tramos ??= [{ desde: 1, precioUnitario: l.precioSolo }];
    l.unidad ??= 'unidad';
    l.unidadPlural ??= 'unidades';
  }
  const oyentes = new Set<(evento: EventoRed) => void>();
  const enCurso = new Set<string>();
  const ahora = () => reloj().toISOString();

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

  async function guardarDocumento(ordenId: string, tipo: TipoDocumento, monto: number, r: { folio: number; trackId: string; estadoSii: string }) {
    const doc: Documento = { id: randomUUID(), ordenId, tipo, folio: r.folio, trackId: r.trackId, estadoSii: r.estadoSii, monto, emitidoEn: ahora() };
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
      if (!producto || !Number.isInteger(cantidad) || cantidad <= 0) {
        throw new ErrorRed('datos_invalidos', 'Cada ítem necesita producto y cantidad entera positiva');
      }
      if (precioUnitario === undefined) {
        throw new ErrorRed('datos_invalidos', `No tenemos precio para "${texto}". Productos: ${PRODUCTOS_DISPONIBLES.join(', ')}`);
      }
      if (!(precioUnitario > 0)) throw new ErrorRed('datos_invalidos', 'El precio debe ser positivo');
      return { producto, cantidad, precioUnitario };
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
      if (dia(doc.emitidoEn) === dia(reclamo.en)) await registrarReputacion(o.proveedorId, o.id, 'nota_credito_mismo_dia');
      return structuredClone(doc);
    });
  }

  const textoCorto = (x: unknown) => String(x ?? '').trim().slice(0, 40);

  function registrarComprador({ nombre, comuna, telefono }: NuevoComprador) {
    return enFila('compradores', async () => {
      const tel = telefono ? normalizarTelefono(telefono) : '';
      const existente = tel ? datos.negocios.find(n => normalizarTelefono(n.telefono) === tel) : undefined;
      if (existente) {
        if (existente.rol !== 'comprador') throw new ErrorRed('datos_invalidos', `${existente.nombre} es proveedor, no puede comprar en la red`);
        return structuredClone(existente);
      }
      const limpio = textoCorto(nombre);
      if (!limpio) throw new ErrorRed('datos_invalidos', 'Falta el nombre');
      const n: Negocio = { id: `n-c-${randomUUID().slice(0, 8)}`, nombre: limpio, comuna: textoCorto(comuna), rol: 'comprador', telefono: telefono?.trim() ?? '' };
      await guardar('negocios', n);
      return structuredClone(n);
    });
  }

  // Un mismo negocio (o teléfono) que vuelve a sumarse cambia su cantidad, no aparece dos veces.
  function unirseALicitacion(licitacionId: string, p: NuevoParticipante) {
    return enFila(licitacionId, async (): Promise<ResultadoUnion> => {
      const l = licitacionEnCurso(licitacionId);
      const cantidad = Number(p.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAXIMA) {
        throw new ErrorRed('datos_invalidos', `La cantidad debe ser un entero entre 1 y ${CANTIDAD_MAXIMA}`);
      }
      const antes = precioPorVolumen(l, totalUnidades(l));
      let n: Negocio | undefined;
      if (p.negocioId) n = negocio(p.negocioId, 'comprador');
      else if (p.telefono) n = await registrarComprador({ nombre: p.nombre ?? '', comuna: p.comuna, telefono: p.telefono });

      let participante = n ? l.participantes.find(x => x.negocioId === n.id) : undefined;
      if (participante) {
        participante.cantidad = cantidad;
      } else if (n) {
        participante = { negocioId: n.id, nombre: n.nombre, ...(n.comuna ? { comuna: n.comuna } : {}), ...(n.telefono ? { telefono: n.telefono } : {}), cantidad, en: ahora() };
        l.participantes.push(participante);
      } else {
        const nombre = textoCorto(p.nombre);
        if (!nombre) throw new ErrorRed('datos_invalidos', 'Falta el nombre');
        const comuna = textoCorto(p.comuna);
        participante = { nombre, cantidad, ...(comuna ? { comuna } : {}), en: ahora() };
        l.participantes.push(participante);
      }
      await guardar('licitaciones', l);
      const vista = vistaLicitacion(l);
      emitir('licitacion.participante', { licitacion: vista, participante });
      const bajoDePrecio = vista.precioActual < antes;
      if (bajoDePrecio) {
        emitir('licitacion.precio_bajo', {
          licitacionId: l.id, precioAnterior: antes, precioNuevo: vista.precioActual, totalUnidades: vista.totalUnidades,
        });
      }
      return { licitacion: sinTelefonos(vista), participante: sinTelefonos(participante), precioActual: vista.precioActual, bajoDePrecio };
    });
  }

  function licitacionAbierta() {
    const l = datos.licitaciones.filter(x => x.estado === 'abierta').at(-1);
    return l ? sinTelefonos(vistaLicitacion(l)) : null;
  }

  function ofertar(licitacionId: string, o: NuevaOferta) {
    return enFila(licitacionId, async () => {
      const l = licitacionEnCurso(licitacionId);
      negocio(o.proveedorId, 'proveedor');
      const precioUnitario = Number(o.precioUnitario), plazoDias = Number(o.plazoDias);
      if (!(precioUnitario > 0) || !Number.isInteger(plazoDias) || plazoDias < 0) {
        throw new ErrorRed('datos_invalidos', 'La oferta necesita precio positivo y plazo en días enteros');
      }
      const oferta: Oferta = { proveedorId: o.proveedorId, precioUnitario, plazoDias, en: ahora() };
      l.ofertas = l.ofertas.filter(x => x.proveedorId !== o.proveedorId).concat(oferta);
      await guardar('licitaciones', l);
      const vista = vistaLicitacion(l);
      emitir('licitacion.oferta', { licitacion: vista, oferta, nota: notaDeProveedor(o.proveedorId) });
      return vista;
    });
  }

  // Compra conjunta: una orden por participante al proveedor único, al precio del tramo alcanzado.
  // Sin proveedor fijo (licitación antigua): gana el menor precio ajustado por nota y plazo, y solo
  // compran los negocios participantes.
  function cerrarLicitacion(licitacionId: string) {
    return enFila(licitacionId, async () => {
      const l = licitacionEnCurso(licitacionId);
      const compras: { participante: Participante; proveedorId: string; precioUnitario: number }[] = [];
      if (l.proveedorId) {
        negocio(l.proveedorId, 'proveedor');
        const precioUnitario = precioPorVolumen(l, totalUnidades(l));
        for (const p of l.participantes) compras.push({ participante: p, proveedorId: l.proveedorId, precioUnitario });
      } else {
        const candidatas = l.ofertas.map(o => {
          const nota = notaDeProveedor(o.proveedorId);
          return { ...o, nota, precioAjustado: precioAjustado(o, nota) };
        });
        candidatas.sort((a, b) => a.precioAjustado - b.precioAjustado);
        if (candidatas[0]) l.ganadora = candidatas[0];
        const g = l.ganadora;
        if (g) for (const p of l.participantes.filter(x => x.negocioId)) compras.push({ participante: p, proveedorId: g.proveedorId, precioUnitario: g.precioUnitario });
      }
      l.estado = 'cerrada';
      await guardar('licitaciones', l);
      const ordenes: OrdenCompra[] = [];
      for (const { participante: p, proveedorId, precioUnitario } of compras) {
        p.negocioId ??= (await registrarComprador({ nombre: p.nombre, comuna: p.comuna, telefono: p.telefono })).id;
        ordenes.push(await crearOrden({
          compradorId: p.negocioId, proveedorId, items: [{ producto: l.producto, cantidad: p.cantidad, precioUnitario }],
        }));
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
      const ahorroTotal = ordenes.reduce((s, o) => s + o.items.reduce((t, i) => t + (l.precioSolo - i.precioUnitario) * i.cantidad, 0), 0);
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
    // El ranking es la historia de proveedores ficticios: la empresa real de la sala no entra (su nota va en su panel).
    for (const n of datos.negocios) if (n.rol === 'proveedor' && n.id !== PROVEEDOR_SALA) notas[n.id] = notaDeProveedor(n.id);
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
    crearOrden, fijarDespacho, confirmarOrden, registrarRecepcion, emitirNotaCredito, notaDeProveedor,
    unirseALicitacion, licitacionAbierta, ofertar, cerrarLicitacion, confirmarOrdenesDeLicitacion, registrarComprador, estadoDeLaRed, estadoPublico, negocioPorTelefono, actualizarEstadoDocumento, reiniciarDemo,
    escuchar(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
