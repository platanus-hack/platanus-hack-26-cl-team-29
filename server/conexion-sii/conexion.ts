// "Conectar mi SII": el proveedor sube su certificado y el RUT de su empresa; el servidor obtiene solo, por el portal
// del SII, los datos de la empresa, la resolución y los CAF (reobteniendo primero, pidiendo solo si no hay, nunca
// anulando), y después mantiene los folios repuestos (reposicion.ts). Lo que el SII no entrega se puede escribir o subir a mano. Con eso la red emite en el SII de
// certificación sin variables de entorno. Los secretos se guardan cifrados (cifrado.ts) y nunca salen en una
// respuesta, un evento ni el log.
import type { CafSii, EmpresaSii, EstadoConexionSii, FichaSii, FoliosSii, IdPasoSii, PasoSii } from '../../shared/conexion-sii.ts';
import { nombreEnFrase, TIPOS_DOCUMENTO, type TipoDocumento } from '../../shared/documentos.ts';
import { fechaEnChile } from '../../shared/fecha.ts';
import { contar } from '../../shared/texto.ts';
import { normalizarRut } from '../../shared/rut.ts';
import { abrirCertificado, leerCaf, primerDiaVencido } from '../sii/index.ts';
import type { ConfigSii, ConsultaDocumento, EstadoDocumento, Log } from '../sii/index.ts';
import type { AlmacenConexion, CafGuardado, ConexionGuardada } from './almacen.ts';
import { cifrar, descifrar, llaveDesdeEnv } from './cifrado.ts';
import { esErrorPortal } from '../sii-portal/index.ts';
import { siguienteEnRango, type RangoFolios } from '../red/index.ts';
import { demandaManual } from '../../shared/folios.ts';
import type { PortalConexion } from './portal.ts';
import { buscarPrimerLibre, type RespuestaFolio } from './primer-libre.ts';
import { crearReposicion, GESTION_INICIAL, type FuenteFolios, type Reposicion } from './reposicion.ts';

export class ErrorConexion extends Error {
  readonly status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConexion';
    this.status = status;
  }
}

export type CrearConsulta = (pfx: Buffer, clave: string, rutEmisor: string) => (c: ConsultaDocumento) => Promise<EstadoDocumento>;

export interface OpcionesConexion {
  almacen: AlmacenConexion;
  env?: NodeJS.ProcessEnv;
  log?: Log;
  portal: PortalConexion;
  /** La sesión del portal sobrevive a reinicios. */
  sesionPersistente?: boolean;
  crearConsulta: CrearConsulta;
  /** Folios que la red ya tomó del tipo (almacén de folios), para no contarlos como libres. */
  tomados?: (tipo: number) => Promise<number[]>;
  /** `AAAA-MM-DD` en Chile. */
  hoy?: () => string;
}

export interface ConexionSii {
  estado(): Promise<EstadoConexionSii>;
  /** Guarda el certificado y, con el RUT de la empresa (o el del titular), parte la conexión automática. */
  subirCertificado(pfxBase64: unknown, clave: unknown, rutEmisor?: unknown): Promise<EstadoConexionSii>;
  /** Vuelve a correr la conexión automática (por ejemplo, tras el límite de sesiones o un bloqueo). */
  conectarAutomatico(rutEmisor?: unknown): Promise<EstadoConexionSii>;
  consultarEmpresa(rutEmisor: unknown): Promise<FichaSii>;
  guardarEmpresa(datos: Record<string, unknown>): Promise<EstadoConexionSii>;
  subirCaf(xmlBase64: unknown): Promise<{ estado: EstadoConexionSii; avisos: string[] }>;
  fijarFolio(tipo: unknown, folio: unknown): Promise<EstadoConexionSii>;
  /** "Traer más folios" del panel: la misma reposición automática, en segundo plano (avisa con `sii.folios`). */
  traerFolios(tipo: unknown): Promise<EstadoConexionSii>;
  /** Reposición automática de folios de esta conexión (antes de facturar, después de emitir). */
  readonly folios: Reposicion;
  desconectar(): Promise<EstadoConexionSii>;
  /** Lo que la red necesita para emitir con esta conexión; `null` si está incompleta (entonces la red usa el SII falso). */
  configuracion(): Promise<ConfiguracionEmision | null>;
  /** Cambia cada vez que cambia algo que afecta la emisión. */
  version(): number;
  /**
   * El SII rechazó la carátula de un envío (RCT). Con la resolución equivocada todo envío vuelve RCT: la conexión deja
   * de emitir hasta que el proveedor la corrija. Los folios de un envío RCT quedan libres en el SII.
   */
  marcarRechazoCaratula(): Promise<void>;
  /** Espera a que terminen la conexión automática, las búsquedas de folio y las reposiciones en curso (tests). */
  esperarBusquedas(): Promise<void>;
}

