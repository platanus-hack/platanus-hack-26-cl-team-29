// Funciones puras que convierten la foto de la red en lo que muestra cada pantalla.

import type { Documento, EstadoRed, EventoRed, Licitacion, Negocio, NotaProveedor, Oferta, OrdenCompra, Participante } from './tipos.ts';
import { cantidadCon, contar, dinero, nota, textoEstadoSii } from './formato.ts';

/** Nota que se asume si el backend todavía no tiene nota para un proveedor. */
const NOTA_SIN_DATOS = 4;

/**
 * Misma fórmula que el backend (server/red/dominio.ts): el precio castigado por mala nota y plazo largo.
 * Gana el menor.
 */
export function precioAjustado(precioUnitario: number, plazoDias: number, nota: number): number {
  return Math.round(precioUnitario * (1 + 0.1 * (5 - nota)) * (1 + 0.01 * plazoDias));
}

const numero = (v: unknown) => (typeof v === 'number' ? v : undefined);
const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Acepta la foto del backend aunque falten listas o las notas vengan como objeto { proveedorId: nota }. */
export function normalizarEstado(raw: unknown): EstadoRed {
  if (!raw || typeof raw !== 'object') throw new Error('La foto de la red no es un objeto');
  const r = raw as Record<string, unknown>;
  const notas = Array.isArray(r.notas)
    ? (r.notas as NotaProveedor[])
    : Object.entries((r.notas as Record<string, number> | undefined) ?? {}).map(([proveedorId, n]) => ({ proveedorId, nota: n }));
  return {
    negocios: lista(r.negocios),
    ordenes: lista(r.ordenes),
    documentos: lista(r.documentos),
    notas: notas.filter(n => typeof n.nota === 'number'),
    licitaciones: lista(r.licitaciones),
  };
}

export function negocioPorId(estado: EstadoRed, id: string | undefined): Negocio | undefined {
  return estado.negocios.find(n => n.id === id);
}

export function notaDe(estado: EstadoRed, proveedorId: string): number | undefined {
  return estado.notas.find(n => n.proveedorId === proveedorId)?.nota;
}

// ---------- Notas y ranking ----------

export interface CambioNota {
  proveedorId: string;
  anterior: number;
  nota: number;
  en: number;
}

export function cambiosDeNota(previo: EstadoRed | null, nuevo: EstadoRed, ahora: number): CambioNota[] {
  if (!previo) return [];
  return nuevo.notas.flatMap(n => {
    const antes = notaDe(previo, n.proveedorId);
    return antes !== undefined && Math.abs(antes - n.nota) >= 0.05
      ? [{ proveedorId: n.proveedorId, anterior: antes, nota: n.nota, en: ahora }]
      : [];
  });
}

export interface FilaRanking {
  proveedor: Negocio;
  nota: number;
  puesto: number;
  cambio?: { anterior: number; puestoAnterior: number };
}

const ordenarPorNota = (notas: NotaProveedor[]) => [...notas].sort((a, b) => b.nota - a.nota);

/** Proveedores por nota. `recientes` son los cambios que todavía se muestran animados. */
export function ranking(estado: EstadoRed, recientes: CambioNota[]): FilaRanking[] {
  return ordenarPorNota(estado.notas).flatMap((n, i) => {
    const proveedor = negocioPorId(estado, n.proveedorId);
    if (!proveedor) return [];
    const c = recientes.find(r => r.proveedorId === n.proveedorId);
    const fila: FilaRanking = { proveedor, nota: n.nota, puesto: i + 1 };
    if (c) {
      const antes = ordenarPorNota(estado.notas.map(x => (x.proveedorId === c.proveedorId ? { ...x, nota: c.anterior } : x)));
      fila.cambio = { anterior: c.anterior, puestoAnterior: antes.findIndex(x => x.proveedorId === c.proveedorId) + 1 };
    }
    return [fila];
  });
}

export function contadores(estado: EstadoRed) {
  return {
    negocios: estado.negocios.length,
    proveedoresConNota: estado.notas.length,
    documentosSii: estado.documentos.length,
  };
}

// ---------- Ciclo de la orden ----------

export type EstadoPaso = 'hecho' | 'ultimo' | 'pendiente' | 'omitido';
export type Carril = 'comprador' | 'proveedor' | 'sii';

export interface Paso {
  titulo: string;
  carril: Carril;
  estado: EstadoPaso;
  detalle: string;
}

export function ordenActual(estado: EstadoRed): OrdenCompra | undefined {
  return [...estado.ordenes].sort((a, b) => Date.parse(b.creadaEn) - Date.parse(a.creadaEn))[0];
}

