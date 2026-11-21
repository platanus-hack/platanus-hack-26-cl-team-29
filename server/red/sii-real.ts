import { ErrorSii } from '../sii/index.ts';
import type { EntradaFactura, EstadoDocumento, EstadoEnvio, Log, Receptor, ResultadoEmision, ResultadoLote, Sii } from '../sii/index.ts';
import type { AlmacenFolios, EstadoFolio, RangoFolios, RegistroFolio } from './folios.ts';
import type { CambioEstadoSii, DatosEmision, PuertoSii, ResultadoSii } from './sii.ts';
import type { Item, OrdenCompra } from './tipos.ts';

// Adaptador de PuertoSii sobre el módulo SII (server/sii/index.ts), solo certificación.
// Demo: el proveedor de la red es la empresa SII_RUT_EMISOR (configurada en server/sii) y el comprador
// es SII_RUT_RECEPTOR. Los nombres de fantasía de la red no viajan al SII; los datos tributarios salen
// de variables de entorno.
//
// Folios: se toman del rango del CAF en el almacén ANTES de armar el documento y nunca se reusan.
// Un envío `incierto` (corte de red) queda marcado así: no se reenvía ni se toma otro folio; se revisa
// con `consultarDocumento` (QueryEstDte). Nada se anula.

export interface SiiReal extends PuertoSii {
  /**
   * Consulta en el SII (QueryEstDte) un documento ya armado, típicamente uno `incierto`, y guarda la respuesta.
   * Nunca reenvía: si el SII dice FAU (no recibido), queda `no_recibido` para que una persona decida.
   */
  consultarDocumento(tipo: number, folio: number): Promise<{ registro: RegistroFolio; estado: EstadoDocumento }>;
}

export interface OpcionesSiiReal {
  sii: Sii;
  folios: AlmacenFolios;
  env?: NodeJS.ProcessEnv;
  log?: Log;
  /** Consulta en segundo plano el veredicto de cada envío recibido. Por defecto sí; los tests lo apagan. */
  seguirEnvios?: boolean;
}

/** Estados de QueryEstUp en que el SII todavía no termina de procesar el sobre. */
const EN_PROCESO = new Set(['REC', 'SOK', 'CRT', 'FOK', 'PDR', 'PRD', 'LSO']);
const ESPERA_SEGUIMIENTO_MS = 10_000;
const INTENTOS_SEGUIMIENTO = 30;
/** Con un folio en estos estados no se toma otro para la misma orden y tipo: el documento ya existe o pudo llegar. */
const SIN_NUEVO_FOLIO: readonly EstadoFolio[] = ['reservado', 'incierto', 'recibido', 'aceptado', 'reparo', 'no_recibido', 'no_coincide'];
const NOMBRE: Record<number, string> = { 33: 'factura 33', 52: 'guía 52', 61: 'nota de crédito 61' };

const fechaEnChile = (fecha: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(fecha);
const detalleDe = (error: unknown) =>
  error instanceof ErrorSii ? `${error.message}\n${error.respuesta}` : String(error instanceof Error ? error.message : error);
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms).unref());

/**
 * Rango de folios del CAF del tipo (variable `SII_CAF_<tipo>_BASE64`). Solo lee `TD` y `RNG`; server/sii valida el resto al timbrar.
 * `SII_FOLIO_DESDE_<tipo>` adelanta el inicio cuando el CAF ya tiene folios usados fuera de esta app (nunca lo atrasa).
 */
export function rangoDelCaf(env: NodeJS.ProcessEnv, tipo: number): RangoFolios {
  const base64 = env[`SII_CAF_${tipo}_BASE64`];
  if (!base64) throw new Error(`[sii] falta SII_CAF_${tipo}_BASE64 para emitir la ${NOMBRE[tipo] ?? tipo}`);
  const xml = Buffer.from(base64, 'base64').toString('latin1');
  const td = /<TD>\s*(\d+)\s*<\/TD>/.exec(xml)?.[1];
  const rango = /<RNG>\s*<D>\s*(\d+)\s*<\/D>\s*<H>\s*(\d+)\s*<\/H>\s*<\/RNG>/.exec(xml);
  if (Number(td) !== tipo || !rango) throw new Error(`[sii] SII_CAF_${tipo}_BASE64 no es un CAF del tipo ${tipo}`);
  const desde = Math.max(Number(rango[1]), Number(env[`SII_FOLIO_DESDE_${tipo}`]) || 0);
  return { desde, hasta: Number(rango[2]) };
}

