// Avisos de compra conjunta: cuando abre una compra, un WhatsApp a los compradores registrados que no están en ella.
//   abre la compra (`red.reiniciada` siembra una nueva) --> un aviso por negocio y por compra, priorizando a quien
//                                                           ya compró esos productos, participó, es de la comuna o del rubro
//   responde SÍ --> el agente lo suma con el flujo de siempre de la sala
//   responde BASTA o "no más avisos" --> no recibe más avisos, nunca (queda guardado aparte de la red)
// Solo a quien se registró solo (escribió al bot o entró en la web con su RUT): nunca a teléfonos de facturas,
// locales de OpenStreetMap ni otra fuente. Decisión: docs/decisiones/20261121-1604-avisos-de-compra-abierta.md
import type pg from 'pg';
import { resumenCompraAbierta } from '../../shared/avisos.ts';
import { sinTildes } from '../../shared/texto.ts';
import { sinTelefonos } from '../red/index.ts';
import type { Red } from '../red/index.ts';
import type { EventoRed, LicitacionVista, Negocio, TipoEventoRed } from '../red/tipos.ts';
import { claveTelefono, crearEnvios, enmascarar } from '../agente/envios.ts';
import type { Log, OpcionesEnvios, WhatsAppDeEnvios } from '../agente/envios.ts';
import { crearAlmacenContactos } from './almacen.ts';
import type { AlmacenContactos, Contacto } from './almacen.ts';
import { audienciaDelAviso } from './audiencia.ts';

export { crearAlmacenContactosMemoria } from './almacen.ts';
export type { AlmacenContactos, Contacto } from './almacen.ts';

/** Lo que el agente hace con un mensaje que es para los avisos: responder esto, o sumarlo a la compra con su nombre. */
export type RespuestaAviso = { respuesta: string } | { sumarse: string };

export interface Avisos {
  /** Un mensaje de WhatsApp: BASTA siempre; SÍ solo como respuesta a su último aviso. `null` si no es para los avisos. */
  atender(telefono: string, texto: string): Promise<RespuestaAviso | null>;
  /** Avisa la compra abierta a quien corresponde (idempotente: un aviso por negocio y por compra). */
  avisarCompraAbierta(): Promise<void>;
  /** Espera a que se procesen los eventos de la red recibidos hasta ahora (tests). */
  alDia(): Promise<void>;
  detener(): void;
}

export interface OpcionesAvisos {
  red: Pick<Red, 'escuchar' | 'estadoDeLaRed'>;
  whatsapp: WhatsAppDeEnvios;
  /** Por defecto, Postgres si hay `db` (si no, memoria). */
  almacen?: AlmacenContactos;
  db?: pg.Pool | null;
  /** Para los eventos públicos (`red:evento`); se entregan ya sin datos privados. */
  emitir?: (evento: EventoRed) => void;
  envios?: Partial<OpcionesEnvios>;
  log?: Log;
  reloj?: () => Date;
}

export const SIN_AVISOS = 'Listo, no te enviaremos más avisos de compras conjuntas.';
export const avisoCompraAbierta = (resumen: string, primero: boolean) =>
  `Hay una compra conjunta abierta cerca de ti: ${resumen}. Responde SÍ para sumarte.`
  + (primero ? '\nSi no quieres más avisos, responde BASTA.' : '');

const BASTA = /^(basta|stop|no mas avisos|no quiero (mas )?avisos|sin avisos|no me (avises|envies) mas)\b/;
const SI = /^(si|sii|si quiero|me sumo|sumame|quiero sumarme|dale|ok)\b/;
/** Avisos recordados por contacto: alcanza para no repetir y no crece sin fin. */
const MAX_AVISADAS = 20;

/** Una compra conjunta: su id se repite tras cada reinicio de la demo (`L-1`), su cierre no. */
export const ronda = (l: Pick<LicitacionVista, 'id' | 'cierraEn'>) => `${l.id}@${l.cierraEn}`;

/** Clave del contacto de un negocio: su teléfono o, si entró por la web sin teléfono, su RUT. */
const claveDe = (n: Pick<Negocio, 'telefono' | 'rut'>) =>
  (n.telefono && claveTelefono(n.telefono) ? `tel:${claveTelefono(n.telefono)}` : n.rut ? `rut:${n.rut}` : null);

const vacio = (id: string): Contacto => ({ id, nombre: '', registrado: false, productos: [], rondas: [], avisadas: [] });
const unir = (a: readonly string[], b: Iterable<string>) => [...new Set([...a, ...b])];

