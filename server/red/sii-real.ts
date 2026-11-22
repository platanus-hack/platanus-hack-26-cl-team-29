import { nombreEnFrase } from '../../shared/documentos.ts';
import { fechaEnChile } from '../../shared/fecha.ts';
import { contar, segun } from '../../shared/texto.ts';
import { ErrorSii } from '../sii/index.ts';
import type { DocumentoEmitido, DocumentoPreparado, EntradaFactura, EstadoDocumento, EstadoEnvio, Log, Receptor, ResultadoEnvio, Sii } from '../sii/index.ts';
import { foliosLibres } from './folios.ts';
import type { AlmacenFolios, EstadoFolio, RangoFolios, RegistroFolio } from './folios.ts';
import { ErrorRed } from './dominio.ts';
import { guiaDeOrden, itemsSii, ordenCompraSii, receptorDelComprador } from './sii.ts';
import type { CambioEstadoSii, DatosEmision, PuertoSii, ResultadoSii } from './sii.ts';
import type { Negocio, OrdenCompra } from './tipos.ts';

// Adaptador de PuertoSii sobre el módulo SII (server/sii/index.ts), solo certificación, con la empresa que el
// proveedor conectó en el panel (server/conexion-sii). Cada comprador recibe sus documentos a su RUT, con su razón
// social, giro, dirección y comuna del SII (`receptorDelComprador`); un comprador sin RUT verificado no se puede
// facturar en el SII y se rechaza antes de tomar ningún folio. Los nombres de fantasía de la red no viajan al SII.
//
// Folios: se toman de los rangos de los CAF de la conexión (varios por tipo) en el almacén ANTES de armar el
// documento y nunca se reusan. Un envío `incierto` (corte de red) queda marcado así: no se reenvía ni se toma otro
// folio; se revisa con `consultarDocumento` (QueryEstDte). Nada se anula.
//
// Emitir no espera al SII: el documento se arma, se firma y se timbra con el CAF, queda `enviando` y se devuelve al
// instante (con su PDF); la única subida del sobre corre en segundo plano, en orden, y su resultado (recibido,
// rechazado, incierto o fallido) se guarda en cada folio y se avisa a la red. Nada se reintenta solo.

export interface SiiReal extends PuertoSii {
  /**
   * Consulta en el SII (QueryEstDte) un documento ya armado, típicamente uno `incierto`, y guarda la respuesta.
   * Nunca reenvía: si el SII dice FAU (no recibido), queda `no_recibido` para que una persona decida.
   */
  consultarDocumento(tipo: number, folio: number): Promise<{ registro: RegistroFolio; estado: EstadoDocumento }>;
  /** Espera a que terminen las subidas en segundo plano ya encargadas (tests y scripts; la red no la necesita). */
  subidasTerminadas(): Promise<void>;
}

export interface OpcionesSiiReal {
  sii: Sii;
  folios: AlmacenFolios;
  /** Rangos utilizables de los CAF del tipo (desde el primer folio libre conocido de cada uno). */
  rangos: (tipo: number) => readonly RangoFolios[];
  log?: Log;
  /** Consulta en segundo plano el veredicto de cada envío recibido. Por defecto sí; los tests lo apagan. */
  seguirEnvios?: boolean;
}

/** Estados de QueryEstUp en que el SII todavía no termina de procesar el sobre. */
const EN_PROCESO = new Set(['REC', 'SOK', 'CRT', 'FOK', 'PDR', 'PRD', 'LSO']);
/**
 * Espera antes de cada consulta de QueryEstUp: corta al principio, cuando el SII suele terminar (un sobre
 * chico sale `EPR` en ~10 s), y más larga después para no insistir. Un sobre por lote, así que son pocas
 * consultas: unas 6 en el primer medio minuto y luego cada 10 s, hasta ~5 minutos en total.
 */
export const ESPERAS_SEGUIMIENTO_MS: readonly number[] = [2_000, 3_000, 3_000, 4_000, 5_000, 8_000, ...Array<number>(26).fill(10_000)];
/** Con un folio en estos estados no se toma otro para la misma orden y tipo: el documento ya existe o pudo llegar. */
const SIN_NUEVO_FOLIO: readonly EstadoFolio[] = ['reservado', 'enviando', 'incierto', 'recibido', 'aceptado', 'reparo', 'no_recibido', 'no_coincide'];
/** "factura 33", para los logs. */
const nombreConTipo = (tipo: number) => `${nombreEnFrase(tipo)} ${tipo}`;

