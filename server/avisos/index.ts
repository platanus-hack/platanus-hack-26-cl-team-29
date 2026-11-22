// Avisos de compra conjunta: cuando abre una compra, un WhatsApp a los compradores registrados que no están en ella.
//   abre la compra (`red.reiniciada` o `licitacion.abierta`) --> un aviso por negocio y por compra, priorizando a quien
//                                                           ya compró esos productos, participó, es de la comuna o del rubro
//   responde SÍ --> el agente lo suma con el flujo de siempre de la sala
//   responde BASTA o "no más avisos" --> no recibe más avisos, nunca (queda guardado aparte de la red)
// "Trae a tu vecino" (invitaciones con código y su atribución) vive en vecinos.ts y comparte estos contactos.
// Solo a quien se registró solo (escribió al bot o entró en la web con su RUT): nunca a teléfonos de facturas,
// locales de OpenStreetMap ni otra fuente. Decisión: docs/decisiones/20261121-1604-avisos-de-compra-abierta.md
import type pg from 'pg';
import { resumenCompraAbierta } from '../../shared/avisos.ts';
import { sinTildes } from '../../shared/texto.ts';
import { configDemo, sinTelefonos } from '../red/index.ts';
import type { Red } from '../red/index.ts';
import type { EventoRed, LicitacionVista, Negocio, TipoEventoRed } from '../red/tipos.ts';
import { crearEnvios, enmascarar } from '../agente/envios.ts';
import type { Log, OpcionesEnvios, WhatsAppDeEnvios } from '../agente/envios.ts';
import { claveDe, contactoVacio, crearAlmacenContactos, ronda } from './almacen.ts';
import type { AlmacenContactos, Contacto } from './almacen.ts';
import { audienciaDelAviso } from './audiencia.ts';
import { crearVecinos } from './vecinos.ts';
import type { InvitacionPublica, InvitacionWeb } from './vecinos.ts';

export { crearAlmacenContactosMemoria, ronda } from './almacen.ts';
export type { AlmacenContactos, Contacto } from './almacen.ts';
export { ofrecerInvitacion, sumoConTuInvitacion } from './vecinos.ts';
export type { InvitacionPublica, InvitacionWeb } from './vecinos.ts';

/** Lo que el agente hace con un mensaje que es para los avisos: responder esto, o sumarlo a la compra con su nombre. */
export type RespuestaAviso = { respuesta: string } | { sumarse: string };

export interface Avisos {
  /** Un mensaje de WhatsApp: BASTA siempre; SÍ solo como respuesta a su último aviso. `null` si no es para los avisos. */
  atender(telefono: string, texto: string): Promise<RespuestaAviso | null>;
  /** Avisa la compra abierta a quien corresponde (idempotente: un aviso por negocio y por compra). */
  avisarCompraAbierta(): Promise<void>;
  /** Su invitación para compartir desde /app. */
  invitacionWeb(negocio: Negocio): Promise<InvitacionWeb | null>;
  /** Entró por la web con `?ref=<código>`: queda invitado por ese negocio (y si ya está en la compra, se cuenta ahora). */
  invitadoWeb(negocio: Negocio, codigo: string): Promise<boolean>;
  /** Quién invitó a quién, solo nombres e ids de negocio (para /red). */
  invitaciones(): InvitacionPublica[];
  /** Espera a que se procesen los eventos de la red recibidos hasta ahora (tests). */
  alDia(): Promise<void>;
  detener(): void;
}

export interface OpcionesAvisos {
  red: Pick<Red, 'escuchar' | 'estadoDeLaRed'>;
  /** De aquí salen el número del bot (DEMO_WHATSAPP_NUMERO) y la URL pública (PUBLIC_URL) de las invitaciones. */
  env?: NodeJS.ProcessEnv;
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
const INVITAR = /^(invitar|invita|invitacion|mi invitacion|trae a tu vecino)\b/;
const SI = /^(si|sii|si quiero|me sumo|sumame|quiero sumarme|dale|ok)\b/;
/** Avisos recordados por contacto: alcanza para no repetir y no crece sin fin. */
const MAX_AVISADAS = 20;

const unir = (a: readonly string[], b: Iterable<string>) => [...new Set([...a, ...b])];

export async function iniciarAvisos(o: OpcionesAvisos): Promise<Avisos> {
  const almacen = o.almacen ?? (await crearAlmacenContactos(o.db ?? null));
  const log = o.log ?? console;
  const reloj = o.reloj ?? (() => new Date());
  const envios = crearEnvios(o.whatsapp, { concurrencia: 5, minimoDifusionMs: 5000, log, ...o.envios });
  const env = o.env ?? process.env;

  /** Cambia un contacto y lo guarda solo si cambió algo. */
  async function actualizar(id: string, cambiar: (c: Contacto) => Contacto): Promise<Contacto> {
    const antes = almacen.buscar(id);
    const despues = cambiar(antes ?? contactoVacio(id));
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

  const vecinos = crearVecinos({
    almacen, actualizar, envios, emitir, log, reloj, negocios: () => o.red.estadoDeLaRed().negocios,
    whatsappNumero: configDemo(env).whatsappNumero, urlPublica: env.PUBLIC_URL || null,
  });

  /** Un negocio que entró a la compra abierta (`licitacion.participante` con `entra`). */
  async function alEntrar(negocioId: unknown, licitacionId: unknown) {
    const { negocios, licitaciones } = o.red.estadoDeLaRed();
    const n = negocios.find(x => x.id === negocioId);
    const l = licitaciones.find(x => x.id === licitacionId && x.estado === 'abierta');
    if (n && l?.participantes.some(p => p.negocioId === n.id)) await vecinos.alSumarse(n, l);
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
    if (await vecinos.llegoConCodigo(id, telefono, texto)) return { sumarse: almacen.buscar(id)?.nombre ?? '' };
    if (INVITAR.test(t)) {
      const invitacion = await vecinos.pedirPorWhatsapp(id, telefono);
      if (invitacion) return { respuesta: invitacion };
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
  /** Una tarea en la fila que devuelve su resultado (o su error) a quien la pidió. */
  const conResultado = <T>(tarea: () => Promise<T>) => new Promise<T>((listo, fallo) => {
    void enFila(() => tarea().then(listo, fallo));
  });
  const dejarDeEscuchar = o.red.escuchar(evento => {
    void enFila(async () => {
      await sincronizar();
      if (evento.tipo === 'red.reiniciada' || evento.tipo === 'licitacion.abierta') await avisarCompraAbierta();
      const datos = evento.datos as { accion?: string; licitacionId?: string; participante?: { negocioId?: string } } | null;
      if (evento.tipo === 'licitacion.participante' && datos?.accion === 'entra') await alEntrar(datos.participante?.negocioId, datos.licitacionId);
    });
  });

  return {
    atender: (telefono, texto) => conResultado(() => atender(telefono, texto)),
    avisarCompraAbierta: () => enFila(async () => { await sincronizar(); await avisarCompraAbierta(); }),
    invitacionWeb: n => conResultado(() => vecinos.paraLaWeb(n)),
    invitadoWeb: (n, codigo) => conResultado(async () => {
      const invitado = await vecinos.invitadoEnLaWeb(n, codigo);
      if (invitado) await alEntrar(n.id, compraAbierta()?.id);
      return invitado;
    }),
    invitaciones: () => vecinos.invitaciones(),
    alDia: () => fila,
    detener() {
      dejarDeEscuchar();
      envios.detener();
    },
  };
}
