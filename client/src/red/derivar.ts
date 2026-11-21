// Funciones puras que convierten la foto de la red en lo que muestra cada pantalla.

import type { Documento, EstadoRed, EventoRed, ItemOrden, Licitacion, Negocio, NotaProveedor, Oferta, OrdenCompra, Participante, SiguienteTramo, Tramo } from './tipos.ts';
import { dinero, nota } from '../../../shared/formato.ts';
import { contar, mayuscula, pluralDe } from '../../../shared/texto.ts';
import { cantidadCon, pedidoDe, textoEstadoSii, unidadDe } from './formato.ts';

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
    ['Pide', 'comprador', item ? `${comprador} pide ${pedidoDe(item.cantidad, item.producto)}` : comprador],
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

// ---------- Precio por tramos de volumen ----------

export interface EstadoTramos {
  tramos: Tramo[];
  totalUnidades: number;
  precioActual?: number;
  siguiente: SiguienteTramo | null;
  /** Cuántos tramos ya alcanzó el grupo. */
  alcanzados: number;
  /** Unidades donde empezó el tramo actual (0 si todavía no alcanza ninguno). */
  desdeActual: number;
}

const ordenarTramos = (tramos: Tramo[] | undefined) => [...(tramos ?? [])].sort((a, b) => a.desde - b.desde);

/** Precio con `unidades` en el grupo: el del tramo más alto alcanzado o, si ninguno, el de comprar solo. */
export function precioConUnidades(tramos: Tramo[], precioSolo: number | undefined, unidades: number): number | undefined {
  return ordenarTramos(tramos).filter(t => unidades >= t.desde).at(-1)?.precioUnitario ?? precioSolo;
}

/** Calcula los tramos desde los participantes. Lo usan la pantalla (si el backend no manda los derivados) y la red falsa. */
export function calcularTramos(participantes: Participante[], tramos: Tramo[] | undefined, precioSolo: number | undefined) {
  const orden = ordenarTramos(tramos);
  const totalUnidades = participantes.reduce((s, p) => s + p.cantidad, 0);
  const alcanzados = orden.filter(t => totalUnidades >= t.desde).length;
  const sig = orden[alcanzados];
  return {
    totalUnidades,
    precioActual: precioConUnidades(orden, precioSolo, totalUnidades),
    siguienteTramo: sig ? { ...sig, faltan: sig.desde - totalUnidades } : null,
  };
}

/**
 * Unidades de un participante en el producto principal (`productos[0]`). Sin canasta, su `cantidad`.
 * Con canasta, `cantidad` suma todos los productos y no sirve para los tramos de uno solo.
 */
export function cantidadPrincipal(lic: Licitacion, p: Participante): number {
  const principal = lic.productos?.[0];
  return principal ? cantidadDe(p, principal.id) : p.cantidad;
}

/** Unidades de un producto de la canasta en el carrito de un participante (sin `items`, su `cantidad`). */
export function cantidadDe(p: Participante, productoId: string): number {
  if (!p.items) return p.cantidad;
  return p.items.filter(i => i.productoId === productoId).reduce((s, i) => s + i.cantidad, 0);
}

/**
 * Estado de los tramos del producto principal: manda lo que calculó el backend; lo que falte se calcula aquí.
 * Con canasta, todo sale de `productos[0]` (el `totalUnidades` de la licitación es el de toda la canasta).
 */
export function estadoTramos(lic: Licitacion): EstadoTramos {
  const principal = lic.productos?.[0];
  const tramos = ordenarTramos(principal?.tramos ?? lic.tramos);
  const precioSolo = principal?.precioSolo ?? lic.precioSolo;
  const participantes = lic.participantes.map(p => ({ ...p, cantidad: cantidadPrincipal(lic, p) }));
  const calculado = calcularTramos(participantes, tramos, precioSolo);
  const totalUnidades = (principal ? principal.totalUnidades : lic.totalUnidades) ?? calculado.totalUnidades;
  const precioActual = principal ? principal.precioActual : lic.precioActual;
  const siguiente = principal ? principal.siguienteTramo : lic.siguienteTramo;
  const alcanzados = tramos.filter(t => totalUnidades >= t.desde).length;
  return {
    tramos,
    totalUnidades,
    precioActual: precioActual ?? calculado.precioActual,
    siguiente: siguiente === undefined ? calculado.siguienteTramo : siguiente,
    alcanzados,
    desdeActual: alcanzados ? tramos[alcanzados - 1].desde : 0,
  };
}

