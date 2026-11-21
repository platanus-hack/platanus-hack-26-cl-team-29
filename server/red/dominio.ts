import { randomUUID } from 'node:crypto';
import { normalizarProducto, precioDe, PRODUCTOS_DISPONIBLES } from './catalogo.ts';
import { sinTelefonos } from './publico.ts';
import type { SinTelefono } from './publico.ts';
import { calcularNota } from './reputacion.ts';
import { sembrar } from './semilla.ts';
import type { PuertoSii } from './sii.ts';
import type { Repositorio } from './repositorio.ts';
import type {
  Coleccion, DatosRed, Documento, EstadoOrden, EstadoRed, EventoRed, Item, Licitacion, Negocio,
  Oferta, OrdenCompra, Participante, TipoDocumento, TipoEventoRed, TipoEventoReputacion,
} from './tipos.ts';

export type CodigoError = 'no_encontrado' | 'transicion_invalida' | 'datos_invalidos' | 'ocupado';

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

export interface NuevoParticipante {
  negocioId?: string;
  nombre?: string;
  comuna?: string;
  cantidad: number;
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
  unirseALicitacion(licitacionId: string, participante: NuevoParticipante): Promise<Licitacion>;
  ofertar(licitacionId: string, oferta: NuevaOferta): Promise<Licitacion>;
  cerrarLicitacion(licitacionId: string): Promise<Licitacion>;
  /** Foto interna, con teléfonos: solo para el servidor (agente de WhatsApp). */
  estadoDeLaRed(): EstadoRed;
  /** Foto para pantallas y `GET /api/red/estado`: sin teléfonos. */
  estadoPublico(): EstadoPublico;
  negocioPorTelefono(telefono: string): Negocio | null;
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

export async function crearRed({ repo, sii, reloj = () => new Date() }: OpcionesRed): Promise<Red> {
  const datos: DatosRed = await repo.cargar();
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

  function licitacionAbierta(id: string): Licitacion {
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
      id: `OC-${1001 + datos.ordenes.length}`,
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

  function unirseALicitacion(licitacionId: string, p: NuevoParticipante) {
    return conCandado(licitacionId, async () => {
      const l = licitacionAbierta(licitacionId);
      const cantidad = Number(p.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1000) {
        throw new ErrorRed('datos_invalidos', 'La cantidad debe ser un entero entre 1 y 1000');
      }
      let participante: Participante;
      if (p.negocioId) {
        const n = negocio(p.negocioId, 'comprador');
        participante = { negocioId: n.id, nombre: n.nombre, comuna: n.comuna, cantidad, en: ahora() };
        l.participantes = l.participantes.filter(x => x.negocioId !== n.id);
      } else {
        const nombre = String(p.nombre ?? '').trim().slice(0, 40);
        if (!nombre) throw new ErrorRed('datos_invalidos', 'Falta el nombre');
        const comuna = String(p.comuna ?? '').trim().slice(0, 40);
        participante = { nombre, cantidad, ...(comuna ? { comuna } : {}), en: ahora() };
      }
      l.participantes.push(participante);
      await guardar('licitaciones', l);
      emitir('licitacion.participante', { licitacion: l, participante });
      return structuredClone(l);
    });
  }

  function ofertar(licitacionId: string, o: NuevaOferta) {
    return conCandado(licitacionId, async () => {
      const l = licitacionAbierta(licitacionId);
      negocio(o.proveedorId, 'proveedor');
      const precioUnitario = Number(o.precioUnitario), plazoDias = Number(o.plazoDias);
      if (!(precioUnitario > 0) || !Number.isInteger(plazoDias) || plazoDias < 0) {
        throw new ErrorRed('datos_invalidos', 'La oferta necesita precio positivo y plazo en días enteros');
      }
      const oferta: Oferta = { proveedorId: o.proveedorId, precioUnitario, plazoDias, en: ahora() };
      l.ofertas = l.ofertas.filter(x => x.proveedorId !== o.proveedorId).concat(oferta);
      await guardar('licitaciones', l);
      emitir('licitacion.oferta', { licitacion: l, oferta, nota: notaDeProveedor(o.proveedorId) });
      return structuredClone(l);
    });
  }

  // Cierra con la oferta de menor precio ajustado por nota y plazo, y crea una orden
  // de compra al ganador por cada negocio participante (el público suma demanda, no compra).
  function cerrarLicitacion(licitacionId: string) {
    return conCandado(licitacionId, async () => {
      const l = licitacionAbierta(licitacionId);
      const candidatas = l.ofertas.map(o => {
        const nota = notaDeProveedor(o.proveedorId);
        return { ...o, nota, precioAjustado: precioAjustado(o, nota) };
      });
      candidatas.sort((a, b) => a.precioAjustado - b.precioAjustado);
      l.estado = 'cerrada';
      if (candidatas[0]) l.ganadora = candidatas[0];
      await guardar('licitaciones', l);
      const ordenes: OrdenCompra[] = [];
      if (l.ganadora) {
        for (const p of l.participantes.filter(x => x.negocioId)) {
          ordenes.push(await crearOrden({
            compradorId: p.negocioId!, proveedorId: l.ganadora.proveedorId,
            items: [{ producto: l.producto, cantidad: p.cantidad, precioUnitario: l.ganadora.precioUnitario }],
          }));
        }
      }
      emitir('licitacion.cerrada', { licitacion: l, ordenes });
      return structuredClone(l);
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
    await sembrar(repo, reloj());
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
    for (const n of datos.negocios) if (n.rol === 'proveedor') notas[n.id] = notaDeProveedor(n.id);
    return structuredClone({
      negocios: datos.negocios, ordenes: datos.ordenes, documentos: datos.documentos, notas, licitaciones: datos.licitaciones,
    });
  }

  const estadoPublico = () => sinTelefonos(estadoDeLaRed());

  function negocioPorTelefono(telefono: string) {
    const buscado = normalizarTelefono(telefono);
    const n = buscado ? datos.negocios.find(x => normalizarTelefono(x.telefono) === buscado) : undefined;
    return n ? structuredClone(n) : null;
  }

  return {
    crearOrden, fijarDespacho, confirmarOrden, registrarRecepcion, emitirNotaCredito, notaDeProveedor,
    unirseALicitacion, ofertar, cerrarLicitacion, estadoDeLaRed, estadoPublico, negocioPorTelefono, actualizarEstadoDocumento, reiniciarDemo,
    escuchar(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
