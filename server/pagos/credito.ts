// Libro del crédito Bando: por cada factura de una compra, Bando le paga al proveedor al instante y le abre al comprador
// un crédito a su plazo; al vencer lo cobra en su tarjeta inscrita. Tarjetas y créditos van por RUT: sobreviven a un
// reinicio de la demo (que cambia los ids de los negocios) y la confianza se acumula entre rondas.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { lineaDeCredito, vencimiento, type HistorialCredito, type LineaCredito } from '../../shared/credito.ts';
import type { PasarelaTarjetas, TarjetaInscrita } from './oneclick.ts';

export interface Tarjeta extends TarjetaInscrita {
  id: string;
  /** El usuario con que se inscribió en Transbank (hay que repetirlo al cobrar). */
  usuario: string;
  en: string;
}

export interface Credito {
  id: string;
  rut: string;
  negocioId: string;
  proveedorId: string;
  ordenId: string;
  documentoId: string;
  /** Total de la factura (neto + IVA): lo que Bando le paga al proveedor y lo que cobra al comprador. */
  monto: number;
  otorgadoEn: string;
  plazoDias: number;
  /** `AAAA-MM-DD`. */
  venceEn: string;
  /** Bando le pagó al proveedor (al otorgar el crédito). */
  pagadoAlProveedorEn: string;
  estado: 'vigente' | 'pagado' | 'atrasado';
  cobro?: { en: string; autorizacion: string };
  ultimoError?: { en: string; mensaje: string };
}

/** Una tabla jsonb por colección (Postgres) o un Map (sin base). */
export interface Tabla<T extends { id: string }> {
  todos(): Promise<T[]>;
  guardar(x: T): Promise<void>;
}

export function tablaMemoria<T extends { id: string }>(): Tabla<T> {
  const m = new Map<string, T>();
  return { todos: async () => [...m.values()], guardar: async x => void m.set(x.id, structuredClone(x)) };
}

export async function tablaPostgres<T extends { id: string }>(db: pg.Pool, nombre: 'pagos_tarjetas' | 'pagos_creditos'): Promise<Tabla<T>> {
  await db.query(`create table if not exists ${nombre} (n bigserial, id text primary key, datos jsonb not null)`);
  return {
    todos: async () => (await db.query<{ datos: T }>(`select datos from ${nombre} order by n`)).rows.map(r => r.datos),
    guardar: async x => void await db.query(
      `insert into ${nombre} (id, datos) values ($1, $2) on conflict (id) do update set datos = excluded.datos`, [x.id, JSON.stringify(x)],
    ),
  };
}

/** Pagado a tiempo: cobrado hasta el día del vencimiento. */
const aTiempo = (c: Credito) => c.estado === 'pagado' && !!c.cobro && c.cobro.en.slice(0, 10) <= c.venceEn;

export function historialDe(creditos: readonly Credito[]): HistorialCredito {
  return {
    pagadosATiempo: creditos.filter(aTiempo).length,
    atrasados: creditos.filter(c => c.estado === 'atrasado' || (c.estado === 'pagado' && !aTiempo(c))).length,
  };
}

export interface NuevoCredito {
  rut: string;
  negocioId: string;
  proveedorId: string;
  ordenId: string;
  documentoId: string;
  monto: number;
}

export type AvisoCredito =
  | { tipo: 'credito.otorgado'; credito: Credito }
  | { tipo: 'credito.cobrado'; credito: Credito; ok: boolean }
  | { tipo: 'tarjeta.inscrita'; rut: string; tarjeta: Tarjeta };

export interface ResumenComprador {
  linea: LineaCredito;
  deuda: number;
  disponible: number;
  tarjeta: { marca: string; ultimos4: string } | null;
  creditos: Credito[];
}

