import { ErrorSii } from '../sii/index.ts';
import type { EstadoDocumento, Log, Receptor, ResultadoEmision, Sii } from '../sii/index.ts';
import type { AlmacenFolios, EstadoFolio, RangoFolios, RegistroFolio } from './folios.ts';
import type { PuertoSii, ResultadoSii } from './sii.ts';
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
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms).unref());

/** Rango de folios del CAF del tipo (variable `SII_CAF_<tipo>_BASE64`). Solo lee `TD` y `RNG`; server/sii valida el resto al timbrar. */
export function rangoDelCaf(env: NodeJS.ProcessEnv, tipo: number): RangoFolios {
  const base64 = env[`SII_CAF_${tipo}_BASE64`];
  if (!base64) throw new Error(`[sii] falta SII_CAF_${tipo}_BASE64 para emitir la ${NOMBRE[tipo] ?? tipo}`);
  const xml = Buffer.from(base64, 'base64').toString('latin1');
  const td = /<TD>\s*(\d+)\s*<\/TD>/.exec(xml)?.[1];
  const rango = /<RNG>\s*<D>\s*(\d+)\s*<\/D>\s*<H>\s*(\d+)\s*<\/H>\s*<\/RNG>/.exec(xml);
  if (Number(td) !== tipo || !rango) throw new Error(`[sii] SII_CAF_${tipo}_BASE64 no es un CAF del tipo ${tipo}`);
  return { desde: Number(rango[1]), hasta: Number(rango[2]) };
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

  function emitir(tipo: 33 | 52 | 61, ordenId: string, armar: (folio: number) => Promise<ResultadoEmision>) {
    return enCola(async () => {
      const nombre = `${NOMBRE[tipo]} de ${ordenId}`;
      const previo = (await folios.deOrden(ordenId, tipo)).find(r => SIN_NUEVO_FOLIO.includes(r.estado));
      if (previo) {
        // Quedó a medias (por ejemplo, un reinicio entre la subida y guardar el documento): no se reenvía.
        if (previo.estado === 'reservado') await guardar(previo, { estado: 'incierto', detalle: 'Reservado sin resultado de subida (reinicio)' });
        log.warn(`[sii] ${nombre} ya tiene el folio ${previo.folio} (${previo.estado}): no se vuelve a enviar`);
        return resultado(previo);
      }
      const registro = await folios.reservar(tipo, rangoDelCaf(env, tipo), ordenId);
      log.info(`[sii] ${nombre}: folio ${registro.folio} reservado`);
      let emision: ResultadoEmision;
      try {
        emision = await armar(registro.folio);
      } catch (error) {
        const detalle = error instanceof ErrorSii ? `${error.message}\n${error.respuesta}` : String(error instanceof Error ? error.message : error);
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
        return resultado(registro);
      }
      await guardar(registro, { ...consulta, estado: 'recibido', trackId: envio.trackId, detalle: envio.respuesta });
      log.info(`[sii] ${nombre} folio ${registro.folio}: recibido, track id ${envio.trackId}`);
      if (seguirEnvios) seguir(registro).catch(error => log.error(`[sii] seguimiento de ${nombre} falló`, error));
      return resultado(registro);
    });
  }

  // Veredicto del envío fuera del pedido HTTP. Queda en el almacén y en el log; la red no tiene
  // un evento para cambiar el estado de un documento ya emitido, así que la pantalla sigue viendo `recibido`.
  async function seguir(registro: RegistroFolio) {
    for (let intento = 1; intento <= INTENTOS_SEGUIMIENTO; intento++) {
      await esperar(ESPERA_SEGUIMIENTO_MS);
      const estado = await sii.estadoEnvio(registro.trackId);
      log.info(`[sii] envío ${registro.trackId} (tipo ${registro.tipo} folio ${registro.folio}) intento ${intento}: ${estado.codigo} ${estado.glosa ?? ''}`);
      if (EN_PROCESO.has(estado.codigo) || /^-\d+$/.test(estado.codigo)) continue;
      const conteo = estado.porTipo.find(c => c.tipo === registro.tipo);
      const veredicto: EstadoFolio = conteo?.aceptados ? 'aceptado' : conteo?.reparos ? 'reparo' : 'rechazado';
      await guardar(registro, { estado: veredicto, detalle: estado.respuesta });
      (veredicto === 'rechazado' ? log.error : log.info)(`[sii] tipo ${registro.tipo} folio ${registro.folio}: ${veredicto}. Respuesta:\n${estado.respuesta}`);
      return;
    }
    log.warn(`[sii] envío ${registro.trackId}: sin veredicto tras ${INTENTOS_SEGUIMIENTO} consultas`);
  }

  return {
    emitirFactura: ({ orden }) => emitir(33, orden.id, folio => sii.emitirFactura({
      folio, receptor, items: itemsSii(orden.items, i => i.cantidad), ordenCompra: ordenCompra(orden),
    })),

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
      await guardar(registro, { ...(cambio && !mantener ? { estado: cambio } : {}), detalle: estado.respuesta });
      log.info(`[sii] QueryEstDte tipo ${tipo} folio ${folio}: ${estado.codigo} ${estado.glosa ?? ''} ${estado.glosaError ?? ''}`);
      return { registro, estado };
    },
  };
}