/** Motivo para la persona cuando no alcanzan los folios de un lote. */
export const faltanFolios = (tipo: number, necesarios: number, libres: number) =>
  `Faltan folios de ${nombreEnFrase(tipo)}: se necesitan ${contar(necesarios, 'folio')} y ${segun(libres, 'queda', 'quedan')} ${libres}. No se envió nada al SII.`;

const detalleDe = (error: unknown) =>
  error instanceof ErrorSii ? `${error.message}\n${error.respuesta}` : String(error instanceof Error ? error.message : error);
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms).unref());

/**
 * Sobres que este proceso está subiendo (por emisor, tipo y folio). Es del proceso, no de cada instancia: una
 * conexión que cambia de versión a mitad de una subida no debe creer que ese folio quedó huérfano.
 */
const enVuelo = new Set<string>();
const claveVuelo = (rutEmisor: string, tipo: number, folio: number) => `${rutEmisor}:${tipo}:${folio}`;

/** Motivo para la persona cuando un comprador no tiene RUT verificado en el SII. */
export const compradorSinRut = (nombre: string) =>
  `${nombre} no tiene su RUT verificado en el SII: su factura no se puede emitir. Pídele su RUT y vuelve a intentarlo. No se envió nada al SII.`;

/**
 * Receptor de cada documento del lote, o falla ANTES de tomar folios si algún comprador no tiene RUT verificado:
 * nunca sale un sobre a medias ni una factura a un receptor inventado.
 */
export function receptoresDe(lista: readonly Pick<DatosEmision, 'receptor'>[]): Receptor[] {
  return lista.map(({ receptor }) => {
    const r = receptorDelComprador(receptor);
    if (!r) throw new ErrorRed('datos_invalidos', compradorSinRut(receptor.nombre));
    return r;
  });
}

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

