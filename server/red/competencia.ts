import { precioPorVolumen } from './compra.ts';
import { configDemo } from './config-demo.ts';
import type { Red } from './dominio.ts';
import { COMPETIDORES_SALA, PROVEEDOR_SALA } from './semilla.ts';
import type { EventoRed, LicitacionVista } from './tipos.ts';

// Proveedores que compiten en vivo por la compra conjunta de la sala.
//
// Cada vez que el grupo cruza un tramo empieza una ronda: cada competidor ficticio, tras 1 a 4 s,
// ofrece un poco menos (100 a 300) que el mejor precio del momento, sin bajar de su piso oculto.
// Como sus esperas son distintas, el que llega después responde al anterior. Ante cada oferta rival,
// el agente del proveedor real responde con 100 menos que la mejor rival mientras siga sobre su piso
// (DEMO_PRECIO_PISO). Los pisos rivales están siempre sobre el del real y su nota es mejor: gana y
// factura la empresa real. Todo pasa por `red.ofertar`, así que los eventos son los de siempre.

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

export function iniciarCompetencia(red: Red, { env = process.env, aleatorio = Math.random, esperar = esperarMs }: OpcionesCompetencia = {}): Competencia {
  const pisoReal = configDemo(env).precioPiso;
  const pisos = new Map<string, number>(COMPETIDORES_SALA.map(c => [c.id, pisoReal + c.sobrePiso]));
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

  const abierta = (id: string): LicitacionVista | null => {
    const l = red.licitacionAbierta();
    return l && l.id === id ? (l as LicitacionVista) : null;
  };

  async function pujarRival(licitacionId: string, proveedorId: string) {
    const l = abierta(licitacionId);
    if (!l) return;
    const propia = l.ofertas.find(o => o.proveedorId === proveedorId);
    const otras = l.ofertas.filter(o => o.proveedorId !== proveedorId).map(o => o.precioUnitario);
    const mejor = Math.min(l.precioActual, ...otras);
    if (propia && propia.precioUnitario < mejor) return; // ya va ganando entre los precios
    const precio = Math.max(pisos.get(proveedorId)!, mejor - 100 * entre(1, 3));
    if (precio >= mejor) return; // llegó a su piso
    await red.ofertar(licitacionId, { proveedorId, precioUnitario: precio, plazoDias: PLAZO_DIAS });
    despues(entre(800, 1600), () => responderReal(licitacionId));
  }

  async function responderReal(licitacionId: string) {
    const l = abierta(licitacionId);
    if (!l) return;
    const rivales = l.ofertas.filter(o => pisos.has(o.proveedorId)).map(o => o.precioUnitario);
    if (rivales.length === 0) return;
    const precio = Math.max(pisoReal, Math.min(...rivales) - PASO_REAL);
    if (precio >= l.precioActual) return;
    await red.ofertar(licitacionId, { proveedorId: PROVEEDOR_SALA, precioUnitario: precio, plazoDias: PLAZO_DIAS });
  }

  function alSumarse(l: LicitacionVista) {
    if (l.proveedorId !== PROVEEDOR_SALA || l.estado !== 'abierta') return;
    const tramo = precioPorVolumen(l, l.totalUnidades);
    const anterior = tramoConocido.get(l.id) ?? l.precioSolo;
    tramoConocido.set(l.id, Math.min(anterior, tramo));
    if (tramo >= anterior) return;
    for (const c of COMPETIDORES_SALA) despues(entre(1000, 4000), () => pujarRival(l.id, c.id));
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