export async function iniciarAvisos(o: OpcionesAvisos): Promise<Avisos> {
  const almacen = o.almacen ?? (await crearAlmacenContactos(o.db ?? null));
  const log = o.log ?? console;
  const reloj = o.reloj ?? (() => new Date());
  const envios = crearEnvios(o.whatsapp, { concurrencia: 5, minimoDifusionMs: 5000, log, ...o.envios });

  /** Cambia un contacto y lo guarda solo si cambió algo. */
  async function actualizar(id: string, cambiar: (c: Contacto) => Contacto): Promise<Contacto> {
    const antes = almacen.buscar(id);
    const despues = cambiar(antes ?? vacio(id));
    if (JSON.stringify(antes) !== JSON.stringify(despues)) await almacen.guardar(despues);
    return despues;
  }

  /**
   * Copia de la red lo que sirve para avisar: quién se registró (con su RUT) y qué compró en cada compra conjunta.
   * Corre con cada evento, así sobrevive al reinicio de la demo (que borra los negocios de la red).
   */
  async function sincronizar() {
    const { negocios, licitaciones } = o.red.estadoDeLaRed();
    const porId = new Map(negocios.map(n => [n.id, n]));
    for (const n of negocios) {
      const id = n.rol === 'comprador' && n.rut ? claveDe(n) : null;
      if (!id) continue;
      await actualizar(id, c => ({
        ...c, nombre: n.nombre, registrado: true,
        ...(n.telefono ? { telefono: n.telefono } : {}), ...(n.comuna ? { comuna: n.comuna } : {}), ...(n.rubro ? { rubro: n.rubro } : {}),
      }));
    }
    for (const l of licitaciones) {
      for (const p of l.participantes) {
        const n = p.negocioId ? porId.get(p.negocioId) : undefined;
        const id = n?.rut ? claveDe(n) : null;
        if (!id) continue;
        await actualizar(id, c => ({ ...c, productos: unir(c.productos, p.items.map(i => i.productoId)), rondas: unir(c.rondas, [ronda(l)]) }));
      }
    }
  }

  function compraAbierta(): LicitacionVista | null {
    return o.red.estadoDeLaRed().licitaciones.filter(l => l.estado === 'abierta').at(-1) ?? null;
  }

  async function avisarCompraAbierta() {
    const l = compraAbierta();
    if (!l) return;
    const estaRonda = ronda(l);
    const negocios = new Map(o.red.estadoDeLaRed().negocios.map(n => [n.id, n]));
    const dentro = new Set(l.participantes.flatMap(p => {
      const n = p.negocioId ? negocios.get(p.negocioId) : undefined;
      const id = n ? claveDe(n) : p.telefono ? claveDe({ telefono: p.telefono }) : null;
      return id ? [id] : [];
    }));
    const lista = audienciaDelAviso(almacen.todos(), { ronda: estaRonda, comuna: l.comuna, productos: l.productos.map(p => p.id), dentro });
    if (lista.length === 0) return;
    // Se marca antes de enviar: un segundo llamado (otro evento, otro proceso) ya no los encuentra.
    for (const d of lista) {
      await actualizar(d.contacto.id, c => ({ ...c, avisadas: [...c.avisadas, estaRonda].slice(-MAX_AVISADAS), esperaSi: estaRonda }));
    }
    const principal = l.productos[0]!;
    const resumen = resumenCompraAbierta({ producto: principal.nombre, precio: principal.precioActual, negocios: l.totalNegocios });
    const telefonos = (primero: boolean) => lista.filter(d => (d.contacto.avisadas.length === 0) === primero).map(d => d.contacto.telefono!);
    await Promise.all([
      envios.difundir(telefonos(true), avisoCompraAbierta(resumen, true), 'aviso de compra abierta'),
      envios.difundir(telefonos(false), avisoCompraAbierta(resumen, false), 'aviso de compra abierta'),
    ]);
    const porMotivo = new Map<string, number>();
    for (const d of lista) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
    const motivos = [...porMotivo].map(([m, n]) => `${m} ${n}`).join(', ');
    log.info(`[avisos] ${l.id}: aviso a ${lista.length} negocios (${motivos})`);
    emitir('avisos.enviados', { licitacionId: l.id, negocios: lista.length });
  }

  function emitir(tipo: TipoEventoRed, datos: Record<string, unknown>) {
    o.emitir?.({ tipo, datos: sinTelefonos(datos), en: reloj().toISOString() });
  }

  async function atender(telefono: string, texto: string): Promise<RespuestaAviso | null> {
    const t = sinTildes(texto).replace(/[¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const id = claveDe({ telefono });
    if (!id) return null;
    if (BASTA.test(t)) {
      await actualizar(id, c => ({ ...c, telefono: c.telefono ?? telefono, sinAvisos: c.sinAvisos ?? reloj().toISOString(), esperaSi: undefined }));
      log.info(`[avisos] ${enmascarar(telefono)} no quiere más avisos`);
      return { respuesta: SIN_AVISOS };
    }
    const c = almacen.buscar(id);
    if (!c?.esperaSi) return null;
    // La primera respuesta tras el aviso decide: SÍ lo suma; cualquier otra cosa sigue su curso normal.
    await actualizar(id, x => ({ ...x, esperaSi: undefined }));
    const l = compraAbierta();
    if (!l || ronda(l) !== c.esperaSi || !SI.test(t)) return null;
    log.info(`[avisos] ${enmascarar(telefono)} respondió SÍ al aviso de ${l.id}`);
    return { sumarse: c.nombre };
  }

  // Los eventos se procesan de a uno y en orden: la copia de la red y los avisos nunca se cruzan.
  let fila: Promise<void> = Promise.resolve();
  const enFila = (tarea: () => Promise<void>) => {
    fila = fila.then(tarea).catch(e => log.error('[avisos] falló:', e instanceof Error ? e.message : e));
    return fila;
  };
  const dejarDeEscuchar = o.red.escuchar(evento => {
    void enFila(async () => {
      await sincronizar();
      if (evento.tipo === 'red.reiniciada') await avisarCompraAbierta();
    });
  });

  return {
    atender: (telefono, texto) => new Promise((listo, fallo) => {
      void enFila(() => atender(telefono, texto).then(listo, fallo));
    }),
    avisarCompraAbierta: () => enFila(async () => { await sincronizar(); await avisarCompraAbierta(); }),
    alDia: () => fila,
    detener() {
      dejarDeEscuchar();
      envios.detener();
    },
  };
}