export const tieneTramos = (lic: Licitacion) => (lic.tramos?.length ?? 0) > 0;

// ---------- Canasta: cada producto con sus tramos y su competencia ----------

/** "Caja de rollos térmicos 80 mm (50 un.)" → "Rollos térmicos 80 mm": sin la unidad del comienzo ni el paréntesis. */
export function nombreCorto(nombre: string, unidad?: string): string {
  let corto = nombre.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (unidad) corto = corto.replace(new RegExp(`^${unidad}s?\\s+de\\s+`, 'i'), '');
  return corto ? mayuscula(corto) : nombre;
}

/**
 * La licitación vista desde un producto de la canasta: los campos de un solo producto pasan a ser los de ese
 * producto y quedan solo los participantes que lo piden. Así `estadoTramos`, `resumenLicitacion` y `competencia`
 * sirven para cualquier producto. Sin canasta (o con un id que no existe), la licitación tal cual.
 */
export function licitacionDeProducto(lic: Licitacion, productoId: string): Licitacion {
  const p = lic.productos?.find(x => x.id === productoId);
  if (!p) return lic;
  const principal = lic.productos![0].id === p.id;
  return {
    ...lic,
    productos: [p],
    producto: p.nombre,
    unidad: p.unidad,
    unidadPlural: p.unidadPlural,
    precioSolo: p.precioSolo,
    tramos: p.tramos,
    ofertas: p.ofertas ?? (principal ? lic.ofertas : []),
    totalUnidades: p.totalUnidades,
    precioActual: p.precioActual,
    siguienteTramo: p.siguienteTramo,
    // La ganadora del backend es la del primer producto; en los demás gana la oferta más barata.
    ganadora: principal ? lic.ganadora : undefined,
    participantes: lic.participantes.filter(x => cantidadDe(x, p.id) > 0),
  };
}

export interface ProductoSala {
  id: string;
  nombre: string;
  /** Nombre para pantallas: sin la unidad del comienzo ni el paréntesis. */
  corto: string;
  unidad: { singular: string; plural: string };
  tramos: EstadoTramos;
  precioSolo?: number;
  /** Cuánto menos que comprar solo, en %. */
  porcentaje: number;
  /** Negocios que piden este producto. */
  negocios: number;
  /** La oferta que va ganando este producto, si hay ofertas y alguna no supera el precio del tramo. */
  lider?: OfertaSala;
  /** Proveedores distintos que ofertaron por este producto. */
  proveedores: number;
}

/** Ids de la canasta; una licitación sin canasta es una canasta de un producto (`producto`, como el backend). */
const idsDeCanasta = (lic: Licitacion) => (lic.productos?.length ? lic.productos.map(p => p.id) : ['producto']);

/** Cada producto de la canasta con su precio de hoy, su avance al siguiente tramo y quién va ganando. */
export function productosDeCanasta(lic: Licitacion, estado: EstadoRed): ProductoSala[] {
  return idsDeCanasta(lic).map(id => {
    const vista = licitacionDeProducto(lic, id);
    const tramos = estadoTramos(vista);
    const precioSolo = vista.precioSolo;
    const ofertas = competencia(vista, estado);
    const unidad = unidadDeLicitacion(vista);
    return {
      id,
      nombre: vista.producto,
      corto: nombreCorto(vista.producto, unidad.singular),
      unidad,
      tramos,
      precioSolo,
      porcentaje: precioSolo && tramos.precioActual !== undefined ? Math.max(0, Math.round(((precioSolo - tramos.precioActual) / precioSolo) * 100)) : 0,
      negocios: vista.participantes.length,
      // Una oferta sobre el precio del tramo no manda: ahí gana el volumen y no se muestra un líder.
      lider: ofertas.find(o => o.gana && (tramos.precioActual === undefined || o.precioUnitario <= tramos.precioActual)),
      proveedores: new Set(ofertas.map(o => o.proveedorId)).size,
    };
  });
}

