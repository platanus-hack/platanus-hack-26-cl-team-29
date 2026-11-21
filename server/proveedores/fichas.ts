// Buscador de proveedores: une en una sola ficha por RUT a los proveedores de la red (registrados en Bando) y a los de
// Mercado Público, con lo que se sabe de cada uno por el SII y la IA, y busca en esas fichas.
// Privacidad: nunca sale el nombre de un comprador de la red ni de un organismo público (solo conteos).
import { categoriaDeGiro, categoriaDeTexto, nombreCategoria, type IdCategoria } from '../../shared/categorias.ts';
import { puedeVender } from '../../shared/red.ts';
import { sinTildes } from '../../shared/texto.ts';
import type { FotoMercadoPublico, OrdenLimpia } from '../mercado-publico/index.ts';
import { rangoDe } from '../mercado-publico/index.ts';
import { rutDeEmpresa } from '../mercado-publico/normalizar.ts';
import type { EstadoRed } from '../red/index.ts';
import type { EntradaClasificacion, Enriquecido } from './enriquecer.ts';

export type Fuente = 'bando' | 'mercado_publico' | 'sii' | 'ia' | 'reglas';

export interface FuenteConFecha {
  tipo: 'bando' | 'mercado_publico' | 'sii';
  /** Día del dato más reciente de esa fuente, `AAAA-MM-DD`, o null si no tiene fecha. */
  fecha: string | null;
}

export interface CategoriaConFuente {
  id: IdCategoria;
  nombre: string;
  /** De dónde salió: los productos que vende (Bando o Mercado Público), sus giros del SII o la IA. */
  fuente: Fuente;
  porque?: string;
}

export interface PrecioReferencia {
  producto: string;
  categoria: IdCategoria;
  unidad: string;
  /** Cuántos precios hay detrás del resumen. */
  datos: number;
  minimo: number;
  mediana: number;
  maximo: number;
  fecha: string | null;
  fuente: 'bando' | 'mercado_publico';
}

/** Lo que muestra el listado. */
export interface ResumenProveedor {
  /** RUT en forma para leer o, si no se conoce, el id del proveedor en la red. */
  clave: string;
  rut: string | null;
  nombre: string;
  region: string;
  comuna: string;
  categoria: CategoriaConFuente | null;
  secundarias: IdCategoria[];
  fuentes: FuenteConFecha[];
  /** Nota de la red (1 a 5); null si no está en Bando. */
  nota: number | null;
  /** Organismos públicos distintos que le compraron (contados, nunca nombrados). */
  organismos: number;
  destacados: string[];
}

export interface FichaProveedor extends ResumenProveedor {
  sii: { inicioActividades: string | null; giros: { codigo: string; descripcion: string }[]; consultado: string } | null;
  productos: PrecioReferencia[];
}

const MAX_PRODUCTOS = 40;
export const POR_PAGINA = 20;

const dia = (iso: string | undefined | null) => (iso ? iso.slice(0, 10) : null);
const masReciente = (fechas: (string | null)[]) => fechas.filter((f): f is string => !!f).sort().at(-1) ?? null;

