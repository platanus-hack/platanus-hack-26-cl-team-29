// Lógica pura del carrito de la canasta: productos de la compra conjunta, precio proyectado con mis cambios,
// totales, ahorro, la pista del próximo tramo y el envío diferido (debounce) del carrito completo.
// Sin React ni red, para poder probarla con node:test.

import { dinero } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import type { Participante, SiguienteTramo } from '../red/tipos.ts';
import { siguienteTramo, tramoAlcanzado } from '../../../shared/precios.ts';
import { normalizarTramos } from './logica.ts';
import type { LicitacionCanal, Tramo } from './tipos.ts';

/** Cantidad máxima por producto (`CANTIDAD_MAXIMA` del dominio). */
export const CANTIDAD_MAXIMA = 20;
/** Espera tras el último toque antes de enviar el carrito. */
export const ESPERA_ENVIO_MS = 400;

/** productoId → cantidad. Solo cantidades mayores que cero. */
export type Carrito = Record<string, number>;

export interface ItemCarrito {
  productoId: string;
  cantidad: number;
}

/** Un producto de la canasta, con los derivados del backend (o calculados si faltan). */
export interface ProductoCanasta {
  id: string;
  nombre: string;
  unidad: string;
  unidadPlural: string;
  precioSolo: number;
  tramos: Tramo[];
  /** Unidades de este producto en todo el grupo, incluidas las mías ya guardadas. */
  totalUnidades: number;
  precioActual: number;
  siguienteTramo: SiguienteTramo | null;
}

const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Precio del tramo con `unidades`; antes del primero, el del primero. */
const precioDelTramo = (tramos: Tramo[], unidades: number) => (tramoAlcanzado(tramos, unidades) ?? tramos[0]!).precioUnitario;

/** Ítems de un participante: los de la canasta o, si es de antes, uno del primer producto. */
export function itemsDe(p: Participante, primerProducto: string): ItemCarrito[] {
  return p.items ?? (p.cantidad > 0 ? [{ productoId: primerProducto, cantidad: p.cantidad }] : []);
}

/** Productos de la canasta. Una licitación de un solo producto se lee como una canasta de uno. */
export function productosDe(lic: LicitacionCanal): ProductoCanasta[] {
  const crudos = lic.productos?.length
    ? lic.productos
    : [{
      id: 'producto', nombre: lic.producto, unidad: lic.unidad ?? 'unidad', unidadPlural: lic.unidadPlural ?? 'unidades',
      precioSolo: lic.precioSolo ?? 0, tramos: lic.tramos ?? [], totalUnidades: undefined, precioActual: lic.precioActual, siguienteTramo: lic.siguienteTramo,
    }];
  const primero = crudos[0].id;
  return crudos.map(p => {
    const tramos = normalizarTramos(p.tramos);
    const total = numero(p.totalUnidades) ?? lic.participantes.reduce(
      (s, x) => s + itemsDe(x, primero).filter(i => i.productoId === p.id).reduce((a, i) => a + i.cantidad, 0), 0);
    const precioTramo = tramos.length ? precioDelTramo(tramos, total) : undefined;
    const precioActual = numero(p.precioActual) ?? precioTramo ?? p.precioSolo;
    const precioSolo = numero(p.precioSolo) || tramos[0]?.precioUnitario || precioActual;
    return {
      id: p.id, nombre: p.nombre, unidad: p.unidad || 'unidad', unidadPlural: p.unidadPlural || 'unidades', precioSolo, tramos,
      totalUnidades: total, precioActual,
      // Solo cuenta un tramo que de verdad baja el precio (con 0 unidades, el primero cuesta lo mismo que comprar solo).
      siguienteTramo: p.siguienteTramo && p.siguienteTramo.precioUnitario < precioActual ? p.siguienteTramo : siguienteTramo(tramos, total, precioActual),
    };
  });
}

/** Lo que el grupo ya tiene guardado de este negocio (según la foto). */
export function carritoEnLaFoto(lic: LicitacionCanal, negocioId: string | undefined): Carrito | null {
  const p = negocioId ? lic.participantes.find(x => x.negocioId === negocioId) : undefined;
  if (!p) return null;
  return desdeItems(itemsDe(p, productosDe(lic)[0]?.id ?? 'producto'));
}