/** Receptor de los documentos (el comprador de la demo). */
export function receptorDesdeEnv(env: NodeJS.ProcessEnv): Receptor {
  const nombres = ['SII_RUT_RECEPTOR', 'SII_RECEPTOR_RAZON_SOCIAL', 'SII_RECEPTOR_GIRO', 'SII_RECEPTOR_DIRECCION', 'SII_RECEPTOR_COMUNA'];
  const faltan = nombres.filter(n => !env[n]);
  if (faltan.length > 0) throw new Error(`[sii] faltan variables de entorno del receptor: ${faltan.join(', ')}`);
  return {
    rut: env.SII_RUT_RECEPTOR ?? '',
    razonSocial: env.SII_RECEPTOR_RAZON_SOCIAL ?? '',
    giro: env.SII_RECEPTOR_GIRO ?? '',
    direccion: env.SII_RECEPTOR_DIRECCION ?? '',
    comuna: env.SII_RECEPTOR_COMUNA ?? '',
  };
}

const itemsSii = (items: readonly Item[], cantidad: (i: Item) => number) =>
  items
    .map(i => ({ nombre: i.producto, cantidad: cantidad(i), precioUnitario: i.precioUnitario, unidad: 'UN' }))
    .filter(i => i.cantidad > 0);

const ordenCompra = (o: OrdenCompra) => ({ folio: o.id, fecha: fechaEnChile(new Date(o.creadaEn)) });

/**
 * Veredicto común de los `n` documentos de un tipo en un sobre procesado (QueryEstUp cuenta por tipo).
 * `undefined` si el lote quedó mixto (unos aceptados y otros no): entonces no se sabe cuál es cuál.
 */
export function veredictoDelSobre(estado: EstadoEnvio, tipo: number, n: number): EstadoFolio | undefined {
  const conteo = estado.porTipo.find(c => c.tipo === tipo);
  if (!conteo || conteo.rechazados >= n) return 'rechazado';
  if (conteo.rechazados > 0) return undefined;
  if (conteo.reparos === 0) return 'aceptado';
  return conteo.reparos >= n ? 'reparo' : undefined;
}