/** Precios de un mismo producto y unidad resumidos en mínimo, mediana y máximo. */
function resumirPrecios(precios: { producto: string; categoria: IdCategoria; unidad: string; precio: number; fecha: string | null }[], fuente: PrecioReferencia['fuente']) {
  const grupos = new Map<string, typeof precios>();
  for (const p of precios) {
    const clave = `${sinTildes(p.producto)}|${p.unidad}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }
  return [...grupos.values()].map((g): PrecioReferencia => ({
    producto: g[0]!.producto, categoria: g[0]!.categoria, unidad: g[0]!.unidad, datos: g.length,
    ...rangoDe(g.map(p => p.precio)), fecha: masReciente(g.map(p => p.fecha)), fuente,
  }));
}

/** Proveedores de la red con lo que venden: sus productos de la compra conjunta, sus ofertas y sus pedidos. */
function proveedoresDeLaRed(estado: EstadoRed) {
  return estado.negocios.filter(puedeVender).map(n => {
    const precios = [
      ...estado.licitaciones.flatMap(l => l.productos.flatMap(p => [
        // Sus propios productos y, si es el proveedor de la compra conjunta, toda la canasta.
        ...(p.proveedorId === n.id || l.proveedorId === n.id ? [{ producto: p.nombre, unidad: p.unidad, precio: p.precioSolo, fecha: null }] : []),
        ...p.ofertas.filter(o => o.proveedorId === n.id).map(o => ({ producto: p.nombre, unidad: p.unidad, precio: o.precioUnitario, fecha: dia(o.en) })),
      ])),
      ...estado.ordenes.filter(o => o.proveedorId === n.id)
        .flatMap(o => o.items.map(i => ({ producto: i.producto, unidad: 'unidad', precio: i.precioUnitario, fecha: dia(o.creadaEn) }))),
    ].map(p => ({ ...p, categoria: categoriaDeTexto(p.producto) ?? 'otros' as IdCategoria }));
    return { negocio: n, rut: rutDeEmpresa(n.rut), nota: estado.notas[n.id] ?? null, precios };
  });
}

interface Base {
  clave: string;
  rut: string | null;
  nombre: string;
  region: string;
  comuna: string;
  nota: number | null;
  organismos: number;
  fuentes: FuenteConFecha[];
  productos: PrecioReferencia[];
}

function desdeMercadoPublico(rut: string, ordenes: OrdenLimpia[]): Base {
  const reciente = ordenes.reduce((a, b) => (b.fecha > a.fecha ? b : a));
  const precios = ordenes.flatMap(o => o.precios);
  return {
    clave: rut, rut, nombre: reciente.proveedor.nombre, region: reciente.proveedor.region, comuna: reciente.proveedor.comuna, nota: null,
    organismos: new Set(precios.map(p => p.organismo)).size,
    fuentes: [{ tipo: 'mercado_publico', fecha: masReciente(ordenes.map(o => o.fecha)) }],
    productos: resumirPrecios(precios.map(p => ({ producto: p.producto, categoria: p.categoriaBando, unidad: p.unidad, precio: p.precioUnitario, fecha: p.fecha })), 'mercado_publico'),
  };
}

/** Categoría principal y secundarias: primero lo que vende; si no, sus giros del SII; si no, la IA; si no, su nombre. */
function categorizar(productos: PrecioReferencia[], e: Enriquecido | undefined, deBando: boolean, porNombre: IdCategoria | null) {
  const conteo = new Map<IdCategoria, number>();
  for (const p of productos) if (p.categoria !== 'otros') conteo.set(p.categoria, (conteo.get(p.categoria) ?? 0) + p.datos);
  const porGiro = (e?.sii?.giros ?? []).map(categoriaDeGiro).filter((c): c is IdCategoria => !!c && c !== 'otros');
  const ordenadas = [...conteo].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  let categoria: CategoriaConFuente | null = null;
  if (ordenadas[0]) categoria = { id: ordenadas[0], nombre: nombreCategoria(ordenadas[0]), fuente: deBando ? 'bando' : 'mercado_publico' };
  else if (porGiro[0]) categoria = { id: porGiro[0], nombre: nombreCategoria(porGiro[0]), fuente: 'sii' };
  else if (e?.clasificacion) {
    const c = e.clasificacion;
    categoria = { id: c.categoria, nombre: nombreCategoria(c.categoria), fuente: c.fuente, porque: c.porque };
  } else if (porNombre) categoria = { id: porNombre, nombre: nombreCategoria(porNombre), fuente: 'reglas', porque: 'Por su nombre.' };
  const secundarias = [...new Set([...ordenadas, ...porGiro])].filter(c => c !== categoria?.id);
  return { categoria, secundarias };
}

function completar(b: Base, e: Enriquecido | undefined): FichaProveedor {
  const productos = b.productos.sort((x, y) => y.datos - x.datos || x.producto.localeCompare(y.producto));
  const { categoria, secundarias } = categorizar(productos, e, b.fuentes.some(f => f.tipo === 'bando') && !b.organismos, categoriaDeTexto(b.nombre));
  const sii = e?.sii ? { inicioActividades: e.sii.inicioActividades, giros: e.sii.giros, consultado: e.sii.consultado } : null;
  return {
    ...b,
    fuentes: sii ? [...b.fuentes, { tipo: 'sii', fecha: dia(sii.consultado) }] : b.fuentes,
    categoria, secundarias, sii,
    destacados: productos.slice(0, 3).map(p => p.producto),
    productos: productos.slice(0, MAX_PRODUCTOS),
  };
}

/** Una ficha por proveedor: los de la red y los de Mercado Público, unidos por RUT. */
export function armarFichas(estado: EstadoRed, mp: FotoMercadoPublico, enriquecido: (rut: string) => Enriquecido | undefined): FichaProveedor[] {
  const porRut = new Map<string, OrdenLimpia[]>();
  for (const o of mp.ordenes) porRut.set(o.proveedor.rut, [...(porRut.get(o.proveedor.rut) ?? []), o]);
  const bases = new Map<string, Base>([...porRut].map(([rut, ordenes]) => [rut, desdeMercadoPublico(rut, ordenes)]));
  const deLaRed: Base[] = [];
  for (const r of proveedoresDeLaRed(estado)) {
    const enBando: FuenteConFecha = { tipo: 'bando', fecha: masReciente(r.precios.map(p => p.fecha)) };
    const productos = resumirPrecios(r.precios, 'bando');
    const mpBase = r.rut ? bases.get(r.rut) : undefined;
    if (mpBase) {
      // Está en los dos: una sola ficha con el nombre y la comuna que dio en Bando y las dos fuentes.
      Object.assign(mpBase, { clave: mpBase.clave, nombre: r.negocio.nombre, comuna: r.negocio.comuna || mpBase.comuna, nota: r.nota });
      mpBase.fuentes = [enBando, ...mpBase.fuentes];
      mpBase.productos = [...productos, ...mpBase.productos];
    } else {
      deLaRed.push({
        clave: r.rut ?? r.negocio.id, rut: r.rut, nombre: r.negocio.nombre, region: '', comuna: r.negocio.comuna, nota: r.nota, organismos: 0,
        fuentes: [enBando], productos,
      });
    }
  }
  return [...deLaRed, ...bases.values()].map(b => completar(b, b.rut ? enriquecido(b.rut) : undefined));
}

/** Los que siguen sin categoría después de productos y giros, con lo que la IA necesita para clasificarlos. */
export const ambiguos = (fichas: FichaProveedor[], enriquecido: (rut: string) => Enriquecido | undefined): EntradaClasificacion[] =>
  fichas.filter(f => f.rut && !f.categoria && enriquecido(f.rut)?.sii !== undefined).map(f => ({
    rut: f.rut!, nombre: f.nombre, giros: f.sii?.giros.map(g => g.descripcion) ?? [], productos: f.productos.map(p => p.producto),
  }));

/** Texto en que se busca: nombre, RUT (con y sin puntos), categorías, giros y productos, sin tildes. */
export const textoDeBusqueda = (f: FichaProveedor): string => sinTildes([
  f.nombre, f.rut ?? '', (f.rut ?? '').replace(/[.-]/g, ''), f.region, f.comuna,
  ...[f.categoria?.id, ...f.secundarias].filter(Boolean).map(c => nombreCategoria(c!)),
  ...(f.sii?.giros.map(g => g.descripcion) ?? []), ...f.productos.map(p => p.producto),
].join(' '));

export interface Indice {
  fichas: FichaProveedor[];
  textos: string[];
}

export const indexar = (fichas: FichaProveedor[]): Indice => ({ fichas, textos: fichas.map(textoDeBusqueda) });

const resumen = ({ sii: _sii, productos: _productos, ...r }: FichaProveedor): ResumenProveedor => r;

/** Búsqueda: todas las palabras tienen que aparecer (sin tildes ni mayúsculas). Primero los de Bando, luego por organismos. */
export function buscar(indice: Indice, o: { q?: string; categoria?: string; pagina?: number }) {
  const palabras = sinTildes(o.q ?? '').split(/\s+/).filter(Boolean);
  const calzan = indice.fichas.filter((_, i) => palabras.every(p => indice.textos[i]!.includes(p) || indice.textos[i]!.includes(p.replace(/[.-]/g, ''))));
  const conteos: Record<string, number> = {};
  for (const f of calzan) for (const c of [f.categoria?.id, ...f.secundarias]) if (c) conteos[c] = (conteos[c] ?? 0) + 1;
  const filtradas = o.categoria ? calzan.filter(f => f.categoria?.id === o.categoria || f.secundarias.includes(o.categoria as IdCategoria)) : calzan;
  const enBando = (f: FichaProveedor) => (f.fuentes.some(x => x.tipo === 'bando') ? 1 : 0);
  filtradas.sort((a, b) => enBando(b) - enBando(a) || b.organismos - a.organismos || a.nombre.localeCompare(b.nombre));
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const pagina = Math.min(Math.max(1, Math.floor(o.pagina ?? 1)), paginas);
  return {
    total: filtradas.length, pagina, paginas, conteos,
    resultados: filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map(resumen),
  };
}
