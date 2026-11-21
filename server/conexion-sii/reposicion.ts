// Reposición automática de folios (CAF) por el portal del SII, siempre a través de la sesión única de
// server/sii-portal (un login por certificado, solicitudes en serie, ritmo de 1 por segundo, espera compartida ante el
// límite de sesiones 720). La política (politica.ts) decide; aquí se ejecuta y se recuerda lo aprendido.
//
// Orden, del rango más nuevo al más viejo (detalle en docs/decisiones, reposición automática de folios):
//   1. Listar los rangos reobtenibles del tipo, sin los ya barridos, los ya guardados ni los vencidos.
//   2. Por cada rango, del más nuevo (folio más alto) al más viejo: preguntar al SII folio por folio (QueryEstDte)
//      si queda alguno libre. El listado mezcla rangos usados, anulados y libres, y dentro de un rango el uso no va en
//      orden: ni el último folio ni una bisección lo dicen. Un rango sin libres se recuerda (`barridos`) y no se vuelve
//      a preguntar: un folio recibido o anulado nunca vuelve a quedar libre. Con libres, se reobtiene (no gasta cupo).
//   3. Solo si ya no quedan rangos por revisar, se piden folios nuevos: lo que falta para el mínimo, nunca más que el
//      tope del SII (MAX_AUTOR).
// Nunca se anula nada: anular es irreversible y pesa seis meses contra el cupo; no hay código para eso.
// Un rechazo deja el tipo en espera (enfriamiento) con el texto del SII: nadie vuelve a intentarlo antes.
import { ErrorRed, faltanFolios } from '../red/index.ts';
import { nombreEnFrase, type TipoDocumento } from '../../shared/documentos.ts';
import { contar, mayuscula, segun } from '../../shared/texto.ts';
import type { AvisoFolios, EstadoFolios, FoliosSii } from '../../shared/conexion-sii.ts';
import { primerDiaVencido } from '../sii/index.ts';
import { ErrorPortal, ESPERA_LIMITE_MS, esErrorPortal, type CertificadoPortal, type CodigoPortal, type RangoFolios } from '../sii-portal/index.ts';
import type { Log } from '../sii/index.ts';
import { decidirReposicion, esperaTrasFallo, minimoDeFolios, POLITICA_FOLIOS } from '../../shared/folios.ts';
import type { PortalConexion } from './portal.ts';
import { buscarPrimerLibre, FolioIlegible, type RespuestaFolio } from './primer-libre.ts';

/** Lo que se recuerda por tipo entre corridas (va en la conexión guardada, sin secretos). */
export interface GestionFolios {
  /** Fallos seguidos desde el último éxito. */
  intentos: number;
  /** No se toca el SII antes de este instante (epoch ms). null: sin espera. */
  esperaHasta: number | null;
  /** Qué pasó en la última corrida, en una línea. */
  detalle: string | null;
  /** Texto literal del SII del último rechazo. */
  mensajeSii: string | null;
  /** Rangos reobtenibles ya revisados sin folios libres (`desde-hasta`): no se vuelven a preguntar. */
  barridos: string[];
  /** Folios conseguidos en la última corrida. */
  repuestos: number;
}

export const GESTION_INICIAL: GestionFolios = { intentos: 0, esperaHasta: null, detalle: null, mensajeSii: null, barridos: [], repuestos: 0 };

/** Lo que la reposición necesita de quien guarda los CAF (la conexión del panel). */
export interface FuenteFolios {
  /** Certificado y RUT de la empresa; null si aún no hay. */
  credenciales(): Promise<{ certificado: CertificadoPortal; rutEmpresa: string } | null>;
  /** Rangos de los CAF guardados del tipo. */
  rangos(tipo: TipoDocumento): Promise<{ desde: number; hasta: number }[]>;
  /** Folios libres en todos los CAF del tipo (descontando los que la red ya tomó). */
  libres(tipo: TipoDocumento): Promise<number>;
  /** Guarda un CAF conseguido en el portal, con el primer folio que se sabe libre (`nuevo`: recién timbrado, todos libres). */
  guardarCaf(xml: string, primerLibre: number | 'nuevo'): Promise<void>;
  gestion(tipo: TipoDocumento): Promise<GestionFolios>;
  guardarGestion(tipo: TipoDocumento, gestion: GestionFolios): Promise<void>;
  /** QueryEstDte de un folio propio. */
  consultarFolio(tipo: TipoDocumento, folio: number): Promise<RespuestaFolio>;
}