export async function crearLibro(o: {
  tarjetas: Tabla<Tarjeta>;
  creditos: Tabla<Credito>;
  pasarela: PasarelaTarjetas;
  avisar: (a: AvisoCredito) => void;
  ahora?: () => Date;
}) {
  const ahora = () => (o.ahora?.() ?? new Date()).toISOString();
  // La tarjeta vigente es la última inscrita del RUT (id = RUT).
  const tarjetas = new Map((await o.tarjetas.todos()).map(t => [t.id, t]));
  const creditos = await o.creditos.todos();
  const delRut = (rut: string) => creditos.filter(c => c.rut === rut);
  const deuda = (rut: string) => delRut(rut).filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0);

  async function guardar(c: Credito) {
    await o.creditos.guardar(c);
  }

  function resumen(rut: string): ResumenComprador {
    const linea = lineaDeCredito(historialDe(delRut(rut)));
    const t = tarjetas.get(rut);
    const d = deuda(rut);
    return {
      linea, deuda: d, disponible: Math.max(0, linea.cupo - d), tarjeta: t ? { marca: t.marca, ultimos4: t.ultimos4 } : null,
      creditos: delRut(rut).sort((a, b) => b.otorgadoEn.localeCompare(a.otorgadoEn)),
    };
  }

  /**
   * Factura emitida → Bando le paga al proveedor y le abre el crédito al comprador. Si la factura no cabe en lo que le
   * queda de cupo, vence hoy (se cobra en la próxima pasada). Una factura abre un solo crédito.
   */
  async function otorgar(n: NuevoCredito): Promise<Credito | null> {
    if (creditos.some(c => c.documentoId === n.documentoId)) return null;
    const { linea, disponible } = resumen(n.rut);
    const plazoDias = n.monto <= disponible ? linea.plazoDias : 0;
    const en = ahora();
    const c: Credito = { id: randomUUID(), ...n, otorgadoEn: en, plazoDias, venceEn: vencimiento(en, plazoDias), pagadoAlProveedorEn: en, estado: 'vigente' };
    creditos.push(c);
    await guardar(c);
    o.avisar({ tipo: 'credito.otorgado', credito: c });
    return c;
  }

  async function cobrarUno(c: Credito): Promise<boolean> {
    const t = tarjetas.get(c.rut);
    const en = ahora();
    try {
      if (!t) throw new Error('Sin tarjeta inscrita');
      const autorizacion = await o.pasarela.cobrar({ usuario: t.usuario, tbkUser: t.tbkUser, ordenCompra: c.id.replace(/-/g, '').slice(0, 26), monto: c.monto });
      Object.assign(c, { estado: 'pagado', cobro: { en, autorizacion } });
      delete c.ultimoError;
    } catch (error) {
      c.ultimoError = { en, mensaje: error instanceof Error ? error.message : String(error) };
      if (en.slice(0, 10) > c.venceEn) c.estado = 'atrasado';
    }
    await guardar(c);
    o.avisar({ tipo: 'credito.cobrado', credito: c, ok: c.estado === 'pagado' });
    return c.estado === 'pagado';
  }

  /**
   * Cobra lo vencido (o, con `todo`, todo lo pendiente: el presentador adelanta el tiempo en la demo).
   * Un cobro fallido se reintenta al día siguiente, no en cada pasada.
   */
  async function cobrarVencidos(todo = false): Promise<{ cobrados: number; fallidos: number }> {
    const hoy = ahora().slice(0, 10);
    const pendientes = creditos.filter(c => c.estado !== 'pagado' && (todo || c.venceEn <= hoy) && (todo || c.ultimoError?.en.slice(0, 10) !== hoy));
    let cobrados = 0;
    for (const c of pendientes) if (await cobrarUno(c)) cobrados++;
    return { cobrados, fallidos: pendientes.length - cobrados };
  }

  /** Inscripciones abiertas: token de Transbank → RUT y usuario. */
  const inscribiendo = new Map<string, { rut: string; usuario: string }>();

  return {
    resumen,
    otorgar,
    cobrarVencidos,
    async iniciarInscripcion(rut: string, volverA: string) {
      const usuario = `bando-${rut.replace(/\W/g, '')}`;
      const r = await o.pasarela.iniciarInscripcion({ usuario, email: `${usuario}@bando.cl`, volverA });
      inscribiendo.set(r.token, { rut, usuario });
      return r;
    },
    /** Vuelta de Transbank. Devuelve si quedó inscrita. */
    async terminarInscripcion(token: string): Promise<boolean> {
      const quien = inscribiendo.get(token);
      if (!quien) return false;
      inscribiendo.delete(token);
      const inscrita = await o.pasarela.terminarInscripcion(token);
      if (!inscrita) return false;
      const t: Tarjeta = { id: quien.rut, usuario: quien.usuario, ...inscrita, en: ahora() };
      tarjetas.set(quien.rut, t);
      await o.tarjetas.guardar(t);
      o.avisar({ tipo: 'tarjeta.inscrita', rut: quien.rut, tarjeta: t });
      return true;
    },
    /** Para la pantalla de la sala: totales de los negocios dados (los de la ronda actual), sin nombres ni RUT. */
    totales(negocioIds: ReadonlySet<string>) {
      const deLaRonda = creditos.filter(c => negocioIds.has(c.negocioId));
      return {
        pagadoAProveedores: deLaRonda.reduce((s, c) => s + c.monto, 0),
        creditos: deLaRonda.length,
        porCobrar: deLaRonda.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0),
        cobrado: deLaRonda.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
      };
    },
  };
}

export type Libro = Awaited<ReturnType<typeof crearLibro>>;