export interface TotalesCanasta {
  negocios: number;
  /** Unidades de todos los productos. */
  unidades: number;
  /** Lo que paga la sala hoy, neto. */
  monto: number;
  /** Lo que ahorra la sala contra comprar cada uno por su cuenta, neto. */
  ahorro: number;
}

/** Totales de toda la canasta: los que manda el backend o, si faltan, calculados producto por producto. */
export function totalesCanasta(lic: Licitacion): TotalesCanasta {
  const porProducto = idsDeCanasta(lic).map(id => {
    const vista = licitacionDeProducto(lic, id);
    const t = estadoTramos(vista);
    const precio = t.precioActual ?? 0;
    return { unidades: t.totalUnidades, monto: t.totalUnidades * precio, ahorro: t.totalUnidades * Math.max(0, (vista.precioSolo ?? precio) - precio) };
  });
  const suma = (k: 'unidades' | 'monto' | 'ahorro') => porProducto.reduce((s, p) => s + p[k], 0);
  return {
    negocios: lic.totalNegocios ?? lic.participantes.filter(p => p.cantidad > 0).length,
    unidades: lic.productos?.length ? (lic.totalUnidades ?? suma('unidades')) : suma('unidades'),
    monto: lic.montoTotal ?? suma('monto'),
    ahorro: lic.ahorroTotal ?? suma('ahorro'),
  };
}

/** Firma de lo que se ve de cada producto: si cambia, ese producto se movió. */
export function firmasDeCanasta(productos: ProductoSala[]): Record<string, string> {
  return Object.fromEntries(productos.map(p => [p.id, `${p.tramos.totalUnidades}|${p.tramos.precioActual}|${p.lider?.clave ?? ''}`]));
}

/** El producto que cambió entre dos firmas (el último de la canasta si cambiaron varios); `undefined` si ninguno. */
export function productoQueCambio(antes: Record<string, string>, ahora: Record<string, string>): string | undefined {
  return Object.keys(ahora).filter(id => id in antes && antes[id] !== ahora[id]).at(-1);
}

/** Unidad de la licitación, en singular y plural: la del backend o la que se deduce del producto. */
export function unidadDeLicitacion(lic: Licitacion): { singular: string; plural: string } {
  return lic.unidad ? { singular: lic.unidad, plural: lic.unidadPlural ?? pluralDe(lic.unidad) } : unidadDe(lic.producto);
}

/** Participantes en el orden en que se sumaron (si todos traen hora). */
function porLlegada(lic: Licitacion): Participante[] {
  return lic.participantes.every(p => p.en)
    ? [...lic.participantes].sort((a, b) => Date.parse(a.en!) - Date.parse(b.en!))
    : lic.participantes;
}

/**
 * Curva por tramos: recorre a los participantes en el orden en que llegaron y baja un escalón
 * cada vez que las unidades acumuladas cruzan un tramo. x = compradores en ese momento.
 */
function curvaPorTramos(lic: Licitacion): PuntoCurva[] {
  const ps = porLlegada(lic);
  const tramos = ordenarTramos(lic.tramos);
  let precio = precioConUnidades(tramos, lic.precioSolo, 0) ?? tramos[0]?.precioUnitario;
  if (precio === undefined || !ps.length) return [];
  const puntos: PuntoCurva[] = [{ compradores: 1, precio }];
  let unidades = 0;
  ps.forEach((p, i) => {
    unidades += cantidadPrincipal(lic, p);
    const nuevo = precioConUnidades(tramos, lic.precioSolo, unidades);
    if (nuevo !== undefined && nuevo < precio!) {
      precio = nuevo;
      puntos.push({ compradores: i + 1, precio });
    }
  });
  puntos.push({ compradores: Math.max(ps.length, puntos.at(-1)!.compradores), precio });
  return puntos;
}

