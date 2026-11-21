// Funciones puras que convierten la foto de la red en lo que muestra cada pantalla.

import type { Documento, EstadoRed, EventoRed, ItemOrden, Licitacion, Negocio, NotaProveedor, Oferta, OrdenCompra, Participante, SiguienteTramo, Tramo } from './tipos.ts';
import { esTipoDocumento, nombreDocumento } from '../../../shared/documentos.ts';
import { dinero, nota } from '../../../shared/formato.ts';
import { ordenarTramos, precioAjustado, totalOrden, precioPorVolumen, siguienteTramo, tramoAlcanzado } from '../../../shared/precios.ts';
import { contar, enumerar, mayuscula, pluralDe, segun } from '../../../shared/texto.ts';
import { cantidadCon, pedidoDe, textoEstadoSii, unidadDe } from './formato.ts';

/** Nota que se asume si el backend todavía no tiene nota para un proveedor. */
const NOTA_SIN_DATOS = 4;

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

/** Calcula los tramos desde los participantes, si el backend no manda los derivados. */
function calcularTramos(participantes: Participante[], tramos: Tramo[], precioSolo: number | undefined) {
  const totalUnidades = participantes.reduce((s, p) => s + p.cantidad, 0);
  return {
    totalUnidades,
    precioActual: precioPorVolumen({ tramos, precioSolo }, totalUnidades),
    siguienteTramo: siguienteTramo(tramos, totalUnidades),
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
    // La ganadora de cada producto viene con el producto al cerrar; la de la licitación antigua es la del primero.
    ganadora: p.ganadora ?? (principal ? lic.ganadora : undefined),
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
  let precio = precioPorVolumen({ tramos, precioSolo: lic.precioSolo }, 0) ?? tramos[0]?.precioUnitario;
  if (precio === undefined || !ps.length) return [];
  const puntos: PuntoCurva[] = [{ compradores: 1, precio }];
  let unidades = 0;
  ps.forEach((p, i) => {
    unidades += cantidadPrincipal(lic, p);
    const nuevo = precioPorVolumen({ tramos, precioSolo: lic.precioSolo }, unidades);
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
        precioAjustado: precioAjustado(o, n),
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
  const delTramo = unidades === undefined ? undefined : tramoAlcanzado(tramos, unidades)?.precioUnitario;
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
  /** Quién ya dijo que sí y quién falta, cuando venden varios: "Insumos Beto ya facturó · falta el sí de Andina". */
  quienFacturo: string;
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

function eventoFacturada(eventos: EventoRed[], licitacionId: string, ordenes: readonly OrdenCompra[]) {
  const varios = new Set(ordenes.map(o => o.proveedorId)).size > 1;
  return eventos.find(e => e.tipo === 'licitacion.facturada' && e.datos.licitacionId === licitacionId && !(varios && e.datos.proveedorId));
}

/** "X dijo que sí · un solo envío al SII" o, con varios proveedores, quién facturó y de quién falta el sí. */
function quienFacturo(estado: EstadoRed, ordenes: readonly OrdenCompra[], conFactura: ReadonlySet<string>): string {
  const nombre = (id: string) => negocioPorId(estado, id)?.nombre ?? 'Un proveedor';
  const ids = [...new Set(ordenes.map(o => o.proveedorId))];
  const listos = ids.filter(id => ordenes.every(o => o.proveedorId !== id || conFactura.has(o.id))).map(nombre);
  const faltan = ids.map(nombre).filter(n => !listos.includes(n));
  if (ids.length <= 1) return `${listos[0] ?? faltan[0] ?? 'El proveedor'} dijo que sí · un solo envío al SII`;
  if (faltan.length === 0) return `${enumerar(listos)} dijeron que sí · un envío al SII por proveedor`;
  return `${listos.length ? `${enumerar(listos)} ya ${segun(listos.length, 'facturó', 'facturaron')} · ` : ''}falta el sí de ${enumerar(faltan)}`;
}

/** Quién vende en la compra: los proveedores con órdenes ("A y B") o, antes de cerrar, el ganador o el fijo. */
function proveedoresDeLaSala(lic: Licitacion, estado: EstadoRed, ordenes: readonly OrdenCompra[]): string {
  const conOrdenes = [...new Set(ordenes.map(o => o.proveedorId))].map(id => negocioPorId(estado, id)?.nombre ?? 'un proveedor');
  if (conOrdenes.length) return enumerar(conOrdenes);
  return negocioPorId(estado, lic.ganadora?.proveedorId ?? lic.proveedorId)?.nombre ?? lic.ganadora?.proveedorNombre ?? 'el proveedor';
}

export function resumenSala(lic: Licitacion, estado: EstadoRed, eventos: EventoRed[], ahora: number): ResumenSala {
  const tramos = estadoTramos(lic);
  const ordenes = ordenesDeLicitacion(lic, estado);
  const porOrden = new Map(ordenes.map(o => [o.id, o]));
  const porOrdenDeFactura = new Map(estado.documentos.map(d => [d.id, d.ordenId]));
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
        monto: d.monto ?? totalOrden(orden),
        estadoSii: d.estadoSii,
      };
    });
  // Con varios proveedores, cada uno factura lo suyo: su `licitacion.facturada` trae `proveedorId` y no cierra la sala.
  const finalizada = eventoFacturada(eventos, lic.id, ordenes);
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
    proveedor: proveedoresDeLaSala(lic, estado, ordenes),
    quienFacturo: quienFacturo(estado, ordenes, new Set(facturas.map(f => porOrdenDeFactura.get(f.id)!))),
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

/** Lo que describirEvento y detalleEvento leen de un evento y de la foto. */
function contextoEvento(e: EventoRed, estado: EstadoRed) {
  // La orden puede venir en el evento antes de que llegue la foto nueva.
  const ordenDatos = e.datos.orden && typeof e.datos.orden === 'object' ? (e.datos.orden as OrdenCompra) : undefined;
  const orden = estado.ordenes.find(o => o.id === idDeOrden(e)) ?? ordenDatos;
  const proveedorId = texto(e.datos.proveedorId) ?? texto(objeto(e.datos.oferta).proveedorId) ?? orden?.proveedorId;
  const lic = licitacionActual(estado, texto(e.datos.licitacionId));
  const producto = lic?.productos?.find(x => x.id === (texto(e.datos.productoId) ?? texto(objeto(e.datos.oferta).productoId)));
  return {
    orden,
    comprador: negocioPorId(estado, orden?.compradorId)?.nombre,
    proveedorId,
    proveedor: negocioPorId(estado, proveedorId)?.nombre ?? texto(objeto(e.datos.oferta).proveedorNombre),
    lic,
    producto,
    porUnidad: `por ${producto ? producto.unidad : lic ? unidadDeLicitacion(lic).singular : 'unidad'}`,
  };
}

/** Una línea legible para cada evento. Lee `datos` con cuidado: si falta algo, cae a un texto genérico. */
export function describirEvento(e: EventoRed, estado: EstadoRed): string {
  const { orden, comprador, proveedor, lic, producto, porUnidad } = contextoEvento(e, estado);
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
      const nombre = esTipoDocumento(tipo) ? nombreDocumento(tipo) : undefined;
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
      if (docs && texto(e.datos.proveedorId) && proveedor) return `${proveedor} emitió ${contar(docs, 'factura')} de la compra conjunta`;
      return docs ? `${docs === 1 ? 'Salió' : 'Salieron'} ${contar(docs, 'factura')} de la compra conjunta` : 'La compra conjunta quedó facturada';
    }
    case 'licitacion.producto': {
      const nuevo = objeto(e.datos.producto);
      return `${texto(e.datos.proveedorNombre) ?? 'Un proveedor'} sumó ${texto(nuevo.nombre) ?? 'un producto'} a la compra`;
    }
    case 'negocio.registrado': {
      const n = objeto(e.datos.negocio);
      return `${texto(n.nombre) ?? 'Un negocio'} ${n.vende ? 'ahora vende' : 'se sumó'} en la red`;
    }
    case 'sii.folios': {
      const tipo = numero(e.datos.tipo);
      const de = esTipoDocumento(tipo) ? ` de ${nombreDocumento(tipo).toLowerCase()}` : '';
      const libres = numero(e.datos.libres) ?? 0;
      const repuestos = numero(e.datos.repuestos) ?? 0;
      if (e.datos.estado === 'reponiendo') return `Reponiendo folios${de} en el SII`;
      if (e.datos.estado === 'suficiente' && repuestos > 0) return `${segun(repuestos, 'Llegó', 'Llegaron')} ${contar(repuestos, 'folio')}${de} del SII`;
      return `${segun(libres, 'Queda', 'Quedan')} ${contar(libres, 'folio')}${de}`;
    }
    case 'mercado_publico.actualizado': {
      const precios = numero(e.datos.precios) ?? 0;
      return `${segun(precios, 'Llegó', 'Llegaron')} ${contar(precios, 'precio')} de Mercado Público`;
    }
    case 'proveedores.actualizado': {
      const n = numero(e.datos.proveedores) ?? 0;
      return `${contar(n, 'proveedor')} con datos nuevos del SII`;
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

/**
 * Variante corta de describirEvento para las tarjetas que flotan sobre el mapa 3D: dos o tres palabras y el dato,
 * sin nombres de compradores (la tarjeta ya está sobre su punto). Lo que no tiene versión corta usa la larga.
 */
export function describirEventoCorto(e: EventoRed, estado: EstadoRed): string {
  switch (e.tipo) {
    case 'orden.creada': {
      const total = totalOrden({ items: lista<ItemOrden>(objeto(e.datos.orden).items) });
      return total > 0 ? `Pedido · ${dinero(total)}` : 'Pedido';
    }
    case 'documento.emitido': {
      const doc = objeto(e.datos.documento);
      const monto = numero(doc.monto);
      if (doc.tipo === 33) return `Venta facturada en el SII${monto ? ` · ${dinero(monto)}` : ''}`;
      break;
    }
    case 'reclamo.registrado':
      return '¿Llegó bien? No · reclamo en el SII';
    case 'nota.cambiada': {
      const [a, n] = [numero(e.datos.anterior), numero(e.datos.nota)];
      if (a !== undefined && n !== undefined) return `¿Llegó bien? Nota ${nota(a)} → ${nota(n)}`;
      break;
    }
    case 'licitacion.participante':
      if (e.datos.accion === 'entra') return 'Se sumó a la red';
      break;
  }
  return describirEvento(e, estado);
}

// ---------- Detalle de cada evento del feed ----------

export interface FilaDetalle {
  etiqueta: string;
  valor: string;
  /** Dato del SII: va con su logo. */
  sii?: boolean;
}

export interface DetalleEvento {
  /** Segunda línea del feed, siempre visible. Vacía si el evento no tiene más que su frase. */
  resumen: string;
  /** Todo el detalle, para el panel que se abre al tocar la fila. */
  filas: FilaDetalle[];
  /** Enlace privado al PDF: solo si el evento lo trae (la foto pública nunca lo trae). */
  pdfUrl?: string;
}

const unir = (partes: Array<string | false | undefined>) => partes.filter(Boolean).join(' · ');
const fila = (etiqueta: string, valor: string | false | undefined, sii?: boolean): FilaDetalle[] =>
  valor ? [{ etiqueta, valor, ...(sii ? { sii } : {}) }] : [];
const flecha = (antes: string | undefined, ahora: string) => (antes && antes !== ahora ? `${antes} → ${ahora}` : ahora);

const ESTADO_ORDEN: Record<string, string> = {
  enviada: 'enviada al proveedor', confirmada: 'confirmada', facturada: 'facturada', recibida: 'recibida conforme',
  reclamada: 'con reclamo en el SII', corregida: 'corregida con nota de crédito',
};

/** "4 cajas de rollos · 2 sacos de harina · $123.400"; con más de dos productos, los cuenta. */
function resumenPedido(items: ItemOrden[]): string {
  if (!items.length) return '';
  const que = items.length > 2 ? contar(items.length, 'producto') : items.map(i => pedidoDe(i.cantidad, i.producto)).join(' · ');
  return unir([que, dinero(totalOrden({ items }))]);
}

function filasDeOrden(orden: OrdenCompra, comprador?: string, proveedor?: string): FilaDetalle[] {
  const items = orden.items ?? [];
  return [
    ...items.map(i => ({ etiqueta: pedidoDe(i.cantidad, i.producto), valor: `${dinero(i.precioUnitario)} c/u · ${dinero(i.cantidad * i.precioUnitario)}` })),
    ...fila('Total neto', items.length > 0 && dinero(totalOrden({ items }))),
    ...fila('Comprador', comprador),
    ...fila('Proveedor', proveedor),
    ...fila('Orden', unir([orden.id, ESTADO_ORDEN[orden.estado]])),
  ];
}

/** El documento del evento, con su estado más reciente si ya llegó la foto nueva. */
function documentoDe(v: unknown, estado: EstadoRed): Documento | undefined {
  const d = objeto(v);
  if (!esTipoDocumento(d.tipo)) return undefined;
  return estado.documentos.find(x => x.id === d.id) ?? (d as unknown as Documento);
}

const montoNeto = (d: Documento) => (d.monto !== undefined ? dinero(d.monto) : undefined);

function resumenDocumento(d: Documento): string {
  return unir([`${nombreDocumento(d.tipo)} ${d.tipo}`, !!d.folio && `folio ${d.folio}`, d.monto !== undefined && `${dinero(d.monto)} neto`, textoEstadoSii(d.estadoSii)]);
}

function filasDocumento(d: Documento): FilaDetalle[] {
  return [
    ...fila('Documento', `${nombreDocumento(d.tipo)} (tipo ${d.tipo})`),
    ...fila('Folio', !!d.folio && String(d.folio)),
    ...fila('Monto neto', montoNeto(d)),
    ...fila('Estado en el SII', textoEstadoSii(d.estadoSii) || 'enviado', true),
    ...fila('Track ID', d.trackId ?? undefined),
  ];
}

/** Cómo cambió la nota del proveedor justo después del evento ("4,6 → 4,2"), si ya llegó ese cambio. */
function notaTras(e: EventoRed, eventos: readonly EventoRed[], proveedorId: string | undefined): string | undefined {
  const desde = Date.parse(e.en);
  const cambio = eventos
    .filter(x => x.tipo === 'nota.cambiada' && x.datos.proveedorId === proveedorId && Date.parse(x.en) >= desde)
    .sort((a, b) => Date.parse(a.en) - Date.parse(b.en))[0];
  const [a, n] = [numero(cambio?.datos.anterior), numero(cambio?.datos.nota)];
  return n === undefined ? undefined : flecha(a === undefined ? undefined : nota(a), nota(n));
}

/** La oferta anterior del mismo proveedor por el mismo producto, para mostrar cuánto bajó. */
function ofertaAnterior(e: EventoRed, eventos: readonly EventoRed[]): number | undefined {
  const o = objeto(e.datos.oferta);
  const previa = eventos.find(x => {
    const p = objeto(x.datos.oferta);
    return x.tipo === 'licitacion.oferta' && Date.parse(x.en) < Date.parse(e.en) && p.proveedorId === o.proveedorId && p.productoId === o.productoId;
  });
  return numero(objeto(previa?.datos.oferta).precioUnitario);
}

/**
 * El detalle concreto de cada evento del feed: una línea con los datos (productos y total, folio y estado del SII,
 * precio anterior y nuevo, efecto en la nota) y las filas para el panel. Con los mismos nombres que describirEvento.
 * `eventos` son los recientes, para cruzar un reclamo con el cambio de nota que provocó o una oferta con la anterior.
 */
export function detalleEvento(e: EventoRed, estado: EstadoRed, eventos: readonly EventoRed[] = []): DetalleEvento {
  const { orden, comprador, proveedorId, proveedor, lic, producto, porUnidad } = contextoEvento(e, estado);
  const items = orden?.items ?? [];
  const pdfUrl = texto(objeto(e.datos.documento).pdfUrl);
  const conPdf = (d: DetalleEvento): DetalleEvento => (pdfUrl ? { ...d, pdfUrl } : d);
  switch (e.tipo) {
    case 'orden.creada':
    case 'orden.confirmada':
      return { resumen: resumenPedido(items), filas: orden ? filasDeOrden(orden, comprador, proveedor) : [] };
    case 'documento.emitido':
    case 'documento.actualizado': {
      const doc = documentoDe(e.datos.documento, estado);
      if (!doc) break;
      return conPdf({ resumen: resumenDocumento(doc), filas: [...filasDocumento(doc), ...fila('Comprador', comprador), ...fila('Proveedor', proveedor)] });
    }
    case 'recepcion.registrada': {
      const faltante = numero(e.datos.faltante);
      const recepcion = faltante ? `faltaron ${faltante}` : 'todo conforme';
      return { resumen: unir([resumenPedido(items), recepcion]), filas: [...fila('Recepción', recepcion), ...(orden ? filasDeOrden(orden, comprador, proveedor) : [])] };
    }
    case 'reclamo.registrado': {
      const reclamo = objeto(e.datos.reclamo);
      const motivo = texto(e.datos.motivo) ?? (orden?.reclamo && `Faltan ${orden.reclamo.faltante} de ${orden.reclamo.producto}`);
      const cambio = notaTras(e, eventos, proveedorId);
      const factura = estado.documentos.find(d => d.ordenId === orden?.id && d.tipo === 33);
      return {
        resumen: unir([motivo, cambio && `nota ${cambio}`]),
        filas: [
          ...fila('Motivo', motivo),
          ...fila('Factura reclamada', factura && unir([factura.folio ? `folio ${factura.folio}` : undefined, montoNeto(factura)])),
          ...fila('Estado del reclamo', textoEstadoSii(texto(reclamo.estadoSii) ?? orden?.reclamo?.estadoSii), true),
          ...fila(`Nota de ${proveedor ?? 'el proveedor'}`, cambio),
          ...fila('Comprador', comprador),
          ...fila('Orden', orden?.id),
        ],
      };
    }
    case 'nota_credito.emitida': {
      const doc = documentoDe(e.datos.documento, estado);
      const cambio = notaTras(e, eventos, proveedorId);
      const factura = estado.documentos.find(d => d.ordenId === orden?.id && d.tipo === 33);
      return conPdf({
        resumen: unir([doc && resumenDocumento(doc), cambio && `nota ${cambio}`]),
        filas: [
          ...(doc ? filasDocumento(doc) : []),
          ...fila('Corrige la factura', !!factura?.folio && `folio ${factura.folio}`),
          ...fila('Por', orden?.reclamo && `${orden.reclamo.faltante} de menos de ${orden.reclamo.producto}`),
          ...fila(`Nota de ${proveedor ?? 'el proveedor'}`, cambio),
          ...fila('Comprador', comprador),
        ],
      });
    }
    case 'nota.cambiada': {
      const [a, n] = [numero(e.datos.anterior), numero(e.datos.nota)];
      if (n === undefined) break;
      const filas = ranking(estado, []);
      const puesto = filas.find(f => f.proveedor.id === proveedorId)?.puesto;
      const lugar = puesto !== undefined && `${puesto}.° de ${filas.length}`;
      const cambio = flecha(a === undefined ? undefined : nota(a), nota(n));
      return { resumen: unir([cambio, lugar && `${lugar} en el ranking`]), filas: [...fila('Proveedor', proveedor), ...fila('Nota', cambio), ...fila('Ranking', lugar)] };
    }
    case 'licitacion.participante': {
      const p = objeto(e.datos.participante) as unknown as Participante;
      const comuna = texto(p.comuna) ?? negocioPorId(estado, texto(p.negocioId))?.comuna;
      const carrito = (p.items ?? []).filter(i => i.cantidad > 0).flatMap(i => {
        const x = lic?.productos?.find(y => y.id === i.productoId);
        return x ? [{ x, cantidad: i.cantidad }] : [];
      });
      const unico = carrito.length === 1 ? carrito[0].x : undefined;
      const precio = unico?.precioActual ?? (carrito.length ? undefined : lic?.precioActual);
      return {
        resumen: unir([comuna, lic && e.datos.accion !== 'sale' && detalleCarrito(lic, p), precio !== undefined && `${dinero(precio)} ${unico ? `por ${unico.unidad}` : porUnidad}`]),
        filas: [
          ...fila('Comuna', comuna),
          ...carrito.map(({ x, cantidad }) => ({
            etiqueta: x.nombre,
            valor: unir([contar(cantidad, x.unidad, x.unidadPlural), x.precioActual !== undefined && `${dinero(x.precioActual)} c/u hoy`]),
          })),
          ...fila('Compra conjunta', lic && unir([lic.totalNegocios !== undefined && contar(lic.totalNegocios, 'negocio'), lic.montoTotal !== undefined && `${dinero(lic.montoTotal)} neto`])),
        ],
      };
    }
    case 'licitacion.oferta': {
      const o = objeto(e.datos.oferta);
      const precio = numero(o.precioUnitario);
      if (precio === undefined) break;
      const anterior = ofertaAnterior(e, eventos);
      const precios = `${flecha(anterior === undefined ? undefined : dinero(anterior), dinero(precio))} ${porUnidad}`;
      const plazo = numero(o.plazoDias);
      const notaOferta = numero(o.nota) ?? numero(e.datos.nota);
      return {
        resumen: unir([producto && nombreCorto(producto.nombre, producto.unidad), precios, e.datos.mejor === true && 'mejor oferta']),
        filas: [
          ...fila('Proveedor', proveedor),
          ...fila('Producto', producto?.nombre),
          ...fila('Precio', precios),
          ...fila('Plazo', plazo !== undefined && contar(plazo, 'día')),
          ...fila('Nota', notaOferta !== undefined && nota(notaOferta)),
        ],
      };
    }
    case 'licitacion.precio_bajo': {
      const [a, n] = [numero(e.datos.precioAnterior), numero(e.datos.precioNuevo)];
      if (n === undefined) break;
      const unidades = numero(e.datos.totalUnidades);
      const u = producto ? { singular: producto.unidad, plural: producto.unidadPlural } : lic ? unidadDeLicitacion(lic) : { singular: 'unidad', plural: 'unidades' };
      const precios = `${flecha(a === undefined ? undefined : dinero(a), dinero(n))} ${porUnidad}`;
      const grupo = unidades !== undefined && `el grupo lleva ${contar(unidades, u.singular, u.plural)}`;
      return { resumen: unir([precios, grupo]), filas: [...fila('Producto', producto?.nombre), ...fila('Precio', precios), ...fila('Volumen', grupo)] };
    }
    case 'licitacion.cerrada': {
      const l = objeto(e.datos.licitacion);
      const ganadora = numero(objeto(l.ganadora).precioUnitario);
      const negocios = lista(l.participantes).length;
      const ordenes = lista(e.datos.ordenes).length;
      const partes = [ganadora !== undefined && `${dinero(ganadora)} ${porUnidad}`, negocios > 0 && contar(negocios, 'negocio'), ordenes > 0 && contar(ordenes, 'orden', 'órdenes')];
      return { resumen: unir(partes), filas: [...fila('Precio ganador', partes[0]), ...fila('Negocios', partes[1]), ...fila('Órdenes', partes[2])] };
    }
    case 'licitacion.facturada': {
      const [total, ahorro] = [numero(e.datos.total), numero(e.datos.ahorroTotal)];
      const partes = [total !== undefined && `${dinero(total)} neto`, !!ahorro && `ahorro ${dinero(ahorro)}`];
      return { resumen: unir(partes), filas: [...fila('Total facturado', partes[0]), ...fila('Ahorro del grupo', !!ahorro && dinero(ahorro))] };
    }
    case 'licitacion.producto': {
      const x = objeto(e.datos.producto);
      const tramos = lista<Tramo>(x.tramos);
      const solo = numero(x.precioSolo);
      const desde = tramos.length ? Math.min(...tramos.map(t => t.precioUnitario)) : undefined;
      const partes = [solo !== undefined && `solo ${dinero(solo)}`, desde !== undefined && `en grupo desde ${dinero(desde)}`, tramos.length > 0 && contar(tramos.length, 'tramo')];
      return {
        resumen: unir(partes),
        filas: [...fila('Producto', texto(x.nombre)), ...fila('Comprando solo', solo !== undefined && dinero(solo)),
          ...ordenarTramos(tramos).map(t => ({ etiqueta: `Desde ${contar(t.desde, texto(x.unidad) ?? 'unidad', texto(x.unidadPlural))}`, valor: `${dinero(t.precioUnitario)} c/u` }))],
      };
    }
    case 'negocio.registrado': {
      const n = objeto(e.datos.negocio);
      const partes = [texto(n.comuna), texto(n.rubro)];
      return { resumen: unir(partes), filas: [...fila('Comuna', partes[0]), ...fila('Rubro', partes[1])] };
    }
    case 'mercado_publico.actualizado': {
      const [proveedores, precios, ordenes] = [numero(e.datos.proveedores), numero(e.datos.precios), numero(e.datos.ordenes)];
      const partes = [
        proveedores !== undefined && contar(proveedores, 'proveedor'),
        precios !== undefined && contar(precios, 'precio'),
        ordenes !== undefined && contar(ordenes, 'orden de compra', 'órdenes de compra'),
      ];
      return { resumen: unir(partes), filas: [...fila('Proveedores', partes[0]), ...fila('Precios de referencia', partes[1]), ...fila('Órdenes leídas', partes[2]), ...fila('Hasta', texto(e.datos.hasta)?.slice(0, 10))] };
    }
  }
  return { resumen: '', filas: [] };
}
