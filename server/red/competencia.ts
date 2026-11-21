import { precioPorVolumen } from '../../shared/precios.ts';
import { configDemo } from './config-demo.ts';
import type { Red } from './dominio.ts';
import { COMPETIDORES_SALA, PROVEEDOR_SALA } from './semilla.ts';
import type { EventoRed, LicitacionVista } from './tipos.ts';

// Proveedores que compiten en vivo por la compra conjunta de la sala, producto por producto de la canasta.
//
// Cada vez que el grupo cruza un tramo de un producto empieza una ronda por ese producto: cada competidor ficticio, tras 1 a 4 s,
// ofrece un poco menos (100 a 300) que el mejor precio del momento, sin bajar de su piso oculto.
// Como sus esperas son distintas, el que llega después responde al anterior. Ante cada oferta rival,
// el agente del proveedor real responde con 100 menos que la mejor rival mientras siga sobre su piso
// de ese producto (DEMO_PRECIO_PISO en rollos; 80 % del primer tramo en los demás, o `piso` en DEMO_PRODUCTOS).
// Los pisos rivales están siempre sobre el del real y su nota es mejor: gana cada producto y factura la empresa
// real. Todo pasa por `red.ofertar` con `productoId`, así que los eventos son los de siempre.

export interface OpcionesCompetencia {
  env?: NodeJS.ProcessEnv;
  /** Entre 0 y 1. Por defecto `Math.random`. */
  aleatorio?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

export interface Competencia {
  /** Se resuelve cuando no queda ninguna oferta pendiente (para tests). */
  enCalma(): Promise<void>;
  detener(): void;
}

/** Cuánto le gana el proveedor real a la mejor oferta rival. */
export const PASO_REAL = 100;
const PLAZO_DIAS = 1;

const esperarMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Pisos ocultos de un producto: el del proveedor real y, por rival, el del real más su `sobrePiso` escalado al
 * precio del producto (en rollos, con DEMO_PRECIO_PISO, es exactamente 400, 700 y 1100 más), redondeado a $10.
 */
export function pisosDeProducto(piso: number, pisoReferencia: number): Map<string, number> {
  return new Map(COMPETIDORES_SALA.map(c => [c.id, piso + Math.max(10, Math.round((c.sobrePiso * piso) / pisoReferencia / 10) * 10)]));
}

export function iniciarCompetencia(red: Red, { env = process.env, aleatorio = Math.random, esperar = esperarMs }: OpcionesCompetencia = {}): Competencia {
  const config = configDemo(env);
  /** Piso del proveedor real por producto; un producto que no está en la configuración usa DEMO_PRECIO_PISO. */
  const pisoReal = (productoId: string) => config.productos.find(p => p.id === productoId)?.piso ?? config.precioPiso;
  const pisosRivales = (productoId: string) => pisosDeProducto(pisoReal(productoId), config.precioPiso);
  const rivales = new Set<string>(COMPETIDORES_SALA.map(c => c.id));
  /** Último tramo conocido por licitación y producto. */
  const tramoConocido = new Map<string, number>();
  const pendientes = new Set<Promise<void>>();
  // Una oferta a la vez: cada agente decide mirando la oferta anterior ya aplicada.
  let turno: Promise<void> = Promise.resolve();
  let generacion = 0;
  let detenida = false;

  const entre = (min: number, max: number) => min + Math.floor(aleatorio() * (max - min + 1));

  /** Corre `fn` tras una espera, salvo que la demo se reinicie o la competencia se detenga entretanto. */
  function despues(ms: number, fn: () => Promise<void>) {
    const g = generacion;
    const tarea = esperar(ms)
      .then(() => (turno = turno.catch(() => {}).then(() => (detenida || g !== generacion ? undefined : fn()))))
      // La compra pudo cerrar mientras tanto: la oferta ya no importa.
      .catch(error => { if (error?.codigo !== 'transicion_invalida') console.error('[competencia] oferta falló', error); })
      .finally(() => { pendientes.delete(tarea); });
    pendientes.add(tarea);
  }

  /** El producto de la compra abierta, con sus derivados, o null si la compra ya no está abierta. */
  const productoAbierto = (licitacionId: string, productoId: string) => {
    const l = red.licitacionAbierta();
    return l && l.id === licitacionId ? (l as LicitacionVista).productos.find(p => p.id === productoId) ?? null : null;
  };

  async function pujarRival(licitacionId: string, productoId: string, proveedorId: string) {
    const p = productoAbierto(licitacionId, productoId);
    if (!p) return;
    const propia = p.ofertas.find(o => o.proveedorId === proveedorId);
    const otras = p.ofertas.filter(o => o.proveedorId !== proveedorId).map(o => o.precioUnitario);
    const mejor = Math.min(p.precioActual, ...otras);
    if (propia && propia.precioUnitario < mejor) return; // ya va ganando entre los precios
    const precio = Math.max(pisosRivales(productoId).get(proveedorId)!, mejor - 100 * entre(1, 3));
    if (precio >= mejor) return; // llegó a su piso
    await red.ofertar(licitacionId, { proveedorId, productoId, precioUnitario: precio, plazoDias: PLAZO_DIAS });
    despues(entre(800, 1600), () => responderReal(licitacionId, productoId));
  }

  async function responderReal(licitacionId: string, productoId: string) {
    const p = productoAbierto(licitacionId, productoId);
    if (!p) return;
    const ofertasRivales = p.ofertas.filter(o => rivales.has(o.proveedorId)).map(o => o.precioUnitario);
    if (ofertasRivales.length === 0) return;
    const precio = Math.max(pisoReal(productoId), Math.min(...ofertasRivales) - PASO_REAL);
    if (precio >= p.precioActual) return;
    await red.ofertar(licitacionId, { proveedorId: PROVEEDOR_SALA, productoId, precioUnitario: precio, plazoDias: PLAZO_DIAS });
  }

  function alSumarse(l: LicitacionVista) {
    if (l.proveedorId !== PROVEEDOR_SALA || l.estado !== 'abierta') return;
    for (const p of l.productos) {
      const clave = `${l.id}:${p.id}`;
      const tramo = precioPorVolumen(p, p.totalUnidades);
      const anterior = tramoConocido.get(clave) ?? p.precioSolo;
      tramoConocido.set(clave, Math.min(anterior, tramo));
      if (tramo >= anterior) continue;
      for (const c of COMPETIDORES_SALA) despues(entre(1000, 4000), () => pujarRival(l.id, p.id, c.id));
    }
  }

  const dejarDeEscuchar = red.escuchar((evento: EventoRed) => {
    if (evento.tipo === 'licitacion.participante') alSumarse((evento.datos as { licitacion: LicitacionVista }).licitacion);
    if (evento.tipo === 'red.reiniciada') {
      generacion++;
      tramoConocido.clear();
    }
  });

  return {
    async enCalma() {
      while (pendientes.size > 0) await Promise.all([...pendientes]);
    },
    detener() {
      detenida = true;
      dejarDeEscuchar();
    },
  };
}