export interface OpcionesReposicion {
  fuente: FuenteFolios;
  portal: PortalConexion;
  log?: Log;
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
  /** `AAAA-MM-DD` en Chile, para saltar rangos vencidos. */
  hoy: () => string;
}

export interface Reposicion {
  /** Una corrida para el tipo (si ya hay una, espera esa). `conexion`: el proveedor recién conecta, trae CAF de todo tipo. */
  reponer(tipo: TipoDocumento, opciones?: { demanda?: number; conexion?: boolean }): Promise<FoliosSii>;
  /**
   * Antes de emitir `necesarios` documentos: si no alcanzan, repone primero y espera hasta `plazoMs`. Si aun así no
   * alcanzan, falla con `sin_folios` y el texto del SII, ANTES de reservar ningún folio (nunca sale un lote a medias).
   */
  asegurar(tipo: TipoDocumento, necesarios: number, plazoMs?: number): Promise<void>;
  /** Después de cada emisión: si quedaron bajo el mínimo, repone en segundo plano. */
  enFondo(tipo: TipoDocumento): void;
  estado(tipo: TipoDocumento): Promise<FoliosSii>;
  /** Documentos que se esperan emitir pronto por tipo (por ejemplo, compradores de la compra conjunta abierta). */
  fijarDemanda(demanda: (tipo: TipoDocumento) => number): void;
  escuchar(oyente: (aviso: AvisoFolios) => void): void;
  /** Espera las corridas en curso (tests). */
  esperarCorridas(): Promise<void>;
}

/** Espera máxima antes de facturar una compra cerrada. */
export const PLAZO_ANTES_DE_FACTURAR_MS = 60_000;
/** Un CAF recién timbrado tarda en propagarse en el SII: emitir de inmediato puede dar DTE-3-602. */
export const ESPERA_CAF_NUEVO_MS = 30_000;
/** Presupuesto de una corrida: consultas QueryEstDte, rangos reobtenidos y pasos de decisión. */
const MAX_CONSULTAS = 60;
const MAX_REOBTENCIONES = 10;
const MAX_PASOS = 20;
const RANGOS_POR_LISTADO = 15;

/** Rechazos del SII con texto: esperan más que una falla pasajera (red, página inesperada). */
const RECHAZOS: readonly CodigoPortal[] = ['TIMBRAJE_BLOQUEADO', 'RECHAZO_SII', 'EMPRESA_NO_AUTORIZADA', 'CERTIFICADO_NO_HABILITADO', 'VERIFICACION_DOS_PASOS'];

const claveRango = (r: { desde: number; hasta: number }) => `${r.desde}-${r.hasta}`;
const solapan = (a: { desde: number; hasta: number }, b: { desde: number; hasta: number }) => a.desde <= b.hasta && b.desde <= a.hasta;
const vigente = (r: RangoFolios, hoy: string) => {
  const vence = primerDiaVencido({ tipo: r.tipo, fechaAutorizacion: r.fecha });
  return vence === null || hoy < vence;
};

class SinPresupuesto extends Error {}

/** "Se reobtuvieron 3 folios y se pidieron 2 al SII." */
function resumen(reobtenidos: number, pedidos: number): string {
  const partes = [
    reobtenidos > 0 ? `${segun(reobtenidos, 'se reobtuvo', 'se reobtuvieron')} ${contar(reobtenidos, 'folio')}` : '',
    pedidos > 0 ? `${segun(pedidos, 'se pidió', 'se pidieron')} ${contar(pedidos, 'folio nuevo', 'folios nuevos')} al SII` : '',
  ].filter(Boolean);
  return partes.length ? `${mayuscula(partes.join(' y '))}.` : 'No había folios para reobtener ni pedir.';
}