const conEstado = (texto: string, estadoSii: string | null | undefined) => {
  const e = textoEstadoSii(estadoSii);
  return e ? `${texto} · ${e}` : texto;
};

const AVANCE: Record<OrdenCompra['estado'], number> = {
  enviada: 0, confirmada: 1, facturada: 2, recibida: 3, reclamada: 3, corregida: 3,
};

function faltanteDe(eventos: EventoRed[], ordenId: string): number | undefined {
  const e = eventos.find(ev => ev.tipo === 'recepcion.registrada' && idDeOrden(ev) === ordenId);
  return numero(e?.datos.faltante);
}

export function cicloDeOrden(estado: EstadoRed, orden: OrdenCompra, eventos: EventoRed[]): Paso[] {
  const docs = estado.documentos.filter(d => d.ordenId === orden.id);
  const doc = (tipo: Documento['tipo']) => docs.find(d => d.tipo === tipo);
  const comprador = negocioPorId(estado, orden.compradorId)?.nombre ?? 'Comprador';
  const proveedor = negocioPorId(estado, orden.proveedorId)?.nombre ?? 'Proveedor';
  const item = orden.items[0];
  const avance = AVANCE[orden.estado] ?? 0;
  const conReclamo = orden.estado === 'reclamada' || orden.estado === 'corregida';
  const faltante = orden.reclamo?.faltante ?? faltanteDe(eventos, orden.id);
  const factura = doc(33);
  const nc = doc(61);

  const hechos = [
    true,
    avance >= 1,
    avance >= 2 || !!factura,
    avance >= 3,
    conReclamo,
    orden.estado === 'corregida' || !!nc,
  ];
  const omitido = (i: number) => orden.estado === 'recibida' && i >= 4;
  const ultimo = hechos.lastIndexOf(true);

  const textos: Array<[string, Carril, string]> = [
    ['Pide', 'comprador', item ? `${comprador} pide ${cantidadCon(item.cantidad, item.producto)} de ${item.producto}` : comprador],
    ['Recibe la OC', 'proveedor', `${proveedor} dice "sí" por WhatsApp`],
    ['Factura (33 con OC)', 'sii', factura ? conEstado(`Folio ${factura.folio}`, factura.estadoSii) : 'Emitida con la OC y la guía'],
    ['Cuadre', 'comprador', orden.estado === 'recibida' ? 'OC vs. guía: llegó todo' : faltante ? `OC vs. guía: ${faltante === 1 ? 'falta' : 'faltan'} ${faltante}` : 'OC vs. guía'],
    ['Reclamo en el SII', 'sii', omitido(4) ? 'No hizo falta' : conEstado('Falta parcial', orden.reclamo?.estadoSii)],
    ['Nota de crédito', 'proveedor', omitido(5) ? 'No hizo falta' : nc ? conEstado(`Folio ${nc.folio}, el mismo día`, nc.estadoSii) : 'El proveedor dice "sí" y sale'],
  ];
  return textos.map(([titulo, carril, detalle], i) => ({
    titulo,
    carril,
    detalle,
    estado: omitido(i) ? 'omitido' : i === ultimo ? 'ultimo' : hechos[i] ? 'hecho' : 'pendiente',
  }));
}

// ---------- Licitación ----------

export function licitacionActual(estado: EstadoRed, id?: string | null): Licitacion | undefined {
  if (id) return estado.licitaciones.find(l => l.id === id);
  return estado.licitaciones.find(l => l.estado === 'abierta') ?? estado.licitaciones.at(-1);
}

export interface OfertaVista {
  proveedor: string;
  proveedorId: string;
  precioUnitario: number;
  plazoDias: number;
  nota: number;
  precioAjustado: number;
  gana: boolean;
  /** Más barata que la ganadora, pero pierde por nota o plazo. */
  riesgo: boolean;
}

export interface PuntoCurva {
  compradores: number;
  precio: number;
}

export interface ResumenLicitacion {
  compradores: number;
  delPublico: number;
  totalUnidades: number;
  ultimos: Array<{ nombre: string; comuna: string; cantidad: number }>;
  ofertas: OfertaVista[];
  mejor?: OfertaVista;
  precioSolo?: number;
  ahorroPorUnidad: number;
  ahorroGrupal: number;
  porcentaje: number;
  curva: PuntoCurva[];
}

function nombreParticipante(estado: EstadoRed, p: Participante) {
  const n = negocioPorId(estado, p.negocioId);
  return { nombre: p.nombre ?? n?.nombre ?? 'Negocio', comuna: p.comuna ?? n?.comuna ?? '', cantidad: p.cantidad };
}