export function crearSiiReal({ sii, folios, rangos: rangosDe, log = console, seguirEnvios = true }: OpcionesSiiReal): SiiReal {
  // Una emisión a la vez: el folio se toma y se usa en orden, sin dos pedidos peleando por el mismo.
  let cola: Promise<unknown> = Promise.resolve();
  const enCola = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = cola.then(fn);
    cola = r.catch(() => {});
    return r;
  };
  // Las subidas van en su propia fila, una a la vez y en el orden en que se emitieron: la emisión siguiente no
  // espera a que el SII responda la anterior.
  let subidas: Promise<unknown> = Promise.resolve();

  const guardar = (r: RegistroFolio, cambios: Partial<RegistroFolio>) =>
    folios.guardar(Object.assign(r, cambios, { actualizadoEn: new Date().toISOString() }));
  const resultado = (r: RegistroFolio): ResultadoSii =>
    ({ folio: r.folio, trackId: r.trackId, estadoSii: r.estado === 'reservado' ? 'incierto' : r.estado });

  // La red escucha aquí los cambios de estado posteriores a la emisión y actualiza el documento.
  const oyentes = new Set<(cambio: CambioEstadoSii) => void>();
  const avisar = (r: RegistroFolio) => {
    if (r.tipo !== 33 && r.tipo !== 52 && r.tipo !== 61) return;
    const cambio: CambioEstadoSii = {
      tipo: r.tipo, folio: r.folio, ordenId: r.ordenId, estadoSii: resultado(r).estadoSii,
      ...(r.trackId ? { trackId: r.trackId } : {}), ...(r.detalle ? { detalle: r.detalle } : {}),
    };
    for (const oyente of oyentes) {
      try { oyente(cambio); } catch (error) { log.error('[sii] oyente de cambio de estado falló', error); }
    }
  };

  /** Folio que la orden ya tiene para ese tipo y que impide tomar otro (el documento existe o pudo llegar). */
  async function folioVivo(tipo: 33 | 52 | 61, ordenId: string) {
    const previo = (await folios.deOrden(ordenId, tipo)).find(r => SIN_NUEVO_FOLIO.includes(r.estado));
    if (!previo) return undefined;
    // Quedó a medias (un reinicio entre armarlo y saber qué respondió el SII): no se reenvía, queda para revisar.
    if (previo.estado === 'reservado') await guardar(previo, { estado: 'incierto', detalle: 'Reservado sin resultado de subida (reinicio)' });
    if (previo.estado === 'enviando' && !enVuelo.has(claveVuelo(sii.rutEmisor, tipo, previo.folio))) {
      await guardar(previo, { estado: 'incierto', detalle: 'Firmado sin resultado de subida (reinicio)' });
    }
    log.warn(`[sii] ${nombreConTipo(tipo)} de ${ordenId} ya tiene el folio ${previo.folio} (${previo.estado}): no se vuelve a enviar`);
    return previo;
  }

  const entradaFactura = ({ orden }: DatosEmision, folio: number, receptor: Receptor): EntradaFactura =>
    ({ folio, receptor, items: itemsSii(orden.items, i => i.cantidad), ordenCompra: ordenCompraSii(orden) });

  // Cierre de la compra conjunta: las facturas de todas las órdenes en UN sobre y una sola subida.
  // Mismas reglas que una factura suelta, folio por folio: se reservan en orden (consecutivos) antes de
  // armar, una orden con folio vivo no se vuelve a enviar, y el resultado de la subida (recibido,
  // rechazado o incierto) queda en cada folio del lote. Nada se reintenta solo.
  function emitirFacturas(lista: readonly DatosEmision[]) {
    return enCola(async () => {
      const resultados: ResultadoSii[] = new Array(lista.length);
      const nuevos: { posicion: number; datos: DatosEmision; orden: OrdenCompra; receptor: Receptor; registro: RegistroFolio }[] = [];
      const fallar = async (detalle: string) => {
        for (const n of nuevos) await guardar(n.registro, { estado: 'fallido', detalle });
      };
      try {
        const pendientes: { posicion: number; datos: DatosEmision }[] = [];
        for (const [posicion, datos] of lista.entries()) {
          const previo = await folioVivo(33, datos.orden.id);
          if (previo) resultados[posicion] = resultado(previo);
          else pendientes.push({ posicion, datos });
        }
        // Sin receptor válido o sin folios para todo el lote no se reserva ninguno: nunca sale un sobre a medias.
        const receptores = receptoresDe(pendientes.map(p => p.datos));
        const rangos = rangosDe(33);
        const libres = foliosLibres(rangos, await folios.tomados(33));
        if (libres < pendientes.length) throw new ErrorRed('sin_folios', faltanFolios(33, pendientes.length, libres));
        for (const [k, { posicion, datos }] of pendientes.entries()) {
          nuevos.push({ posicion, datos, orden: datos.orden, receptor: receptores[k]!, registro: await folios.reservar(33, rangos, datos.orden.id) });
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

      let preparado: { documentos: readonly DocumentoEmitido[]; subir: () => Promise<ResultadoEnvio> };
      try {
        preparado = await sii.prepararFacturas(nuevos.map(n => entradaFactura(n.datos, n.registro.folio, n.receptor)));
      } catch (error) {
        await fallar(detalleDe(error));
        log.error(`[sii] ${nombre}: falló antes de subir, los folios quedan usados. ${detalleDe(error)}`);
        throw error;
      }
      for (const [k, n] of nuevos.entries()) {
        const d = preparado.documentos[k]!;
        await guardar(n.registro, { ...datosDeConsulta(d), estado: 'enviando' });
        resultados[n.posicion] = { ...resultado(n.registro), impreso: d.impreso };
      }
      log.info(`[sii] ${nombre}: firmado, se sube en segundo plano`);
      subirEnFondo(nombre, nuevos.map(n => n.registro), preparado.subir);
      return resultados;
    });
  }

  const datosDeConsulta = (d: DocumentoEmitido) => ({ fechaEmision: d.fechaEmision, montoTotal: d.montoTotal, rutReceptor: d.rutReceptor });

  /**
   * La única subida de un sobre ya firmado, en la fila de subidas. El resultado queda en cada folio y se avisa a la
   * red: `recibido` (con su track id, y luego el veredicto), `rechazado`, `incierto` (corte de red: se revisa con
   * `consultarDocumento`, nunca se reenvía) o `fallido` (no llegó a subir, por ejemplo sin token). Nada se reintenta.
   */
  function subirEnFondo(nombre: string, registros: RegistroFolio[], subir: () => Promise<ResultadoEnvio>) {
    const claves = registros.map(r => claveVuelo(sii.rutEmisor, r.tipo, r.folio));
    for (const c of claves) enVuelo.add(c);
    const inicio = Date.now();
    const tarea = subidas.then(async () => {
      let envio: ResultadoEnvio | undefined;
      let error: unknown;
      try {
        envio = await subir();
      } catch (e) {
        error = e;
      }
      const cambios: Partial<RegistroFolio> = !envio
        ? { estado: 'fallido', detalle: detalleDe(error) }
        : envio.estado === 'recibido'
          ? { estado: 'recibido', trackId: envio.trackId, detalle: envio.respuesta }
          : envio.estado === 'rechazado'
            ? { estado: 'rechazado', detalle: envio.respuesta }
            : { estado: 'incierto', detalle: envio.error };
      for (const r of registros) {
        await guardar(r, cambios);
        avisar(r);
      }
      const ms = Date.now() - inicio;
      if (!envio) log.error(`[sii] ${nombre}: falló al subir, nada llegó al SII y los folios quedan usados (${ms} ms). ${detalleDe(error)}`);
      else if (envio.estado === 'rechazado') log.error(`[sii] ${nombre}: sobre rechazado (STATUS ${envio.status}, ${ms} ms). Respuesta:\n${envio.respuesta}`);
      else if (envio.estado === 'incierto') log.warn(`[sii] ${nombre}: envío incierto (${ms} ms), no se reenvía; revisar cada folio con consultarDocumento. ${envio.error}`);
      else {
        log.info(`[sii] ${nombre}: recibido en ${ms} ms, track id ${envio.trackId}`);
        if (seguirEnvios) seguir(registros).catch(e => log.error(`[sii] seguimiento del ${nombre} falló`, e));
      }
    }).finally(() => { for (const c of claves) enVuelo.delete(c); });
    subidas = tarea.catch(e => log.error(`[sii] ${nombre}: la subida en segundo plano falló`, e));
  }

  function emitir(tipo: 33 | 52 | 61, datos: DatosEmision, preparar: (folio: number, receptor: Receptor) => Promise<DocumentoPreparado>) {
    const ordenId = datos.orden.id;
    return enCola(async () => {
      const nombre = `${nombreConTipo(tipo)} de ${ordenId}`;
      const previo = await folioVivo(tipo, ordenId);
      if (previo) return resultado(previo);
      // Antes de tomar el folio: sin receptor válido no se arma nada.
      const [paraQuien] = receptoresDe([datos]);
      const registro = await folios.reservar(tipo, rangosDe(tipo), ordenId);
      log.info(`[sii] ${nombre}: folio ${registro.folio} reservado`);
      let preparado: DocumentoPreparado;
      try {
        preparado = await preparar(registro.folio, paraQuien!);
      } catch (error) {
        const detalle = detalleDe(error);
        await guardar(registro, { estado: 'fallido', detalle });
        log.error(`[sii] ${nombre} folio ${registro.folio}: falló antes de subir, el folio queda usado. ${detalle}`);
        throw error;
      }
      await guardar(registro, { ...datosDeConsulta(preparado.documento), estado: 'enviando' });
      log.info(`[sii] ${nombre} folio ${registro.folio}: firmado, se sube en segundo plano`);
      subirEnFondo(`${nombre} folio ${registro.folio}`, [registro], preparado.subir);
      return { ...resultado(registro), impreso: preparado.documento.impreso };
    });
  }

  // Veredicto del envío fuera del pedido HTTP, para uno o varios folios del mismo sobre (mismo track id
  // y tipo). Queda en el almacén y en el log, y se avisa a la red, que emite `documento.actualizado`.
  async function seguir(registros: RegistroFolio[]) {
    const [primero] = registros;
    if (!primero) return;
    const folios = registros.map(r => r.folio).join(', ');
    for (const [i, espera] of ESPERAS_SEGUIMIENTO_MS.entries()) {
      const intento = i + 1;
      await esperar(espera);
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
    log.warn(`[sii] envío ${primero.trackId}: sin veredicto tras ${ESPERAS_SEGUIMIENTO_MS.length} consultas`);
  }

  return {
    subidasTerminadas: async () => { await subidas; },

    alCambiarEstado(oyente) {
      oyentes.add(oyente);
    },

    emitirFactura: datos => emitir(33, datos, (folio, receptor) => sii.prepararFactura(entradaFactura(datos, folio, receptor))),

    emitirFacturas,

    emitirGuia: datos => emitir(52, datos, (folio, receptor) => sii.prepararGuia({
      folio, receptor, ...guiaDeOrden(datos.orden),
    })),

    // La nota de crédito va al mismo receptor que la factura que corrige.
    emitirNotaCredito: datos => emitir(61, datos, async (folio, receptor) => {
      const { factura, items } = datos;
      const registro33 = await folios.buscar(33, factura.folio);
      const fecha = registro33?.fechaEmision ?? fechaEnChile(factura.emitidoEn);
      return sii.prepararNotaCredito({
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
