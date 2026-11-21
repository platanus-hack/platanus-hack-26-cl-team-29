import { randomUUID } from 'node:crypto';
import { calcularNota } from './reputacion.ts';
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

export interface NuevaOrden {
  compradorId: string;
  proveedorId: string;
  items: Item[];
}

export interface NuevoParticipante {
  negocioId?: string;
  nombre?: string;
  comuna?: string;
  cantidad: number;
}

export interface Red {
  crearOrden(nueva: NuevaOrden): Promise<OrdenCompra>;
  confirmarOrden(ordenId: string): Promise<OrdenCompra>;
  registrarRecepcion(ordenId: string, recepcion: Recepcion): Promise<OrdenCompra>;
  emitirNotaCredito(ordenId: string): Promise<Documento>;
  notaDeProveedor(proveedorId: string): number;
  unirseALicitacion(licitacionId: string, participante: NuevoParticipante): Promise<Licitacion>;
  ofertar(licitacionId: string, oferta: Oferta): Promise<Licitacion>;
  cerrarLicitacion(licitacionId: string): Promise<Licitacion>;
  estadoDeLaRed(): EstadoRed;
  negocioPorTelefono(telefono: string): Negocio | undefined;
  /** Se llama con cada `red:evento`; devuelve la función para dejar de escuchar. */
  escuchar(oyente: (evento: EventoRed) => void): () => void;
}

export interface OpcionesRed {
  repo: Repositorio;
  sii: PuertoSii;
  reloj?: () => Date;
}

const ZONA = 'America/Santiago';
const dia = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(iso));
const neto = (items: Item[]) => items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0);
// Solo dígitos y los últimos 9 (móvil chileno), para que "+56 9 1234 5678" y "56912345678" coincidan.
const normalizarTelefono = (t: string) => t.replace(/\D/g, '').slice(-9);

// Puntaje de una oferta en la licitación: el precio, castigado por mala nota y por plazo largo.
//   precioAjustado = precioUnitario * (1 + 0.1 * (5 - nota)) * (1 + 0.01 * plazoDias)
// Gana el menor. Así un proveedor 0.8 puntos peor necesita ser ~8% más barato para ganar.
export function precioAjustado(oferta: Oferta, nota: number): number {
  return Math.round(oferta.precioUnitario * (1 + 0.1 * (5 - nota)) * (1 + 0.01 * oferta.plazoDias));
}

export async function crearRed({ repo, sii, reloj = () => new Date() }: OpcionesRed): Promise<Red> {
  const datos: DatosRed = await repo.cargar();
  const oyentes = new Set<(evento: EventoRed) => void>();
  const enCurso = new Set<string>();
  const ahora = () => reloj().toISOString();

  function emitir(tipo: TipoEventoRed, payload: unknown) {
    const evento: EventoRed = { tipo, datos: structuredClone(payload), en: ahora() };
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

  function validarItems(items: unknown): Item[] {
    if (!Array.isArray(items) || items.length === 0) throw new ErrorRed('datos_invalidos', 'La orden necesita al menos un ítem');
    return items.map((i: Partial<Item>) => {
      const producto = String(i?.producto ?? '').trim();
      const cantidad = Number(i?.cantidad), precioUnitario = Number(i?.precioUnitario);
      if (!producto || !Number.isInteger(cantidad) || cantidad <= 0 || !(precioUnitario > 0)) {
        throw new ErrorRed('datos_invalidos', 'Cada ítem necesita producto, cantidad entera positiva y precio positivo');
      }
      return { producto, cantidad, precioUnitario };
    });
  }

  async function crearOrden({ compradorId, proveedorId, items }: NuevaOrden): Promise<OrdenCompra> {
    negocio(compradorId, 'comprador');
    negocio(proveedorId, 'proveedor');
    const nueva: OrdenCompra = {
      id: `OC-${1001 + datos.ordenes.length}`,
      compradorId, proveedorId, items: validarItems(items), estado: 'enviada', creadaEn: ahora(),
    };
    await guardar('ordenes', nueva);
    emitir('orden.creada', { orden: nueva });
    return structuredClone(nueva);
  }

  // El proveedor confirma: recién ahí se emiten la factura 33 (con la OC) y la guía 52.
  // Si el SII falla a mitad, la orden queda confirmada y se puede volver a llamar:
  // solo se emite lo que falta.
  function confirmarOrden(ordenId: string) {
    return conCandado(ordenId, async () => {
      const o = orden(ordenId, 'enviada', 'confirmada');
      const datosEmision = { orden: o, emisor: negocio(o.proveedorId, 'proveedor'), receptor: negocio(o.compradorId, 'comprador') };
      if (o.estado === 'enviada') {
        o.estado = 'confirmada';
        await guardar('ordenes', o);
        emitir('orden.confirmada', { orden: o });
      }
      if (!documento(o.id, 33)) await guardarDocumento(o.id, 33, neto(o.items), await sii.emitirFactura(datosEmision));
      if (!documento(o.id, 52)) await guardarDocumento(o.id, 52, neto(o.items), await sii.emitirGuia(datosEmision));
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
      const item = producto ? o.items.find(i => i.producto === producto) : o.items[0];
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
        participante = { negocioId: n.id, nombre: n.nombre, comuna: n.comuna, cantidad };
        l.participantes = l.participantes.filter(x => x.negocioId !== n.id);
      } else {
        const nombre = String(p.nombre ?? '').trim().slice(0, 40);
        if (!nombre) throw new ErrorRed('datos_invalidos', 'Falta el nombre');
        const comuna = String(p.comuna ?? '').trim().slice(0, 40);
        participante = { nombre, cantidad, ...(comuna ? { comuna } : {}) };
      }
      l.participantes.push(participante);
      await guardar('licitaciones', l);
      emitir('licitacion.participante', { licitacion: l, participante });
      return structuredClone(l);
    });
  }

  function ofertar(licitacionId: string, o: Oferta) {
    return conCandado(licitacionId, async () => {
      const l = licitacionAbierta(licitacionId);
      negocio(o.proveedorId, 'proveedor');
      const precioUnitario = Number(o.precioUnitario), plazoDias = Number(o.plazoDias);
      if (!(precioUnitario > 0) || !Number.isInteger(plazoDias) || plazoDias < 0) {
        throw new ErrorRed('datos_invalidos', 'La oferta necesita precio positivo y plazo en días enteros');
      }
      const oferta: Oferta = { proveedorId: o.proveedorId, precioUnitario, plazoDias };
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

  function estadoDeLaRed(): EstadoRed {
    const notas: Record<string, number> = {};
    for (const n of datos.negocios) if (n.rol === 'proveedor') notas[n.id] = notaDeProveedor(n.id);
    return structuredClone({
      negocios: datos.negocios, ordenes: datos.ordenes, documentos: datos.documentos, notas, licitaciones: datos.licitaciones,
    });
  }

  function negocioPorTelefono(telefono: string) {
    const buscado = normalizarTelefono(telefono);
    const n = buscado ? datos.negocios.find(x => normalizarTelefono(x.telefono) === buscado) : undefined;
    return n && structuredClone(n);
  }

  return {
    crearOrden, confirmarOrden, registrarRecepcion, emitirNotaCredito, notaDeProveedor,
    unirseALicitacion, ofertar, cerrarLicitacion, estadoDeLaRed, negocioPorTelefono,
    escuchar(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