/** Cada proveedor una vez, con su mejor oferta, ordenadas por precio ajustado (la primera gana). */
function evaluarOfertas(ofertas: Oferta[], estado: EstadoRed): OfertaVista[] {
  const porProveedor = new Map<string, Oferta>();
  for (const o of ofertas) {
    const previa = porProveedor.get(o.proveedorId);
    if (!previa || o.precioUnitario < previa.precioUnitario) porProveedor.set(o.proveedorId, o);
  }
  return [...porProveedor.values()]
    .map(o => {
      const n = notaDe(estado, o.proveedorId) ?? NOTA_SIN_DATOS;
      return {
        proveedorId: o.proveedorId,
        proveedor: negocioPorId(estado, o.proveedorId)?.nombre ?? 'Proveedor',
        precioUnitario: o.precioUnitario,
        plazoDias: o.plazoDias,
        nota: n,
        precioAjustado: precioAjustado(o.precioUnitario, o.plazoDias, n),
        gana: false,
        riesgo: false,
      };
    })
    .sort((a, b) => a.precioAjustado - b.precioAjustado);
}

/**
 * Mejor precio a medida que llegan las ofertas; x = compradores que había cuando llegó cada una.
 * Se dejan fuera los proveedores que hoy pierden por nota o plazo aunque sean más baratos,
 * así la curva termina en el precio ganador.
 */
function curvaDePrecio(lic: Licitacion, excluidos: Set<string>, precioSolo: number | undefined): PuntoCurva[] {
  const conFecha = lic.ofertas.length > 0 && lic.ofertas.every(o => o.en) && lic.participantes.every(p => p.en);
  const ofertas = conFecha ? [...lic.ofertas].sort((a, b) => Date.parse(a.en!) - Date.parse(b.en!)) : lic.ofertas;
  const total = lic.participantes.length;
  const compradoresAl = (i: number, en?: string) =>
    conFecha ? lic.participantes.filter(p => Date.parse(p.en!) <= Date.parse(en!)).length : Math.max(1, Math.round(((i + 1) / ofertas.length) * total));

  const puntos: PuntoCurva[] = [];
  let actual = precioSolo ?? Infinity;
  if (precioSolo !== undefined) puntos.push({ compradores: Math.min(1, total), precio: precioSolo });
  ofertas.forEach((o, i) => {
    if (excluidos.has(o.proveedorId) || o.precioUnitario >= actual) return;
    actual = o.precioUnitario;
    puntos.push({ compradores: compradoresAl(i, o.en), precio: actual });
  });
  if (puntos.length) puntos.push({ compradores: Math.max(total, puntos.at(-1)!.compradores), precio: actual });
  return puntos;
}

export function resumenLicitacion(lic: Licitacion, estado: EstadoRed): ResumenLicitacion {
  const evaluadas = evaluarOfertas(lic.ofertas, estado);
  const idGanadora = lic.ganadora?.proveedorId ?? evaluadas[0]?.proveedorId;
  const ganadora = evaluadas.find(o => o.proveedorId === idGanadora);
  const ofertas = evaluadas
    .map(o => ({ ...o, gana: o === ganadora, riesgo: !!ganadora && o !== ganadora && o.precioUnitario < ganadora.precioUnitario }))
    .sort((a, b) => Number(b.gana) - Number(a.gana) || Number(b.riesgo) - Number(a.riesgo) || a.precioUnitario - b.precioUnitario);
  const mejor = ofertas.find(o => o.gana);
  // Sin precioSolo del backend, se usa la oferta más cara como referencia (solo si es mayor que la ganadora).
  const masCara = ofertas.length ? Math.max(...ofertas.map(o => o.precioUnitario)) : undefined;
  const precioSolo = lic.precioSolo ?? (masCara !== undefined && mejor && masCara > mejor.precioUnitario ? masCara : undefined);
  const totalUnidades = lic.participantes.reduce((s, p) => s + p.cantidad, 0);
  const ahorroPorUnidad = mejor && precioSolo ? Math.max(0, precioSolo - mejor.precioUnitario) : 0;
  return {
    compradores: lic.participantes.length,
    delPublico: lic.participantes.filter(p => !p.negocioId).length,
    totalUnidades,
    ultimos: [...lic.participantes].reverse().slice(0, 4).map(p => nombreParticipante(estado, p)),
    ofertas,
    mejor,
    precioSolo,
    ahorroPorUnidad,
    ahorroGrupal: ahorroPorUnidad * totalUnidades,
    porcentaje: precioSolo ? Math.round((ahorroPorUnidad / precioSolo) * 100) : 0,
    curva: curvaDePrecio(lic, new Set(ofertas.filter(o => o.riesgo).map(o => o.proveedorId)), precioSolo),
  };
}