/** Configuración del SII real de la red: la de server/sii y los rangos de folios utilizables por tipo. */
export interface ConfiguracionEmision {
  sii: ConfigSii;
  /** Desde el primer folio libre conocido de cada CAF: la red nunca toma uno anterior. */
  rangos: Partial<Record<TipoDocumento, RangoFolios[]>>;
}

/** Un .pfx real pesa entre 3 y 10 KB; con holgura para cadenas largas. */
const MAX_PFX_BASE64 = 40_000;
const MAX_CAF_BASE64 = 20_000;
const SEIS_MESES_MS = 182 * 86_400_000;

const hoyEnChile = () => fechaEnChile(new Date());
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const base64Valido = (v: string) => /^[A-Za-z0-9+/]+={0,2}$/.test(v.replace(/\s+/g, ''));

function rutValido(v: unknown): string {
  try {
    return normalizarRut(texto(v));
  } catch {
    throw new ErrorConexion(400, 'El RUT de la empresa no es válido. Escríbelo con guion y dígito verificador, por ejemplo 76123456-7.');
  }
}

function campo(datos: Record<string, unknown>, nombre: string, etiqueta: string, max: number, obligatorio = true): string {
  const v = texto(datos[nombre]);
  if (obligatorio && !v) throw new ErrorConexion(400, `Falta ${etiqueta}.`);
  if (v.length > max) throw new ErrorConexion(400, `${etiqueta[0]!.toUpperCase()}${etiqueta.slice(1)} admite hasta ${max} caracteres.`);
  return v;
}

const PASOS: IdPasoSii[] = ['empresa', 'resolucion', 'caf_33', 'caf_52', 'caf_61'];

/** Una conexión guardada antes de admitir varios CAF por tipo traía uno solo por tipo: se lee como lista. */
function normalizar(c: ConexionGuardada | null): ConexionGuardada | null {
  if (!c) return null;
  for (const tipo of TIPOS_DOCUMENTO) {
    const v: unknown = c.cafs[tipo];
    if (v && !Array.isArray(v)) c.cafs[tipo] = [v as CafGuardado];
  }
  return c;
}