export function crearSiiReal({ sii, folios, env = process.env, log = console, seguirEnvios = true }: OpcionesSiiReal): SiiReal {
  const receptor = receptorDesdeEnv(env);
  // Una emisión a la vez: el folio se toma y se usa en orden, sin dos pedidos peleando por el mismo.
  let cola: Promise<unknown> = Promise.resolve();
  const enCola = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = cola.then(fn);
    cola = r.catch(() => {});
    return r;
  };

  const guardar = (r: RegistroFolio, cambios: Partial<RegistroFolio>) =>
    folios.guardar(Object.assign(r, cambios, { actualizadoEn: new Date().toISOString() }));
  const resultado = (r: RegistroFolio): ResultadoSii =>
    ({ folio: r.folio, trackId: r.trackId, estadoSii: r.estado === 'reservado' ? 'incierto' : r.estado });

  // La red escucha aquí los cambios de estado posteriores a la emisión y actualiza el documento.
  const oyentes = new Set<(cambio: CambioEstadoSii) => void>();
  const avisar = (r: RegistroFolio) => {
    if (r.tipo !== 33 && r.tipo !== 52 && r.tipo !== 61) return;
    const cambio: CambioEstadoSii = { tipo: r.tipo, folio: r.folio, estadoSii: resultado(r).estadoSii };
    for (const oyente of oyentes) {
      try { oyente(cambio); } catch (error) { log.error('[sii] oyente de cambio de estado falló', error); }
    }
  };

  /** Folio que la orden ya tiene para ese tipo y que impide tomar otro (el documento existe o pudo llegar). */
  async function folioVivo(tipo: 33 | 52 | 61, ordenId: string) {
    const previo = (await folios.deOrden(ordenId, tipo)).find(r => SIN_NUEVO_FOLIO.includes(r.estado));
    if (!previo) return undefined;
    // Quedó a medias (por ejemplo, un reinicio entre la subida y guardar el documento): no se reenvía.
    if (previo.estado === 'reservado') await guardar(previo, { estado: 'incierto', detalle: 'Reservado sin resultado de subida (reinicio)' });
    log.warn(`[sii] ${NOMBRE[tipo]} de ${ordenId} ya tiene el folio ${previo.folio} (${previo.estado}): no se vuelve a enviar`);
    return previo;
  }

  const entradaFactura = (orden: OrdenCompra, folio: number): EntradaFactura =>
    ({ folio, receptor, items: itemsSii(orden.items, i => i.cantidad), ordenCompra: ordenCompra(orden) });

  // Cierre de la compra conjunta: las facturas de todas las órdenes en UN sobre y una sola subida.
  // Mismas reglas que una factura suelta, folio por folio: se reservan en orden (consecutivos) antes de
  // armar, una orden con folio vivo no se vuelve a enviar, y el resultado de la subida (recibido,
  // rechazado o incierto) queda en cada folio del lote. Nada se reintenta solo.
  function emitirFacturas(lista: readonly DatosEmision[]) {
    return enCola(async () => {
      const resultados: ResultadoSii[] = new Array(lista.length);
      const nuevos: { posicion: number; orden: OrdenCompra; registro: RegistroFolio }[] = [];
      const fallar = async (detalle: string) => {
        for (const n of nuevos) await guardar(n.registro, { estado: 'fallido', detalle });
      };
      try {
        for (const [posicion, { orden }] of lista.entries()) {
          const previo = await folioVivo(33, orden.id);
          if (previo) resultados[posicion] = resultado(previo);
          else nuevos.push({ posicion, orden, registro: await folios.reservar(33, rangoDelCaf(env, 33), orden.id) });
        }
      } catch (error) {
        await fallar(detalleDe(error));
        log.error(`[sii] lote de facturas 33: falló al reservar folios, los ya reservados quedan usados. ${detalleDe(error)}`);
        throw error;
      }
      if (nuevos.length === 0) return resultados;
      const rango = `${nuevos[0]!.registro.folio} a ${nuevos.at(-1)!.registro.folio}`;
      const nombre = `lote de ${nuevos.length} facturas 33 (folios ${rango})`;
      log.info(`[sii] ${nombre}: órdenes ${nuevos.map(n => n.orden.id).join(', ')}`);

      let emision: ResultadoLote;
      try {
        emision = await sii.emitirFacturas(nuevos.map(n => entradaFactura(n.orden, n.registro.folio)));
      } catch (error) {
        await fallar(detalleDe(error));
        log.error(`[sii] ${nombre}: falló antes de subir, los folios quedan usados. ${detalleDe(error)}`);
        throw error;
      }
      const { envio } = emision;
      const estado: EstadoFolio = envio.estado;
      const cambios = envio.estado === 'recibido'
        ? { trackId: envio.trackId, detalle: envio.respuesta }
        : { detalle: envio.estado === 'rechazado' ? envio.respuesta : envio.error };
      for (const [k, n] of nuevos.entries()) {
        const d = emision.documentos[k]!;
        await guardar(n.registro, {
          fechaEmision: d.fechaEmision, montoTotal: d.montoTotal, rutReceptor: d.rutReceptor, estado, ...cambios,
        });
        resultados[n.posicion] = { ...resultado(n.registro), impreso: d.impreso };
      }
      if (envio.estado === 'rechazado') {
        log.error(`[sii] ${nombre}: sobre rechazado (STATUS ${envio.status}). Respuesta:\n${envio.respuesta}`);
        throw new Error(`El SII rechazó el ${nombre} (STATUS ${envio.status})`);
      }
      if (envio.estado === 'incierto') {
        log.warn(`[sii] ${nombre}: envío incierto, no se reenvía; revisar cada folio con consultarDocumento. ${envio.error}`);
        return resultados;
      }
      log.info(`[sii] ${nombre}: recibido, track id ${envio.trackId}`);
      if (seguirEnvios) seguir(nuevos.map(n => n.registro)).catch(error => log.error(`[sii] seguimiento del ${nombre} falló`, error));
      return resultados;
    });
  }

  function emitir(tipo: 33 | 52 | 61, ordenId: string, armar: (folio: number) => Promise<ResultadoEmision>) {
    return enCola(async () => {
      const nombre = `${NOMBRE[tipo]} de ${ordenId}`;
      const previo = await folioVivo(tipo, ordenId);
      if (previo) return resultado(previo);
      const registro = await folios.reservar(tipo, rangoDelCaf(env, tipo), ordenId);
      log.info(`[sii] ${nombre}: folio ${registro.folio} reservado`);
      let emision: ResultadoEmision;
      try {
        emision = await armar(registro.folio);
      } catch (error) {
        const detalle = detalleDe(error);
        await guardar(registro, { estado: 'fallido', detalle });
        log.error(`[sii] ${nombre} folio ${registro.folio}: falló antes de subir, el folio queda usado. ${detalle}`);
        throw error;
      }
      const { documento, envio } = emision;
      const consulta = { fechaEmision: documento.fechaEmision, montoTotal: documento.montoTotal, rutReceptor: documento.rutReceptor };
      if (envio.estado === 'rechazado') {
        await guardar(registro, { ...consulta, estado: 'rechazado', detalle: envio.respuesta });
        log.error(`[sii] ${nombre} folio ${registro.folio}: sobre rechazado (STATUS ${envio.status}). Respuesta:\n${envio.respuesta}`);
        throw new Error(`El SII rechazó la ${nombre} (folio ${registro.folio}, STATUS ${envio.status})`);
      }
      if (envio.estado === 'incierto') {
        await guardar(registro, { ...consulta, estado: 'incierto', detalle: envio.error });
        log.warn(`[sii] ${nombre} folio ${registro.folio}: envío incierto, no se reenvía; revisar con consultarDocumento. ${envio.error}`);
        return { ...resultado(registro), impreso: documento.impreso };
      }
      await guardar(registro, { ...consulta, estado: 'recibido', trackId: envio.trackId, detalle: envio.respuesta });
      log.info(`[sii] ${nombre} folio ${registro.folio}: recibido, track id ${envio.trackId}`);
      if (seguirEnvios) seguir([registro]).catch(error => log.error(`[sii] seguimiento de ${nombre} falló`, error));
      return { ...resultado(registro), impreso: documento.impreso };
    });
  }

  // Veredicto del envío fuera del pedido HTTP, para uno o varios folios del mismo sobre (mismo track id
  // y tipo). Queda en el almacén y en el log, y se avisa a la red, que emite `documento.actualizado`.
  async function seguir(registros: RegistroFolio[]) {
    const [primero] = registros;
    if (!primero) return;
    const folios = registros.map(r => r.folio).join(', ');
    for (let intento = 1; intento <= INTENTOS_SEGUIMIENTO; intento++) {
      await esperar(ESPERA_SEGUIMIENTO_MS);
      const estado = await sii.estadoEnvio(primero.trackId);
      log.info(`[sii] envío ${primero.trackId} (tipo ${primero.tipo} folios ${folios}) intento ${intento}: ${estado.codigo} ${estado.glosa ?? ''}`);
      if (EN_PROCESO.has(estado.codigo) || /^-\d+$/.test(estado.codigo)) continue;
      const veredicto = veredictoDelSobre(estado, primero.tipo, registros.length);
      if (!veredicto) {
        // El SII cuenta por tipo, no por folio: con un lote mixto no se sabe cuál falló. Quedan recibidos.
        log.warn(`[sii] envío ${primero.trackId}: veredicto mixto, revisar cada folio (${folios}) con scripts/sii-folio.ts. Respuesta:\n${estado.respuesta}`);
        return;
      }
      for (const registro of registros) {
        await guardar(registro, { estado: veredicto, detalle: estado.respuesta });
        avisar(registro);
      }
      (veredicto === 'rechazado' ? log.error : log.info)(`[sii] tipo ${primero.tipo} folios ${folios}: ${veredicto}. Respuesta:\n${estado.respuesta}`);
      return;
    }
    log.warn(`[sii] envío ${primero.trackId}: sin veredicto tras ${INTENTOS_SEGUIMIENTO} consultas`);
  }

  return {
    alCambiarEstado(oyente) {
      oyentes.add(oyente);
    },

    emitirFactura: ({ orden }) => emitir(33, orden.id, folio => sii.emitirFactura(entradaFactura(orden, folio))),

    emitirFacturas,

    emitirGuia: ({ orden }) => emitir(52, orden.id, folio => sii.emitirGuia({
      folio, receptor, items: itemsSii(orden.items, i => i.cantidadDespachada ?? i.cantidad),
      motivoTraslado: 1, ordenCompra: ordenCompra(orden),
    })),

    emitirNotaCredito: ({ orden, factura, items }) => emitir(61, orden.id, async folio => {
      const registro33 = await folios.buscar(33, factura.folio);
      const fecha = registro33?.fechaEmision ?? fechaEnChile(new Date(factura.emitidoEn));
      return sii.emitirNotaCredito({
        folio, receptor, items: itemsSii(items, i => i.cantidad), factura: { folio: factura.folio, fecha },
      });
    }),

    // Reclamo por falta parcial (RFP) del comprador sobre la factura. El titular del certificado debe
    // estar autorizado en la empresa receptora. Un rechazo del SII no se lanza: queda como estado.
    async registrarReclamo({ factura, motivo }) {
      const respuesta = await sii.registrarAccionReceptor({ rutEmisor: sii.rutEmisor, tipo: 33, folio: factura.folio }, 'RFP');
      log.info(`[sii] reclamo RFP factura 33 folio ${factura.folio} (${motivo}): ${respuesta.codigo} ${respuesta.descripcion}`);
      const ok = respuesta.resultado === 'ok' || respuesta.resultado === 'ya_registrado';
      return { estadoSii: ok ? 'reclamado' : respuesta.resultado };
    },

    async consultarDocumento(tipo, folio) {
      const registro = await folios.buscar(tipo, folio);
      if (!registro?.fechaEmision || registro.montoTotal === undefined || !registro.rutReceptor) {
        throw new Error(`[sii] el tipo ${tipo} folio ${folio} no se alcanzó a armar: no hay nada que consultar`);
      }
      const estado = await sii.estadoDocumento({
        tipo, folio, fechaEmision: registro.fechaEmision, montoTotal: registro.montoTotal, rutReceptor: registro.rutReceptor,
      });
      const nuevo: Partial<Record<string, EstadoFolio>> = { DOK: 'recibido', FAU: 'no_recibido', DNK: 'no_coincide' };
      const cambio = nuevo[estado.codigo];
      // Un DOK no pisa un veredicto ya conocido (aceptado, reparo, rechazado).
      const mantener = cambio === 'recibido' && ['aceptado', 'reparo', 'rechazado'].includes(registro.estado);
      const anterior = registro.estado;
      await guardar(registro, { ...(cambio && !mantener ? { estado: cambio } : {}), detalle: estado.respuesta });
      if (registro.estado !== anterior) avisar(registro);
      log.info(`[sii] QueryEstDte tipo ${tipo} folio ${folio}: ${estado.codigo} ${estado.glosa ?? ''} ${estado.glosaError ?? ''}`);
      return { registro, estado };
    },
  };
}