// ---------- Feed "Pasando ahora" ----------

const texto = (v: unknown) => (typeof v === 'string' ? v : undefined);
const objeto = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function idDeOrden(e: EventoRed): string | undefined {
  return texto(objeto(e.datos.orden).id) ?? texto(objeto(e.datos.documento).ordenId) ?? texto(e.datos.ordenId);
}

const NOMBRE_DOC: Record<number, string> = { 33: 'Factura', 52: 'Guía de despacho', 61: 'Nota de crédito' };

/** Una línea legible para cada evento. Lee `datos` con cuidado: si falta algo, cae a un texto genérico. */
export function describirEvento(e: EventoRed, estado: EstadoRed): string {
  // La orden puede venir en el evento antes de que llegue la foto nueva.
  const ordenDatos = e.datos.orden && typeof e.datos.orden === 'object' ? (e.datos.orden as OrdenCompra) : undefined;
  const orden = estado.ordenes.find(o => o.id === idDeOrden(e)) ?? ordenDatos;
  const comprador = negocioPorId(estado, orden?.compradorId)?.nombre;
  const proveedorId = texto(e.datos.proveedorId) ?? texto(objeto(e.datos.oferta).proveedorId) ?? orden?.proveedorId;
  const proveedor = negocioPorId(estado, proveedorId)?.nombre;
  const item = orden?.items?.[0];
  switch (e.tipo) {
    case 'orden.creada':
      return comprador && proveedor && item
        ? `${comprador} pidió ${cantidadCon(item.cantidad, item.producto)} a ${proveedor}`
        : 'Nueva orden de compra';
    case 'orden.confirmada':
      return proveedor ? `${proveedor} confirmó la orden${comprador ? ` de ${comprador}` : ''}` : 'Orden confirmada';
    case 'documento.emitido':
    case 'documento.actualizado': {
      const doc = objeto(e.datos.documento);
      const tipo = numero(doc.tipo);
      const folio = numero(doc.folio);
      const nombre = tipo ? NOMBRE_DOC[tipo] : undefined;
      const titulo = `${nombre ?? 'Documento'}${folio ? ` folio ${folio}` : ''}`;
      if (e.tipo === 'documento.emitido') return `${titulo} ${nombre ? 'emitida' : 'emitido'} en el SII`;
      const estadoSii = textoEstadoSii(texto(doc.estadoSii));
      return estadoSii ? `${titulo} · ${estadoSii}` : `${titulo} cambió de estado en el SII`;
    }
    case 'recepcion.registrada': {
      const faltante = numero(e.datos.faltante);
      return faltante
        ? `${comprador ?? 'El comprador'} recibió con ${faltante} de menos`
        : `${comprador ?? 'El comprador'} recibió todo conforme`;
    }
    case 'reclamo.registrado':
      return `Reclamo en el SII contra ${proveedor ?? 'el proveedor'}`;
    case 'nota_credito.emitida':
      return `${proveedor ?? 'El proveedor'} emitió la nota de crédito el mismo día`;
    case 'nota.cambiada': {
      const n = numero(e.datos.nota);
      const a = numero(e.datos.anterior);
      return n !== undefined
        ? `La nota de ${proveedor ?? 'un proveedor'} pasó${a !== undefined ? ` de ${nota(a)}` : ''} a ${nota(n)}`
        : `Cambió la nota de ${proveedor ?? 'un proveedor'}`;
    }
    case 'licitacion.participante': {
      const p = objeto(e.datos.participante);
      const quien = texto(p.nombre) ?? negocioPorId(estado, texto(p.negocioId))?.nombre ?? 'Un negocio';
      const comuna = texto(p.comuna);
      return `${quien}${comuna ? ` en ${comuna}` : ''} se sumó a la compra conjunta`;
    }
    case 'licitacion.oferta': {
      const precio = numero(objeto(e.datos.oferta).precioUnitario);
      return `${proveedor ?? 'Un proveedor'} ofertó${precio ? ` ${dinero(precio)} por unidad` : ''}`;
    }
    case 'licitacion.cerrada': {
      const ganadora = negocioPorId(estado, texto(objeto(objeto(e.datos.licitacion).ganadora).proveedorId))?.nombre;
      return ganadora ? `Cerró la compra conjunta: gana ${ganadora}` : 'Cerró la compra conjunta';
    }
    case 'red.reiniciada':
      return 'La red volvió al inicio de la demo';
  }
  return 'Algo cambió en la red';
}