export function crearConexionSii({
  almacen, env = process.env, log = console, portal, sesionPersistente = false, crearConsulta, tomados = async () => [], hoy = hoyEnChile,
}: OpcionesConexion): ConexionSii {
  let automatico: { activo: boolean; pasos: PasoSii[]; promesa: Promise<void> } | null = null;
  let version = 0;
  /** Búsquedas del primer folio libre, por CAF (`tipo:desde`). */
  const busquedas = new Map<string, { generacion: number; revisados: number; folio: number; total: number; error: string | null; activa: boolean; promesa: Promise<void> }>();
  let generacion = 0;

  /** Otra empresa: ni sus CAF ni lo aprendido de sus folios (espera, rangos barridos) sirven. */
  const olvidarFolios = (c: ConexionGuardada) => {
    c.cafs = {};
    delete c.folios;
    busquedas.clear();
  };

  const llave = () => {
    try {
      return llaveDesdeEnv(env);
    } catch (error) {
      throw new ErrorConexion(503, (error as Error).message);
    }
  };
  const puedeGuardar = () => {
    try { llaveDesdeEnv(env); return true; } catch { return false; }
  };

  const leer = async (): Promise<ConexionGuardada> => normalizar(await almacen.leer()) ?? { cafs: {}, actualizadoEn: new Date().toISOString() };
  const cafsDe = (c: ConexionGuardada, tipo: TipoDocumento): CafGuardado[] => c.cafs[tipo] ?? [];
  const claveBusqueda = (tipo: TipoDocumento, caf: { desde: number }) => `${tipo}:${caf.desde}`;
  /** Primer folio que la red puede tomar del CAF (null si aún no se sabe) y cuántos le quedan. */
  const usoDe = (caf: CafGuardado, tomadosDelTipo: readonly number[]) => {
    if (caf.primerLibre === undefined) return { siguiente: null, libres: null };
    const siguiente = siguienteEnRango({ desde: caf.primerLibre, hasta: caf.hasta }, tomadosDelTipo);
    return { siguiente, libres: siguiente === null ? 0 : caf.hasta - siguiente + 1 };
  };
  const guardar = async (c: ConexionGuardada) => {
    c.actualizadoEn = new Date().toISOString();
    await almacen.guardar(c);
    version++;
  };

  function certificadoDe(c: ConexionGuardada): { pfx: Buffer; clave: string } {
    if (!c.certificado) throw new ErrorConexion(409, 'Primero sube tu certificado digital.');
    const { pfxBase64, clave } = JSON.parse(descifrar(llave(), c.certificado.cifrado)) as { pfxBase64: string; clave: string };
    return { pfx: Buffer.from(pfxBase64, 'base64'), clave };
  }

  async function estado(): Promise<EstadoConexionSii> {
    const c = await leer();
    const cafs: CafSii[] = [];
    for (const tipo of TIPOS_DOCUMENTO) {
      const usados = await tomados(tipo);
      for (const g of cafsDe(c, tipo)) {
        const b = busquedas.get(claveBusqueda(tipo, g));
        cafs.push({
          tipo, desde: g.desde, hasta: g.hasta, fa: g.fa, primerLibre: g.primerLibre ?? null,
          libres: usoDe(g, usados).libres,
          escaneando: !!b?.activa,
          progreso: b ? { revisados: b.revisados, folio: b.folio, total: b.total } : null,
          error: b?.error ?? null,
        });
      }
    }
    const folios: FoliosSii[] = [];
    if (c.certificado) for (const tipo of TIPOS_DOCUMENTO) folios.push(await reposicion.estado(tipo));
    return {
      conectado: listo(c),
      puedeGuardar: puedeGuardar(),
      titular: c.certificado?.rut ?? null,
      venceEl: c.certificado?.venceEl ?? null,
      rutEmisor: c.rutEmisor ?? null,
      empresa: c.empresa ?? null,
      origenEmpresa: c.origenEmpresa ?? null,
      resolucion: c.resolucion
        ? { fecha: c.resolucion.fecha, numero: c.resolucion.numero, origen: c.resolucion.origen ?? 'manual', rechazada: !!c.resolucion.rechazadaEn }
        : null,
      cafs,
      folios,
      automatico: automatico && { activo: automatico.activo, pasos: automatico.pasos.map(p => ({ ...p })) },
      sesionPersistente,
    };
  }

  const listo = (c: ConexionGuardada) =>
    !!(c.certificado && c.rutEmisor && c.empresa && c.resolucion && !c.resolucion.rechazadaEn && cafsDe(c, 33).some(g => g.primerLibre !== undefined));

  /** QueryEstDte de un folio propio con el certificado conectado (los datos del documento no importan para saber si está libre). */
  const consultaDeFolios = (cert: { pfx: Buffer; clave: string }, rutEmisor: string) => {
    const consulta = crearConsulta(cert.pfx, cert.clave, rutEmisor);
    return async (tipo: number, folio: number): Promise<RespuestaFolio> => {
      const r = await consulta({ tipo, folio, fechaEmision: hoy(), montoTotal: 1, rutReceptor: rutEmisor });
      log.info(`[conexion-sii] QueryEstDte tipo ${tipo} folio ${folio}: ${r.codigo} ${r.glosa ?? ''}`);
      return { codigo: r.codigo, detalle: r.respuesta };
    };
  };

  /** Busca en segundo plano el primer folio libre del CAF del tipo, desde `desde`. Nunca baja el ya conocido. */
  function buscar(tipo: TipoDocumento, cert: { pfx: Buffer; clave: string }, rutEmisor: string, caf: CafGuardado, desde: number) {
    const mia = ++generacion;
    const clave = claveBusqueda(tipo, caf);
    const b = { generacion: mia, revisados: 0, folio: desde, total: caf.hasta - desde + 1, error: null as string | null, activa: true, promesa: Promise.resolve() };
    busquedas.set(clave, b);
    const vigente = () => busquedas.get(clave)?.generacion === mia;
    const consultar = consultaDeFolios(cert, rutEmisor);
    log.info(`[conexion-sii] buscando el primer folio libre del tipo ${tipo} desde ${desde} (rango ${caf.desde} a ${caf.hasta})`);
    b.promesa = (async () => {
      try {
        const libre = await buscarPrimerLibre({
          desde, hasta: caf.hasta,
          cancelada: () => !vigente(),
          alProgreso: p => { b.revisados = p.revisados; b.folio = p.folio; },
          consultar: folio => consultar(tipo, folio),
        });
        if (!vigente()) return;
        if (libre === null) {
          b.error = `El CAF de ${nombreEnFrase(tipo)} no tiene folios libres en el SII: sube otro CAF.`;
          return;
        }
        const c = await leer();
        const actual = cafsDe(c, tipo).find(g => g.desde === caf.desde && g.hasta === caf.hasta);
        if (!actual) return;
        actual.primerLibre = Math.max(libre, actual.primerLibre ?? 0);
        await guardar(c);
        log.info(`[conexion-sii] tipo ${tipo}: primer folio libre ${actual.primerLibre}`);
      } catch (error) {
        b.error = error instanceof Error ? error.message : String(error);
        log.error(`[conexion-sii] la búsqueda de folio del tipo ${tipo} falló: ${b.error}`);
      } finally {
        b.activa = false;
      }
    })();
  }

  /**
   * Valida y guarda un CAF (subido o conseguido en el portal) junto a los otros del tipo: un tipo puede tener varios
   * rangos. Con `primerLibre` (la reposición ya le preguntó al SII o el rango es nuevo) no se busca; sin él, se busca
   * en segundo plano. Al guardar se descartan los CAF del tipo vencidos o ya sin folios.
   */
  async function guardarCaf(xmlBase64: unknown, primerLibre?: number): Promise<{ estado: EstadoConexionSii; avisos: string[] }> {
    const base64 = texto(xmlBase64);
    if (!base64 || !base64Valido(base64)) throw new ErrorConexion(400, 'Sube el archivo XML del CAF.');
    if (base64.length > MAX_CAF_BASE64) throw new ErrorConexion(413, 'El archivo es demasiado grande para ser un CAF.');
    const k = llave();
    const c = await leer();
    const cert = certificadoDe(c);
    if (!c.rutEmisor) throw new ErrorConexion(409, 'Primero guarda los datos de tu empresa.');
    let caf: ReturnType<typeof leerCaf>;
    try {
      caf = leerCaf(Buffer.from(base64, 'base64'));
    } catch (error) {
      throw new ErrorConexion(400, `El archivo no es un CAF válido: ${(error as Error).message}`);
    }
    const tipo = caf.tipo as TipoDocumento;
    if (!TIPOS_DOCUMENTO.includes(tipo)) throw new ErrorConexion(400, `El CAF es del tipo ${caf.tipo}; la red usa factura (33), guía (52) y nota de crédito (61).`);
    if (caf.rutEmisor !== c.rutEmisor) throw new ErrorConexion(400, `El CAF es de la empresa ${caf.rutEmisor}, no de ${c.rutEmisor}.`);
    const avisos: string[] = [];
    const vence = primerDiaVencido(caf);
    if (vence !== null && hoy() >= vence) throw new ErrorConexion(400, `El CAF de ${nombreEnFrase(tipo)} venció el ${vence}. Pide uno nuevo en el SII.`);
    if (vence !== null && Date.parse(vence) - Date.parse(hoy()) < 30 * 86_400_000) avisos.push(`El CAF de ${nombreEnFrase(tipo)} vence el ${vence}.`);
    if (vence === null && Date.parse(hoy()) - Date.parse(caf.fechaAutorizacion) > SEIS_MESES_MS) {
      avisos.push(`El CAF de ${nombreEnFrase(tipo)} se autorizó hace más de 6 meses (${caf.fechaAutorizacion}); puede tener folios usados.`);
    }
    const usados = await tomados(tipo);
    const previo = cafsDe(c, tipo).find(g => g.desde === caf.folioDesde && g.hasta === caf.folioHasta);
    // Lo ya conocido no se vuelve a preguntar: ni lo que una búsqueda anterior dio por usado ni lo que se sabe libre.
    const conocido = Math.max(primerLibre ?? 0, previo?.primerLibre ?? 0);
    const guardado: CafGuardado = {
      cifrado: cifrar(k, base64), desde: caf.folioDesde, hasta: caf.folioHasta, fa: caf.fechaAutorizacion,
      ...(conocido > 0 ? { primerLibre: Math.max(conocido, caf.folioDesde) } : {}),
    };
    const sirve = (g: CafGuardado) => {
      const fin = primerDiaVencido({ tipo, fechaAutorizacion: g.fa });
      return (fin === null || hoy() < fin) && usoDe(g, usados).libres !== 0;
    };
    c.cafs[tipo] = [...cafsDe(c, tipo).filter(g => g !== previo && sirve(g)), guardado].sort((x, y) => x.desde - y.desde);
    await guardar(c);
    log.info(`[conexion-sii] CAF tipo ${tipo} guardado (folios ${caf.folioDesde} a ${caf.folioHasta}, FA ${caf.fechaAutorizacion}${guardado.primerLibre ? `, libre desde ${guardado.primerLibre}` : ''})`);
    if (guardado.primerLibre === undefined) {
      const desde = Math.max(caf.folioDesde, siguienteEnRango(guardado, usados) ?? caf.folioHasta + 1);
      if (desde > caf.folioHasta) avisos.push(`El CAF de ${nombreEnFrase(tipo)} ya no tiene folios libres.`);
      else buscar(tipo, cert, c.rutEmisor, guardado, desde);
    }
    return { estado: await estado(), avisos };
  }

  /** Lo que la reposición de folios lee y escribe de esta conexión. */
  const fuente: FuenteFolios = {
    async credenciales() {
      const c = await leer();
      if (!c.certificado || !c.rutEmisor || !puedeGuardar()) return null;
      return { certificado: certificadoDe(c), rutEmpresa: c.rutEmisor };
    },
    rangos: async tipo => cafsDe(await leer(), tipo).map(g => ({ desde: g.desde, hasta: g.hasta })),
    async libres(tipo) {
      const usados = await tomados(tipo);
      return cafsDe(await leer(), tipo).reduce((n, g) => n + (usoDe(g, usados).libres ?? 0), 0);
    },
    async guardarCaf(xml, primerLibre) {
      const bytes = Buffer.from(xml, 'latin1');
      await guardarCaf(bytes.toString('base64'), primerLibre === 'nuevo' ? leerCaf(bytes).folioDesde : primerLibre);
    },
    gestion: async tipo => ({ ...GESTION_INICIAL, ...(await leer()).folios?.[tipo] }),
    async guardarGestion(tipo, g) {
      const c = await leer();
      c.folios = { ...c.folios, [tipo]: g };
      await guardar(c);
    },
    async consultarFolio(tipo, folio) {
      const c = await leer();
      return consultaDeFolios(certificadoDe(c), c.rutEmisor ?? '')(tipo, folio);
    },
  };
  const reposicion = crearReposicion({ fuente, portal, log, hoy });

  const pasoDe = (id: IdPasoSii) => automatico!.pasos.find(p => p.id === id)!;
  const marcar = (id: IdPasoSii, estadoPaso: PasoSii['estado'], detalle: string | null = null, mensajeSii: string | null = null) => {
    Object.assign(pasoDe(id), { estado: estadoPaso, detalle, mensajeSii });
    version++;
  };
  const textoError = (error: unknown) => ({
    detalle: error instanceof Error ? error.message : String(error),
    mensajeSii: esErrorPortal(error) ? error.mensajeSii : null,
  });

  /**
   * Conexión automática, en segundo plano: ficha y resolución de la empresa, y un CAF de factura, guía y nota de
   * crédito. Cada paso que falla queda con su motivo (y el texto del SII) para hacerlo a mano; los demás siguen. Con el
   * límite de sesiones del SII se detiene todo: insistir alargaría el bloqueo.
   */
  async function correrAutomatico(rut: string) {
    const c0 = await leer();
    const cert = certificadoDe(c0);
    const certificado = { pfx: cert.pfx, clave: cert.clave };
    const detener = (error: unknown) => esErrorPortal(error, 'LIMITE_SESIONES') || esErrorPortal(error, 'CERTIFICADO_NO_HABILITADO');
    const restantes = (desde: IdPasoSii, error: unknown) => {
      const { detalle, mensajeSii } = textoError(error);
      for (const id of PASOS.slice(PASOS.indexOf(desde))) marcar(id, 'error', detalle, mensajeSii);
    };

    marcar('empresa', 'en_curso');
    try {
      const ficha = await portal.ficha(certificado, rut);
      const c = await leer();
      if (c.rutEmisor && c.rutEmisor !== rut) {
        olvidarFolios(c);
        delete c.resolucion;
      }
      c.rutEmisor = rut;
      c.empresa = {
        razonSocial: ficha.razonSocial.slice(0, 100), giro: ficha.giro.slice(0, 80), acteco: ficha.acteco,
        direccion: ficha.direccion.slice(0, 70), comuna: ficha.comuna.slice(0, 20), ...(ficha.ciudad ? { ciudad: ficha.ciudad.slice(0, 20) } : {}),
      };
      c.origenEmpresa = 'sii';
      await guardar(c);
      marcar('empresa', 'listo', ficha.razonSocial);
    } catch (error) {
      if (detener(error)) return restantes('empresa', error);
      marcar('empresa', 'error', ...Object.values(textoError(error)) as [string, string | null]);
      const c = await leer();
      if (!c.rutEmisor) {
        c.rutEmisor = rut;
        await guardar(c);
      }
    }

    marcar('resolucion', 'en_curso');
    try {
      const r = await portal.resolucion(certificado, rut);
      const c = await leer();
      c.resolucion = { fecha: r.fecha, numero: r.numero, origen: 'sii' };
      await guardar(c);
      marcar('resolucion', 'listo', `${r.fecha} n.º ${r.numero}`);
    } catch (error) {
      if (detener(error)) return restantes('resolucion', error);
      const { detalle, mensajeSii } = textoError(error);
      const previa = (await leer()).resolucion;
      marcar('resolucion', previa ? 'omitido' : 'error',
        `El SII no entregó la resolución (${detalle}). ${previa ? 'Se mantiene la que ya estaba.' : 'Escríbela en "Tu empresa".'}`, mensajeSii);
    }

    // Folios: la misma reposición automática que corre antes de facturar y después de emitir, aquí para todo tipo.
    for (const tipo of TIPOS_DOCUMENTO) {
      const id = `caf_${tipo}` as IdPasoSii;
      if ([...busquedas.entries()].some(([clave, b]) => clave.startsWith(`${tipo}:`) && b.activa)) {
        marcar(id, 'omitido', `Se está revisando el CAF de ${nombreEnFrase(tipo)} que subiste.`);
        continue;
      }
      marcar(id, 'en_curso');
      const e = await reposicion.reponer(tipo, { conexion: true });
      const libres = contar(e.libres, 'folio libre', 'folios libres');
      if (e.estado === 'en_espera') marcar(id, 'error', e.detalle, e.mensajeSii);
      else if (e.repuestos > 0) marcar(id, 'listo', `${e.detalle ?? ''} Quedan ${libres}.`.trim());
      else if (e.libres > 0) marcar(id, 'omitido', `Ya hay ${libres}.`);
      else marcar(id, 'error', e.detalle ?? `El SII no entregó folios de ${nombreEnFrase(tipo)}.`, e.mensajeSii);
    }
  }

  function iniciarAutomatico(rut: string) {
    if (automatico?.activo) return;
    automatico = { activo: true, pasos: PASOS.map(id => ({ id, estado: 'pendiente', detalle: null, mensajeSii: null })), promesa: Promise.resolve() };
    const actual = automatico;
    version++;
    log.info(`[conexion-sii] conexión automática con el SII para ${rut}`);
    actual.promesa = correrAutomatico(rut)
      .catch(error => log.error('[conexion-sii] la conexión automática falló', error))
      .finally(() => { actual.activo = false; version++; });
  }

  /** RUT de la empresa: el indicado, el ya guardado o, si no hay, el del titular del certificado. */
  function rutParaConectar(c: ConexionGuardada, rutEmisor: unknown): string {
    if (texto(rutEmisor)) return rutValido(rutEmisor);
    return c.rutEmisor ?? c.certificado?.rut ?? rutValido('');
  }

  return {
    estado,

    async subirCertificado(pfxBase64, clave, rutEmisor) {
      const base64 = texto(pfxBase64);
      if (!base64 || !base64Valido(base64)) throw new ErrorConexion(400, 'Sube el archivo .pfx de tu certificado digital.');
      if (base64.length > MAX_PFX_BASE64) throw new ErrorConexion(413, 'El archivo es demasiado grande para ser un certificado .pfx.');
      if (typeof clave !== 'string' || !clave) throw new ErrorConexion(400, 'Escribe la clave de tu certificado.');
      const k = llave();
      let cert: ReturnType<typeof abrirCertificado>;
      try {
        cert = abrirCertificado(Buffer.from(base64, 'base64'), clave);
      } catch {
        throw new ErrorConexion(400, 'No pudimos abrir el certificado. Revisa que sea el .pfx correcto y su clave.');
      }
      if (cert.venceEl.getTime() <= Date.now()) {
        throw new ErrorConexion(400, `El certificado venció el ${cert.venceEl.toISOString().slice(0, 10)}. Sube uno vigente.`);
      }
      const c = await leer();
      c.certificado = { cifrado: cifrar(k, JSON.stringify({ pfxBase64: base64, clave })), rut: cert.rut, venceEl: cert.venceEl.toISOString() };
      await guardar(c);
      log.info(`[conexion-sii] certificado guardado (titular ${cert.rut}, vence ${c.certificado.venceEl.slice(0, 10)})`);
      iniciarAutomatico(rutParaConectar(c, rutEmisor));
      return estado();
    },

    async conectarAutomatico(rutEmisor) {
      const c = await leer();
      if (!c.certificado) throw new ErrorConexion(409, 'Primero sube tu certificado digital.');
      llave();
      iniciarAutomatico(rutParaConectar(c, rutEmisor));
      return estado();
    },

    async consultarEmpresa(rutEmisor) {
      const rut = rutValido(rutEmisor);
      const { pfx, clave } = certificadoDe(await leer());
      try {
        const datos = await portal.ficha({ pfx, clave }, rut);
        log.info(`[conexion-sii] ficha de ${rut} leída del portal del SII`);
        return datos;
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        log.warn(`[conexion-sii] no se pudo leer la ficha de ${rut} del portal: ${detalle}`);
        throw new ErrorConexion(502, `No pudimos leer tus datos del SII. Escríbelos tú. Detalle: ${detalle}`);
      }
    },

    async guardarEmpresa(datos) {
      const rut = rutValido(datos.rutEmisor);
      const acteco = Number(texto(datos.acteco));
      if (!/^\d{6}$/.test(texto(datos.acteco))) throw new ErrorConexion(400, 'El código de actividad económica tiene 6 dígitos.');
      const empresa: EmpresaSii = {
        razonSocial: campo(datos, 'razonSocial', 'la razón social', 100),
        giro: campo(datos, 'giro', 'el giro', 80),
        acteco,
        direccion: campo(datos, 'direccion', 'la dirección', 70),
        comuna: campo(datos, 'comuna', 'la comuna', 20),
      };
      const ciudad = campo(datos, 'ciudad', 'la ciudad', 20, false);
      if (ciudad) empresa.ciudad = ciudad;
      const fecha = texto(datos.fchResol);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha)) || fecha > hoy()) {
        throw new ErrorConexion(400, 'La fecha de resolución va como AAAA-MM-DD y no puede ser futura.');
      }
      const numero = datos.nroResol === undefined || datos.nroResol === '' ? 0 : Number(datos.nroResol);
      if (!Number.isInteger(numero) || numero < 0) throw new ErrorConexion(400, 'El número de resolución es un entero (0 en certificación).');
      llave();
      const c = await leer();
      if (!c.certificado) throw new ErrorConexion(409, 'Primero sube tu certificado digital.');
      if (c.rutEmisor && c.rutEmisor !== rut) {
        // Otra empresa: sus CAF y lo aprendido de sus folios no sirven.
        olvidarFolios(c);
      }
      c.rutEmisor = rut;
      c.empresa = empresa;
      c.origenEmpresa = datos.origen === 'sii' ? 'sii' : 'manual';
      const previa = c.resolucion;
      const igual = previa && previa.fecha === fecha && previa.numero === numero;
      // La misma resolución conserva su origen y su rechazo; una corregida a mano parte limpia.
      c.resolucion = igual ? previa : { fecha, numero, origen: 'manual' };
      await guardar(c);
      log.info(`[conexion-sii] empresa ${rut} guardada (resolución ${fecha} n.º ${numero})`);
      return estado();
    },

    subirCaf: guardarCaf,

    async fijarFolio(tipoEntrada, folioEntrada) {
      const tipo = Number(tipoEntrada) as TipoDocumento;
      const folio = Number(folioEntrada);
      const c = await leer();
      const delTipo = cafsDe(c, tipo);
      if (delTipo.length === 0) throw new ErrorConexion(404, `No hay CAF de ${nombreEnFrase(tipo)}.`);
      // El CAF que contiene el folio; si ninguno, el más nuevo (para explicar el rango válido).
      const caf = delTipo.find(g => folio >= g.desde && folio <= g.hasta) ?? delTipo.at(-1)!;
      const minimo = Math.max(caf.desde, caf.primerLibre ?? 0);
      if (!Number.isInteger(folio) || folio < minimo || folio > caf.hasta) {
        throw new ErrorConexion(400, `El folio debe estar entre ${minimo} y ${caf.hasta}: nunca se vuelve a un folio anterior.`);
      }
      busquedas.delete(claveBusqueda(tipo, caf));
      caf.primerLibre = folio;
      await guardar(c);
      log.info(`[conexion-sii] tipo ${tipo}: primer folio fijado a mano en ${folio}`);
      return estado();
    },

    async traerFolios(tipoEntrada) {
      const tipo = Number(tipoEntrada) as TipoDocumento;
      if (!TIPOS_DOCUMENTO.includes(tipo)) throw new ErrorConexion(400, 'Tipo de documento no válido.');
      if (!(await fuente.credenciales())) throw new ErrorConexion(409, 'Primero conecta tu certificado y tu empresa.');
      const e = await reposicion.estado(tipo);
      if (e.estado === 'en_espera') throw new ErrorConexion(409, `El SII pidió esperar antes de volver a intentarlo.${e.mensajeSii ? ` El SII dice: «${e.mensajeSii}»` : ''}`);
      void reposicion.reponer(tipo, { demanda: demandaManual(tipo, e.libres), conexion: true });
      return estado();
    },

    folios: reposicion,

    async desconectar() {
      busquedas.clear();
      await almacen.borrar();
      version++;
      log.info('[conexion-sii] conexión borrada');
      return estado();
    },

    async configuracion() {
      const c = normalizar(await almacen.leer());
      if (!c || !listo(c)) return null;
      const k = llave();
      const e = c.empresa!;
      const cafs: Partial<Record<number, Buffer[]>> = {};
      const rangos: Partial<Record<TipoDocumento, RangoFolios[]>> = {};
      for (const tipo of TIPOS_DOCUMENTO) {
        // Un CAF cuyo primer folio libre aún no se conoce no se usa: podría repetir un folio ya recibido.
        const usables = cafsDe(c, tipo).filter(g => g.primerLibre !== undefined);
        cafs[tipo] = usables.map(g => Buffer.from(descifrar(k, g.cifrado), 'base64'));
        rangos[tipo] = usables.map(g => ({ desde: g.primerLibre!, hasta: g.hasta }));
      }
      return {
        sii: {
          certificado: certificadoDe(c),
          emisor: { rut: c.rutEmisor!, razonSocial: e.razonSocial, giro: e.giro, acteco: e.acteco, direccion: e.direccion, comuna: e.comuna, ...(e.ciudad ? { ciudad: e.ciudad } : {}) },
          fchResol: c.resolucion!.fecha,
          cafs,
        },
        rangos,
      };
    },

    version: () => version,

    async marcarRechazoCaratula() {
      const c = normalizar(await almacen.leer());
      if (!c?.resolucion || c.resolucion.rechazadaEn) return;
      c.resolucion.rechazadaEn = new Date().toISOString();
      await guardar(c);
      log.error(`[conexion-sii] el SII rechazó la carátula (RCT) con la resolución ${c.resolucion.fecha} n.º ${c.resolucion.numero}: la conexión deja de emitir hasta corregirla`);
    },

    async esperarBusquedas() {
      await automatico?.promesa;
      await Promise.all([...busquedas.values()].map(b => b.promesa));
      await reposicion.esperarCorridas();
    },
  };
}