export interface ResumenLicitacion {
  compradores: number;
  delPublico: number;
  totalUnidades: number;
  ultimos: Array<ReturnType<typeof nombreParticipante>>;
  ofertas: OfertaVista[];
  mejor?: OfertaVista;
  /** Precio por unidad hoy: el del tramo alcanzado o, sin tramos, el de la mejor oferta. */
  precioActual?: number;
  precioSolo?: number;
  ahorroPorUnidad: number;
  ahorroGrupal: number;
  porcentaje: number;
  curva: PuntoCurva[];
  /** La curva baja por tramos de volumen (y no por contraofertas). */
  curvaPorTramos: boolean;
}

export function nombreParticipante(estado: EstadoRed, lic: Licitacion, p: Participante) {
  const n = negocioPorId(estado, p.negocioId);
  return { nombre: p.nombre ?? n?.nombre ?? 'Negocio', comuna: p.comuna ?? n?.comuna ?? '', rubro: p.rubro ?? n?.rubro, cantidad: p.cantidad, detalle: detalleCarrito(lic, p) };
}

/** Lo que pidió un participante: "3 cajas", "3 cajas · 2 rollos" o, con más de dos productos, "4 productos". */
export function detalleCarrito(lic: Licitacion, p: Participante): string {
  const items = (p.items ?? []).filter(i => i.cantidad > 0);
  if (items.length > 2) return contar(items.length, 'producto');
  const partes = items.flatMap(i => {
    const producto = lic.productos?.find(x => x.id === i.productoId);
    return producto ? [contar(i.cantidad, producto.unidad, producto.unidadPlural)] : [];
  });
  // Dos productos con la misma unidad ("3 cajas · 1 caja") no se distinguen: se cuentan los productos.
  const unidades = items.map(i => lic.productos?.find(x => x.id === i.productoId)?.unidad);
  if (partes.length && partes.length === items.length && new Set(unidades).size === items.length) return partes.join(' · ');
  if (items.length > 1) return contar(items.length, 'producto');
  const u = unidadDeLicitacion(lic);
  return contar(p.cantidad, u.singular, u.plural);
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
function curvaPorOfertas(lic: Licitacion, excluidos: Set<string>, precioSolo: number | undefined): PuntoCurva[] {
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
  const porTramos = tieneTramos(lic);
  const tramos = porTramos ? estadoTramos(lic) : undefined;
  const precioActual = tramos ? tramos.precioActual : mejor?.precioUnitario;
  // Sin precioSolo del backend, se usa la oferta más cara como referencia (solo si es mayor que la ganadora).
  const masCara = ofertas.length ? Math.max(...ofertas.map(o => o.precioUnitario)) : undefined;
  const precioSolo = lic.precioSolo ?? (masCara !== undefined && mejor && masCara > mejor.precioUnitario ? masCara : undefined);
  const totalUnidades = tramos?.totalUnidades ?? lic.participantes.reduce((s, p) => s + p.cantidad, 0);
  const ahorroPorUnidad = precioActual !== undefined && precioSolo ? Math.max(0, precioSolo - precioActual) : 0;
  return {
    compradores: lic.participantes.length,
    delPublico: lic.participantes.filter(p => !p.negocioId).length,
    totalUnidades,
    ultimos: [...porLlegada(lic)].reverse().slice(0, 8).map(p => nombreParticipante(estado, lic, p)),
    ofertas,
    mejor,
    precioActual,
    precioSolo,
    ahorroPorUnidad,
    ahorroGrupal: ahorroPorUnidad * totalUnidades,
    porcentaje: precioSolo ? Math.round((ahorroPorUnidad / precioSolo) * 100) : 0,
    curva: porTramos ? curvaPorTramos(lic) : curvaPorOfertas(lic, new Set(ofertas.filter(o => o.riesgo).map(o => o.proveedorId)), precioSolo),
    curvaPorTramos: porTramos,
  };
}

// ---------- La sala compra junta ----------

/** Cómo se muestra una bajada de precio en /sala. */
export type TipoBajada = 'tramo' | 'oferta';

/** Ningún aviso a pantalla completa antes de este tiempo desde el anterior. */
export const PAUSA_AVISO_MS = 6000;

/**
 * Decide cómo mostrar un `licitacion.precio_bajo`: `tramo` (aviso a pantalla completa) si el precio nuevo
 * es el del tramo que el grupo acaba de alcanzar; `oferta` (animación en el lugar) si lo bajó un proveedor.
 * `null` si el evento no trae una bajada real.
 */
export function tipoDeBajada(datos: Record<string, unknown>, tramos: Tramo[] | undefined): TipoBajada | null {
  const anterior = numero(datos.precioAnterior);
  const nuevo = numero(datos.precioNuevo);
  const unidades = numero(datos.totalUnidades);
  if (anterior === undefined || nuevo === undefined || nuevo >= anterior) return null;
  const delTramo = unidades === undefined ? undefined : precioConUnidades(tramos ?? [], undefined, unidades);
  return delTramo === nuevo ? 'tramo' : 'oferta';
}

export interface BajadaProducto {
  productoId: string;
  /** Nombre corto del producto, para el aviso. */
  nombre: string;
  unidad: string;
  tipo: TipoBajada;
  anterior?: number;
  nuevo: number;
}

/**
 * Un `licitacion.precio_bajo` leído con los tramos de SU producto (sin `productoId`, el primero de la canasta):
 * cruzar el tramo 10 de etiquetas es de tramo aunque el precio no sea un tramo de los rollos.
 */
export function bajadaDeProducto(datos: Record<string, unknown>, lic: Licitacion): BajadaProducto | null {
  const id = texto(datos.productoId) ?? idsDeCanasta(lic)[0];
  if (lic.productos?.length && !lic.productos.some(p => p.id === id)) return null;
  const vista = licitacionDeProducto(lic, id);
  const tipo = tipoDeBajada(datos, vista.tramos);
  if (!tipo) return null;
  const unidad = unidadDeLicitacion(vista);
  return { productoId: id, nombre: nombreCorto(vista.producto, unidad.singular), unidad: unidad.singular, tipo, anterior: numero(datos.precioAnterior), nuevo: numero(datos.precioNuevo)! };
}

/** El aviso a pantalla completa se muestra solo si es de tramo y pasó la pausa desde el anterior. */
export function mostrarAviso(tipo: TipoBajada | null, ahora: number, ultimoAviso: number | null): boolean {
  return tipo === 'tramo' && (ultimoAviso === null || ahora - ultimoAviso >= PAUSA_AVISO_MS);
}

export interface OfertaSala {
  /** Clave estable por oferta: el backend reemplaza la oferta anterior de cada proveedor. */
  clave: string;
  proveedorId: string;
  proveedor: string;
  precioUnitario: number;
  nota?: number;
  /** Es la mejor oferta vigente. */
  gana: boolean;
  /** Es el proveedor real que está en el escenario. */
  enEscenario: boolean;
}

/**
 * Proveedores compitiendo: las ofertas de la más nueva a la más vieja. Gana la `ganadora` del backend
 * o, si no viene, la más barata (y entre iguales, la primera que llegó).
 */
export function competencia(lic: Licitacion, estado: EstadoRed): OfertaSala[] {
  const conOrden = lic.ofertas.map((o, n) => ({ o, n }));
  const llegada = conOrden.every(x => x.o.en) ? [...conOrden].sort((a, b) => Date.parse(a.o.en!) - Date.parse(b.o.en!)) : conOrden;
  const mejor = lic.ganadora
    ? llegada.find(x => x.o.proveedorId === lic.ganadora!.proveedorId && x.o.precioUnitario === lic.ganadora!.precioUnitario)
    : llegada.reduce<(typeof llegada)[number] | undefined>((m, x) => (!m || x.o.precioUnitario < m.o.precioUnitario ? x : m), undefined);
  return llegada.map(({ o, n }) => ({
    clave: `${o.proveedorId}-${o.en ?? n}-${o.precioUnitario}`,
    proveedorId: o.proveedorId,
    proveedor: o.proveedorNombre ?? negocioPorId(estado, o.proveedorId)?.nombre ?? 'Proveedor',
    precioUnitario: o.precioUnitario,
    nota: o.nota ?? notaDe(estado, o.proveedorId),
    gana: mejor?.n === n,
    enEscenario: !!lic.proveedorId && o.proveedorId === lic.proveedorId,
  })).reverse();
}

/** abierta → cerrada (espera el sí del proveedor) → facturando (llegan las facturas) → lista (total y ahorro). */
export type FaseSala = 'abierta' | 'cerrada' | 'facturando' | 'lista';

export interface FacturaSala {
  id: string;
  folio: number | null;
  nombre: string;
  comuna: string;
  rubro?: string;
  unidades: number;
  /** Líneas de la factura (una por producto). */
  lineas: number;
  /** "3 cajas" o, si la factura trae varios productos de la canasta, "3 productos". */
  detalle: string;
  monto: number;
  estadoSii: string | null;
}

/** "3 cajas" con la unidad del producto de la canasta (o la de la licitación). */
function cantidadDeItem(lic: Licitacion, item: ItemOrden): string {
  const producto = lic.productos?.find(x => x.id === item.productoId || x.nombre === item.producto);
  const u = producto ? { singular: producto.unidad, plural: producto.unidadPlural } : unidadDeLicitacion(lic);
  return contar(item.cantidad, u.singular, u.plural);
}

export interface ResumenSala {
  fase: FaseSala;
  proveedor: string;
  unidad: { singular: string; plural: string };
  tramos: EstadoTramos;
  precioSolo?: number;
  /** Cada producto de la canasta (uno si la compra no tiene canasta). */
  productos: ProductoSala[];
  canasta: TotalesCanasta;
  /** Participantes, el más nuevo primero; `n` es su número de llegada (estable, sirve de clave). */
  muro: Array<{ n: number } & ReturnType<typeof nombreParticipante>>;
  facturas: FacturaSala[];
  aceptadas: number;
  ordenes: number;
  totalNeto: number;
  ahorroTotal: number;
}

const ACEPTADO = new Set(['aceptado', 'reparo']);
export const facturaAceptada = (estadoSii: string | null) => !!estadoSii && ACEPTADO.has(estadoSii);

/**
 * Órdenes que salieron de esta compra conjunta: las de `ordenIds` o, si el backend no las manda,
 * las del mismo proveedor creadas después de que se sumó el primer participante.
 */
export function ordenesDeLicitacion(lic: Licitacion, estado: EstadoRed): OrdenCompra[] {
  if (lic.ordenIds) {
    const ids = new Set(lic.ordenIds);
    return estado.ordenes.filter(o => ids.has(o.id));
  }
  const primera = Math.min(...lic.participantes.map(p => (p.en ? Date.parse(p.en) : Infinity)));
  return estado.ordenes.filter(o => !!lic.proveedorId && o.proveedorId === lic.proveedorId && Date.parse(o.creadaEn) >= primera);
}

function eventoFacturada(eventos: EventoRed[], licitacionId: string) {
  return eventos.find(e => e.tipo === 'licitacion.facturada' && e.datos.licitacionId === licitacionId);
}

export function resumenSala(lic: Licitacion, estado: EstadoRed, eventos: EventoRed[], ahora: number): ResumenSala {
  const tramos = estadoTramos(lic);
  const ordenes = ordenesDeLicitacion(lic, estado);
  const porOrden = new Map(ordenes.map(o => [o.id, o]));
  const facturas = estado.documentos
    .filter(d => d.tipo === 33 && porOrden.has(d.ordenId))
    .sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0))
    .map(d => {
      const orden = porOrden.get(d.ordenId)!;
      const comprador = negocioPorId(estado, orden.compradorId);
      const item = orden.items[0];
      return {
        id: d.id,
        folio: d.folio,
        nombre: comprador?.nombre ?? 'Negocio',
        comuna: comprador?.comuna ?? '',
        rubro: comprador?.rubro,
        unidades: orden.items.reduce((s, i) => s + i.cantidad, 0),
        lineas: orden.items.length,
        // Con canasta, una factura puede traer varias líneas: se cuentan los productos.
        detalle: orden.items.length > 1 ? contar(orden.items.length, 'producto') : item ? cantidadDeItem(lic, item) : '',
        monto: d.monto ?? orden.items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0),
        estadoSii: d.estadoSii,
      };
    });
  const finalizada = eventoFacturada(eventos, lic.id);
  const cerrada = lic.estado !== 'abierta' || Date.parse(lic.cierraEn) <= ahora;
  // Lista: llegó `licitacion.facturada` o (al recargar la pantalla) todas las órdenes ya tienen su factura.
  const todasFacturadas = ordenes.length > 0 && facturas.length >= ordenes.length;
  const fase: FaseSala =
    finalizada || todasFacturadas ? 'lista' : facturas.length ? 'facturando' : cerrada ? 'cerrada' : 'abierta';
  const canasta = totalesCanasta(lic);
  const total = numero(finalizada?.datos.total);
  const ahorro = numero(finalizada?.datos.ahorroTotal);
  const muro = porLlegada(lic).map((p, i) => ({ n: i, ...nombreParticipante(estado, lic, p) })).reverse();
  return {
    fase,
    proveedor: negocioPorId(estado, lic.ganadora?.proveedorId ?? lic.proveedorId)?.nombre ?? lic.ganadora?.proveedorNombre ?? 'el proveedor',
    unidad: unidadDeLicitacion(lic),
    tramos,
    precioSolo: lic.precioSolo,
    productos: productosDeCanasta(lic, estado),
    canasta,
    muro,
    facturas,
    aceptadas: facturas.filter(f => facturaAceptada(f.estadoSii)).length,
    ordenes: ordenes.length,
    totalNeto: total ?? facturas.reduce((s, f) => s + f.monto, 0),
    ahorroTotal: ahorro ?? canasta.ahorro,
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
  const proveedor = negocioPorId(estado, proveedorId)?.nombre ?? texto(objeto(e.datos.oferta).proveedorNombre);
  const item = orden?.items?.[0];
  const lic = licitacionActual(estado, texto(e.datos.licitacionId));
  const producto = lic?.productos?.find(x => x.id === (texto(e.datos.productoId) ?? texto(objeto(e.datos.oferta).productoId)));
  const porUnidad = `por ${producto ? producto.unidad : lic ? unidadDeLicitacion(lic).singular : 'unidad'}`;
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
      if (e.datos.accion === 'sale') return `${quien} salió de la compra`;
      if (e.datos.accion === 'cambia') return `${quien} cambió su pedido`;
      return `${quien}${comuna ? ` en ${comuna}` : ''} se sumó a la compra`;
    }
    case 'licitacion.oferta': {
      const precio = numero(objeto(e.datos.oferta).precioUnitario);
      return `${proveedor ?? 'Un proveedor'} ofertó${precio ? ` ${dinero(precio)} ${porUnidad}` : ''}`;
    }
    case 'licitacion.precio_bajo': {
      const nuevo = numero(e.datos.precioNuevo);
      const quien = producto && (lic?.productos?.length ?? 0) > 1 ? nombreCorto(producto.nombre, producto.unidad) : 'La compra conjunta';
      return nuevo ? `${quien} bajó a ${dinero(nuevo)} ${porUnidad}` : 'Bajó el precio de la compra conjunta';
    }
    case 'licitacion.facturada': {
      const docs = numero(e.datos.documentos) ?? lista(e.datos.documentos).length;
      return docs ? `${docs === 1 ? 'Salió' : 'Salieron'} ${contar(docs, 'factura')} de la compra conjunta` : 'La compra conjunta quedó facturada';
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