// ---------- El carrito ----------

export const limitar = (n: number) => Math.min(CANTIDAD_MAXIMA, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/** Fija la cantidad de un producto (no suma). 0 lo quita. */
export function fijar(c: Carrito, productoId: string, cantidad: number): Carrito {
  const { [productoId]: _, ...resto } = c;
  const n = limitar(cantidad);
  return n > 0 ? { ...resto, [productoId]: n } : resto;
}

export function desdeItems(items: readonly ItemCarrito[]): Carrito {
  return items.reduce<Carrito>((c, i) => fijar(c, i.productoId, i.cantidad), {});
}

/** Ítems para `PUT /yo/carrito`, en el orden de la canasta. */
export function aItems(c: Carrito, orden: readonly string[] = []): ItemCarrito[] {
  const ids = [...orden.filter(id => c[id]), ...Object.keys(c).filter(id => !orden.includes(id))];
  return ids.map(productoId => ({ productoId, cantidad: c[productoId] }));
}

export function mismoCarrito(a: Carrito, b: Carrito): boolean {
  const ka = Object.keys(a).filter(k => a[k] > 0);
  const kb = Object.keys(b).filter(k => b[k] > 0);
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
}

// ---------- Precio con mis cambios ----------

export interface VistaProducto {
  precio: number;
  /** Unidades del grupo contando mis cambios sin guardar. */
  unidades: number;
  siguiente: SiguienteTramo | null;
}

/**
 * Precio que verá el grupo si se guarda mi cambio: `delta` = mi cantidad nueva menos la ya guardada.
 * Respeta una oferta del proveedor que dejó el precio bajo el tramo.
 */
export function proyectar(p: ProductoCanasta, delta: number): VistaProducto {
  if (delta === 0 || !p.tramos.length) return { precio: p.precioActual, unidades: p.totalUnidades, siguiente: p.siguienteTramo };
  const unidades = Math.max(0, p.totalUnidades + delta);
  const tramoAntes = precioDelTramo(p.tramos, p.totalUnidades);
  const oferta = p.precioActual < tramoAntes ? p.precioActual : Infinity;
  const precio = Math.min(precioDelTramo(p.tramos, unidades), oferta);
  return { precio, unidades, siguiente: siguienteTramo(p.tramos, unidades, precio) };
}

export interface ResumenCarrito {
  /** Productos distintos en el carrito. */
  productos: number;
  unidades: number;
  total: number;
  /** Contra comprar solo cada producto. */
  ahorro: number;
}

export function resumirCarrito(productos: readonly ProductoCanasta[], c: Carrito, guardado: Carrito = c): ResumenCarrito {
  return productos.reduce<ResumenCarrito>((r, p) => {
    const n = c[p.id] ?? 0;
    if (!n) return r;
    const { precio } = proyectar(p, n - (guardado[p.id] ?? 0));
    return { productos: r.productos + 1, unidades: r.unidades + n, total: r.total + n * precio, ahorro: r.ahorro + n * Math.max(0, p.precioSolo - precio) };
  }, { productos: 0, unidades: 0, total: 0, ahorro: 0 });
}

/** "Faltan 4 cajas" o "Falta 1 rollo". */
export function faltan(siguiente: SiguienteTramo, p: Pick<ProductoCanasta, 'unidad' | 'unidadPlural'>): string {
  return `${siguiente.faltan === 1 ? 'Falta' : 'Faltan'} ${contar(siguiente.faltan, p.unidad, p.unidadPlural)}`;
}

/** "Faltan 4 cajas para bajar a $27.900" o "Falta 1 rollo para bajar a $5.900". */
export function pistaTramo(siguiente: SiguienteTramo | null, p: Pick<ProductoCanasta, 'unidad' | 'unidadPlural'>): string {
  return siguiente ? `${faltan(siguiente, p)} para bajar a ${dinero(siguiente.precioUnitario)}` : '';
}

/** "Una caja", "Un rollo": el género sale del plural de la unidad (cajas, unidades). */
export function una(p: Pick<ProductoCanasta, 'unidad' | 'unidadPlural'>): string {
  return `${/(as|des)$/i.test(p.unidadPlural) ? 'Una' : 'Un'} ${p.unidad}`;
}

/** "2 productos, 7 unidades". */
export function textoCantidades(r: ResumenCarrito): string {
  return `${contar(r.productos, 'producto')}, ${contar(r.unidades, 'unidad')}`;
}

// ---------- Envío diferido ----------

export interface OpcionesEnvio {
  esperaMs?: number;
  /** Carrito ya guardado en el servidor al empezar. */
  inicial: Carrito;
  enviar: (c: Carrito) => Promise<unknown>;
  /** El servidor guardó `c`. */
  alGuardar?: (c: Carrito) => void;
  /** El envío falló: hay que volver a `guardado`. */
  alFallar?: (guardado: Carrito, error: unknown) => void;
  /** Cambia si hay algo sin guardar (esperando o enviando). */
  alCambiarPendiente?: (pendiente: boolean) => void;
}

export interface Envio {
  /** El carrito que quiere la persona; se envía tras `esperaMs` sin más cambios. Los toques seguidos se juntan en un solo envío. */
  cambiar(c: Carrito): void;
  /** El servidor dice que el carrito guardado es `c` (otra pestaña, salir, etc.). Solo aplica si no hay nada pendiente. */
  sincronizar(c: Carrito): boolean;
  pendiente(): boolean;
  guardado(): Carrito;
  /** Descarta lo pendiente y parte de `c` (por ejemplo, tras salir de la compra). Un envío en viaje se ignora. */
  reiniciar(c: Carrito): void;
  cancelar(): void;
}

/**
 * Envía el carrito completo como mucho una vez cada `esperaMs` y nunca dos envíos a la vez: si la persona sigue
 * tocando mientras viaja uno, al volver se manda solo el último estado. Si falla, vuelve a lo último guardado.
 */
export function crearEnvio(o: OpcionesEnvio): Envio {
  const espera = o.esperaMs ?? ESPERA_ENVIO_MS;
  let guardado = o.inicial;
  let deseado = o.inicial;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  let enviando = false;
  let cancelado = false;
  let epoca = 0;
  let pendienteAntes = false;

  const pendiente = () => reloj !== undefined || enviando || !mismoCarrito(deseado, guardado);
  const avisar = () => {
    const p = pendiente();
    if (p !== pendienteAntes) { pendienteAntes = p; o.alCambiarPendiente?.(p); }
  };

  const vaciar = async () => {
    reloj = undefined;
    if (cancelado || enviando) return avisar();
    if (mismoCarrito(deseado, guardado)) return avisar();
    const envio = deseado;
    const miEpoca = epoca;
    enviando = true;
    avisar();
    try {
      await o.enviar(envio);
      if (cancelado || miEpoca !== epoca) return;
      guardado = envio;
      enviando = false;
      o.alGuardar?.(envio);
    } catch (e) {
      if (cancelado || miEpoca !== epoca) return;
      enviando = false;
      // Si después del fallo la persona ya tocó otra cosa, esa intención manda: se reintenta sola.
      if (mismoCarrito(deseado, envio)) {
        deseado = guardado;
        o.alFallar?.(guardado, e);
      }
    }
    if (!mismoCarrito(deseado, guardado) && reloj === undefined) return void vaciar();
    avisar();
  };

  return {
    cambiar(c) {
      deseado = c;
      clearTimeout(reloj);
      reloj = setTimeout(() => void vaciar(), espera);
      avisar();
    },
    sincronizar(c) {
      if (pendiente()) return false;
      guardado = c;
      deseado = c;
      return true;
    },
    pendiente,
    guardado: () => guardado,
    reiniciar(c) {
      epoca += 1;
      clearTimeout(reloj);
      reloj = undefined;
      enviando = false;
      guardado = c;
      deseado = c;
      avisar();
    },
    cancelar() {
      cancelado = true;
      clearTimeout(reloj);
      reloj = undefined;
    },
  };
}