export function crearReposicion({
  fuente, portal, log = console, ahora = Date.now, esperar = ms => new Promise(r => setTimeout(r, ms).unref()), hoy,
}: OpcionesReposicion): Reposicion {
  const enCurso = new Map<TipoDocumento, Promise<FoliosSii>>();
  const ultimoPedido = new Map<TipoDocumento, number>();
  const oyentes = new Set<(aviso: AvisoFolios) => void>();
  const ultimoAviso = new Map<TipoDocumento, string>();
  let demandaDe: (tipo: TipoDocumento) => number = () => 0;

  async function estado(tipo: TipoDocumento, demanda = demandaDe(tipo)): Promise<FoliosSii> {
    const [libres, g, rangos] = [await fuente.libres(tipo), await fuente.gestion(tipo), await fuente.rangos(tipo)];
    const minimo = minimoDeFolios(tipo, demanda);
    const esperando = g.esperaHasta !== null && g.esperaHasta > ahora();
    const e: EstadoFolios = enCurso.has(tipo) ? 'reponiendo'
      : POLITICA_FOLIOS[tipo].soloConCaf && rangos.length === 0 ? 'sin_caf'
        : libres >= minimo ? 'suficiente'
          : esperando ? 'en_espera' : 'bajo';
    return {
      tipo, libres, minimo, estado: e, repuestos: g.repuestos,
      esperaHasta: esperando ? new Date(g.esperaHasta!).toISOString() : null, detalle: g.detalle, mensajeSii: g.mensajeSii,
    };
  }

  /** Avisa (evento público, sin textos del SII) solo si algo cambió desde el último aviso del tipo. */
  async function avisar(tipo: TipoDocumento) {
    const { libres, minimo, estado: e, repuestos } = await estado(tipo);
    const aviso: AvisoFolios = { tipo, libres, minimo, estado: e, repuestos };
    const huella = JSON.stringify(aviso);
    if (ultimoAviso.get(tipo) === huella) return;
    ultimoAviso.set(tipo, huella);
    for (const o of oyentes) {
      try { o(aviso); } catch (error) { log.error('[folios] oyente falló', error); }
    }
  }

  function conFallo(g: GestionFolios, error: unknown): GestionFolios {
    const intentos = g.intentos + 1;
    const portalError = esErrorPortal(error) ? error : null;
    const esperaHasta = portalError?.codigo === 'LIMITE_SESIONES'
      ? portalError.esperarHasta ?? ahora() + ESPERA_LIMITE_MS
      : ahora() + esperaTrasFallo(portalError && RECHAZOS.includes(portalError.codigo) ? 'rechazo' : 'transitorio', intentos);
    return {
      ...g, intentos, esperaHasta,
      detalle: error instanceof Error ? error.message : String(error),
      mensajeSii: portalError?.mensajeSii ?? null,
    };
  }

  /**
   * Reobtiene rangos del más nuevo al más viejo hasta juntar `faltan` folios. `quedan`: hay rangos que aún no se
   * revisaron (por el tope del listado o porque se acabó el presupuesto de la corrida).
   */
  async function reobtener(
    tipo: TipoDocumento, cred: { certificado: CertificadoPortal; rutEmpresa: string }, g: GestionFolios, faltan: number,
    presupuesto: { consultas: number; reobtenciones: number },
  ): Promise<{ folios: number; quedan: boolean; agotado: boolean }> {
    const guardados = await fuente.rangos(tipo);
    const hoyChile = hoy();
    const incluir = (r: RangoFolios) => !g.barridos.includes(claveRango(r)) && !guardados.some(x => solapan(x, r)) && vigente(r, hoyChile);
    const candidatos = (await portal.reobtenibles(cred.certificado, cred.rutEmpresa, tipo, RANGOS_POR_LISTADO, incluir))
      .sort((a, b) => b.desde - a.desde);
    let folios = 0;
    for (const rango of candidatos) {
      if (folios >= faltan) return { folios, quedan: true, agotado: false };
      if (presupuesto.reobtenciones <= 0) return { folios, quedan: true, agotado: true };
      let primer: number | null;
      try {
        primer = await buscarPrimerLibre({
          desde: rango.desde, hasta: rango.hasta,
          consultar: folio => {
            if (presupuesto.consultas-- <= 0) throw new SinPresupuesto();
            return fuente.consultarFolio(tipo, folio);
          },
        });
      } catch (error) {
        if (error instanceof SinPresupuesto) return { folios, quedan: true, agotado: true };
        if (!(error instanceof FolioIlegible)) throw error;
        // Una respuesta que no dice ni libre ni usado: el rango se salta sin darlo por barrido.
        log.warn(`[folios] tipo ${tipo} rango ${claveRango(rango)}: ${error.message}`);
        continue;
      }
      if (primer === null) {
        g.barridos.push(claveRango(rango));
        log.info(`[folios] tipo ${tipo} rango ${claveRango(rango)} del ${rango.fecha}: sin folios libres en el SII, no se vuelve a revisar`);
        continue;
      }
      let xml: string;
      try {
        xml = await portal.reobtener(cred.certificado, cred.rutEmpresa, rango);
      } catch (error) {
        // El SII avisa en esta página si el rango fue anulado: no sirve y no se vuelve a intentar.
        if (!esErrorPortal(error, 'RECHAZO_SII')) throw error;
        g.barridos.push(claveRango(rango));
        log.warn(`[folios] tipo ${tipo} rango ${claveRango(rango)} no se pudo reobtener: ${error.message} ${error.mensajeSii ?? ''}`);
        continue;
      }
      presupuesto.reobtenciones--;
      await fuente.guardarCaf(xml, primer);
      folios += rango.hasta - primer + 1;
      log.info(`[folios] tipo ${tipo}: reobtenido el rango ${claveRango(rango)} del ${rango.fecha}, libres desde ${primer}`);
    }
    return { folios, quedan: candidatos.length >= RANGOS_POR_LISTADO, agotado: false };
  }

  async function corrida(tipo: TipoDocumento, demanda: number, conexion: boolean): Promise<void> {
    const cred = await fuente.credenciales();
    if (!cred) return;
    const g = structuredClone(await fuente.gestion(tipo));
    const tieneCaf = conexion || (await fuente.rangos(tipo)).length > 0;
    const presupuesto = { consultas: MAX_CONSULTAS, reobtenciones: MAX_REOBTENCIONES };
    let quedan: boolean | null = null;
    let tope: number | null = null;
    let topeLeido = false;
    let reobtenidos = 0;
    let pedidos = 0;
    let actuo = false;
    let final = g;
    try {
      for (let paso = 0; paso < MAX_PASOS; paso++) {
        const d = decidirReposicion({
          tipo, libres: await fuente.libres(tipo), demanda, tieneCaf, esperaHasta: g.esperaHasta, ahora: ahora(), quedanReobtenibles: quedan, tope,
        });
        if (d.accion === 'nada' || d.accion === 'esperar') break;
        if (!actuo) {
          actuo = true;
          log.info(`[folios] tipo ${tipo}: ${await fuente.libres(tipo)} libres, mínimo ${d.minimo}; se reponen`);
          await avisar(tipo);
        }
        if (d.accion === 'reobtener') {
          const r = await reobtener(tipo, cred, g, d.faltan, presupuesto);
          reobtenidos += r.folios;
          quedan = r.quedan;
          if (r.agotado) break;
          continue;
        }
        if (!topeLeido) {
          // Se relee el tope justo antes de pedir: lo cambia cada acción anterior.
          const leido = await portal.tope(cred.certificado, cred.rutEmpresa, tipo);
          tope = leido.maximo;
          topeLeido = true;
          log.info(`[folios] tipo ${tipo}: tope del SII ${leido.maximo ?? 'sin tope'}, disponibles ${leido.disponibles ?? 'sin dato'}`);
          continue;
        }
        if (d.accion === 'sin_cupo') {
          throw new ErrorPortal('TIMBRAJE_BLOQUEADO', `El SII no autoriza folios nuevos de ${nombreEnFrase(tipo)} por ahora (máximo autorizado 0).`, { paso: 'of_confirma_folio' });
        }
        const xml = await portal.pedir(cred.certificado, cred.rutEmpresa, tipo, d.cantidad);
        await fuente.guardarCaf(xml, 'nuevo');
        ultimoPedido.set(tipo, ahora());
        pedidos = d.cantidad;
        log.info(`[folios] tipo ${tipo}: pedidos ${d.cantidad} folios nuevos al SII`);
        break;
      }
      final = actuo
        ? { ...g, intentos: 0, esperaHasta: null, mensajeSii: null, repuestos: reobtenidos + pedidos, detalle: resumen(reobtenidos, pedidos) }
        : { ...g, repuestos: 0 };
    } catch (error) {
      final = conFallo({ ...g, repuestos: reobtenidos + pedidos }, error);
      log.error(`[folios] tipo ${tipo}: la reposición falló, no se reintenta hasta ${new Date(final.esperaHasta!).toISOString()}. ${final.detalle} ${final.mensajeSii ?? ''}`);
    }
    await fuente.guardarGestion(tipo, final);
  }

  function reponer(tipo: TipoDocumento, opciones: { demanda?: number; conexion?: boolean } = {}): Promise<FoliosSii> {
    const previa = enCurso.get(tipo);
    if (previa) return previa;
    const demanda = opciones.demanda ?? demandaDe(tipo);
    const promesa = corrida(tipo, demanda, !!opciones.conexion)
      .catch(error => log.error(`[folios] tipo ${tipo}: corrida falló`, error))
      .then(() => { enCurso.delete(tipo); })
      .then(async () => {
        await avisar(tipo);
        return estado(tipo, demanda);
      });
    enCurso.set(tipo, promesa);
    return promesa;
  }

  return {
    reponer,
    estado: tipo => estado(tipo),

    async asegurar(tipo, necesarios, plazoMs = PLAZO_ANTES_DE_FACTURAR_MS) {
      if ((await fuente.libres(tipo)) >= necesarios) return;
      const limite = ahora() + plazoMs;
      const trabajo = (async () => {
        await enCurso.get(tipo);
        if ((await fuente.libres(tipo)) < necesarios) await reponer(tipo, { demanda: necesarios });
        const pedido = ultimoPedido.get(tipo);
        const propagacion = pedido === undefined ? 0 : pedido + ESPERA_CAF_NUEVO_MS - ahora();
        if (propagacion > 0 && ahora() + propagacion <= limite) await esperar(propagacion);
      })();
      let vencio = false;
      let reloj: ReturnType<typeof setTimeout> | undefined;
      // La corrida sigue en segundo plano si vence el plazo; la factura no espera más.
      await Promise.race([trabajo, new Promise<void>(r => { reloj = setTimeout(() => { vencio = true; r(); }, plazoMs); })]);
      clearTimeout(reloj);
      const libres = await fuente.libres(tipo);
      if (libres >= necesarios) return;
      const e = await estado(tipo, necesarios);
      const porque = e.mensajeSii ? ` El SII dice: «${e.mensajeSii}»`
        : vencio ? ' La reposición sigue en curso: intenta de nuevo en un momento.'
          : e.detalle ? ` ${e.detalle}` : '';
      throw new ErrorRed('sin_folios', `${faltanFolios(tipo, necesarios, libres)}${porque}`);
    },

    enFondo(tipo) {
      void (async () => {
        if (!(await fuente.credenciales())) return;
        await reponer(tipo);
      })().catch(error => log.error(`[folios] tipo ${tipo}: reposición en segundo plano falló`, error));
    },

    fijarDemanda(demanda) {
      demandaDe = demanda;
    },

    escuchar(oyente) {
      oyentes.add(oyente);
    },

    async esperarCorridas() {
      while (enCurso.size > 0) await Promise.all([...enCurso.values()]);
    },
  };
}
