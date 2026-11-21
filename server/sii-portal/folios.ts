// Folios (CAF) en el portal de certificación. Reglas aplicadas (ver docs/hallazgos, reglas del portal del SII):
// - Orden de remedios: reusar lo que hay, REOBTENER rangos ya autorizados (no gasta cupo) y, solo si no hay, pedir
//   folios nuevos dentro del tope que publica el SII (`MAX_AUTOR`). Pedir de más agrava el racionamiento.
// - Este módulo NUNCA anula folios: anular es irreversible y pesa seis meses contra el cupo. No existe código para eso.
// - El listado de reobtención mezcla rangos con folios ya usados: antes de usar un folio se le pregunta al SII
//   (QueryEstDte, fuera de este módulo).
// - Cada flujo parte con un GET y cada POST sale del formulario de la página anterior (action y ocultos).
// - El bloqueo del timbraje llega en `of_solicita_folios_dcto` con su texto: se entrega literal, sin reintentar.
import { ErrorPortal } from './errores.ts';
import { formularioHacia, leerFormularios, normalizar, opcionesDe, textoVisible, valorDe, valorDeCampo, type Formulario } from './html.ts';
import type { RespuestaHttp } from './http.ts';
import { partirRut } from '../../shared/rut.ts';
import type { SesionPortal } from './portal.ts';

const PORTAL = 'https://maullin.sii.cl/cvc_cgi/dte';
const url = (pagina: string) => `${PORTAL}/${pagina}`;

export interface RangoFolios {
  tipo: number;
  desde: number;
  hasta: number;
  cantidad: number;
  /** Fecha del timbraje (`FA` del CAF), `AAAA-MM-DD`. */
  fecha: string;
}

export interface TopeFolios {
  /** `MAX_AUTOR`. null si el SII no raciona el tipo. */
  maximo: number | null;
  /** `FOLIOS_DISP`. */
  disponibles: number | null;
}

/** POST de un formulario leído de la página: sus campos, con `cambios` encima. */
function enviarFormulario(sesion: SesionPortal, paso: string, f: Formulario, cambios: [string, string][], referer: string) {
  const campos = new Map(f.campos);
  for (const [n, v] of cambios) campos.set(n, v);
  const destino = new URL(f.accion ?? '', referer);
  if (destino.origin !== new URL(PORTAL).origin) {
    throw new ErrorPortal('RESPUESTA_INESPERADA', `El formulario apunta fuera del portal (${destino.host}).`, { paso });
  }
  return sesion.pedir({ paso, metodo: 'POST', url: destino.toString(), campos: [...campos], referer });
}

function formularioDe(r: RespuestaHttp, destino: string, paso: string): Formulario {
  const f = formularioHacia(leerFormularios(r.cuerpo), destino);
  if (!f) throw new ErrorPortal('RESPUESTA_INESPERADA', `El SII no entregó el paso siguiente (${destino}) en ${paso}.`, { paso, mensajeSii: textoVisible(r.cuerpo) });
  return f;
}

/** GET de una página del portal y su formulario con `RUT_EMP`. */
async function abrir(sesion: SesionPortal, pagina: string): Promise<Formulario> {
  const r = await sesion.pedir({ paso: pagina, metodo: 'GET', url: url(pagina) });
  const f = leerFormularios(r.cuerpo).find(x => x.campos.some(([n]) => n === 'RUT_EMP'));
  if (r.estado !== 200 || !f) throw new ErrorPortal('RESPUESTA_INESPERADA', `El SII no mostró el formulario de ${pagina} (HTTP ${r.estado}).`, { paso: pagina, mensajeSii: textoVisible(r.cuerpo) });
  return f;
}

/* ---------- Reobtención ---------- */

const entero = (v: string | null) => (v !== null && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

/** Filas del listado `rf_reobtencion2_folios`: cada fila es un formulario hacia `rf_reobtencion3_folios` con sus ocultos. */
export function leerRangos(html: string): { filas: { rango: RangoFolios; formulario: Formulario }[]; siguiente: Formulario | null } {
  const formularios = leerFormularios(html);
  const filas: { rango: RangoFolios; formulario: Formulario }[] = [];
  for (const f of formularios.filter(x => (x.accion ?? '').endsWith('rf_reobtencion3_folios'))) {
    const [tipo, desde, hasta, cantidad] = ['COD_DOCTO', 'FOLIO_INI', 'FOLIO_FIN', 'CANT_DOCTOS'].map(n => entero(valorDe(f, n)));
    const [ano, mes, dia] = ['ANO', 'MES', 'DIA'].map(n => valorDe(f, n));
    if (tipo == null || desde == null || hasta == null || !ano || !mes || !dia) {
      throw new ErrorPortal('RESPUESTA_INESPERADA', 'Una fila del listado de reobtención no trae su rango.', { paso: 'rf_reobtencion2_folios' });
    }
    filas.push({ rango: { tipo, desde, hasta, cantidad: cantidad ?? hasta - desde + 1, fecha: `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}` }, formulario: f });
  }
  const sinRangos = normalizar(textoVisible(html)).includes('NO REGISTRA TIMBRAJES');
  if (filas.length === 0 && !sinRangos) {
    throw new ErrorPortal('RESPUESTA_INESPERADA', 'El SII no entregó el listado de rangos reobtenibles.', { paso: 'rf_reobtencion2_folios', mensajeSii: textoVisible(html) });
  }
  // "Ver Siguiente": el botón NEXT llama cambiapag(N), que fija PAGINA y reenvía el formulario.
  let siguiente: Formulario | null = null;
  for (const f of formularios) {
    const boton = f.botones.find(b => b.nombre.toUpperCase() === 'NEXT');
    const n = boton?.alHacerClic?.match(/cambiapag\(\s*(\d+)\s*\)/)?.[1];
    if (n) siguiente = { ...f, campos: f.campos.map(([c, v]) => [c, c === 'PAGINA' ? n : v]) };
  }
  return { filas, siguiente };
}

/**
 * Recorre el listado de rangos reobtenibles (del folio más alto al más bajo, o sea los más recientes primero) y
 * entrega cada página a `alRecibir`, que devuelve true para detenerse. Así no se pagina de más contra el SII.
 */
async function recorrerReobtenibles(
  sesion: SesionPortal, rutEmpresa: string, tipo: number,
  alRecibir: (filas: { rango: RangoFolios; formulario: Formulario }[]) => boolean, maxPaginas = 5,
) {
  const [rut, dv] = partirRut(rutEmpresa);
  const inicio = await abrir(sesion, 'rf_reobtencion1_folios');
  let r = await enviarFormulario(sesion, 'rf_reobtencion2_folios', inicio,
    [['RUT_EMP', rut], ['DV_EMP', dv], ['COD_DOCTO', String(tipo)], ['PAGINA', '1'], ['ACEPTAR', 'Consultar']], url('rf_reobtencion1_folios'));
  const vistas = new Set<string>();
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const { filas, siguiente } = leerRangos(r.cuerpo);
    const huella = filas.map(f => `${f.rango.desde}-${f.rango.hasta}`).join('|');
    if (filas.length === 0 || vistas.has(huella)) return;
    vistas.add(huella);
    if (alRecibir(filas) || !siguiente || pagina === maxPaginas) return;
    r = await enviarFormulario(sesion, `rf_reobtencion2_folios#${pagina + 1}`, siguiente, [], url('rf_reobtencion2_folios'));
  }
}

/**
 * Rangos ya autorizados que el SII deja volver a descargar, los más recientes primero, hasta `maxFilas` de los que
 * cumplen `incluir` (así un rango ya revisado no ocupa un lugar y se pagina hacia los más antiguos). Solo lectura.
 */
export async function listarReobtenibles(
  sesion: SesionPortal, rutEmpresa: string, tipo: number, maxFilas = 15, incluir: (r: RangoFolios) => boolean = () => true,
): Promise<RangoFolios[]> {
  const rangos: RangoFolios[] = [];
  await recorrerReobtenibles(sesion, rutEmpresa, tipo, filas => {
    rangos.push(...filas.map(f => f.rango).filter(x => x.tipo === tipo && incluir(x)));
    return rangos.length >= maxFilas;
  });
  return rangos.slice(0, maxFilas);
}

/** El XML del CAF (`<AUTORIZACION>...</AUTORIZACION>`) tal como lo entregó el SII. Lleva la llave privada del rango. */
function xmlCaf(r: RespuestaHttp): string | null {
  const i = r.cuerpo.indexOf('<AUTORIZACION');
  const fin = r.cuerpo.indexOf('</AUTORIZACION>');
  if (r.estado !== 200 || i < 0 || fin < i) return null;
  return r.cuerpo.slice(i, fin + '</AUTORIZACION>'.length);
}

/** Baja el CAF de la página de descarga; a veces el SII responde otra vez el enlace de descarga y se sigue una vez más. */
async function descargar(sesion: SesionPortal, paso: string, f: Formulario, referer: string): Promise<string> {
  let formulario = f;
  for (let intento = 0; intento < 2; intento++) {
    const r = await enviarFormulario(sesion, paso, formulario, [], referer);
    const xml = xmlCaf(r);
    if (xml) return xml;
    const otro = formularioHacia(leerFormularios(r.cuerpo), paso.split('#')[0]!);
    if (!otro) throw new ErrorPortal('RESPUESTA_INESPERADA', 'El SII no entregó el archivo del CAF.', { paso, mensajeSii: textoVisible(r.cuerpo) });
    formulario = otro;
  }
  throw new ErrorPortal('RESPUESTA_INESPERADA', 'El SII no entregó el archivo del CAF.', { paso });
}

/**
 * Reobtiene el CAF de un rango ya autorizado, sin gastar cupo: lo busca en el listado, abre su fila
 * (`rf_reobtencion3_folios`, donde el SII avisa si fue anulado), lo solicita (`rf_genera_folio`) y baja el archivo
 * (`rf_genera_archivo`). Un rango anulado sale como error con el aviso literal y no se pide.
 */
export async function reobtenerCaf(sesion: SesionPortal, rutEmpresa: string, rango: RangoFolios): Promise<string> {
  let fila: Formulario | null = null;
  await recorrerReobtenibles(sesion, rutEmpresa, rango.tipo, filas => {
    fila = filas.find(f => f.rango.tipo === rango.tipo && f.rango.desde === rango.desde && f.rango.hasta === rango.hasta)?.formulario ?? null;
    return fila !== null;
  });
  if (!fila) throw new ErrorPortal('RESPUESTA_INESPERADA', `El rango ${rango.desde}-${rango.hasta} del tipo ${rango.tipo} ya no está en el listado de reobtención.`, { paso: 'rf_reobtencion2_folios' });
  const confirmacion = await enviarFormulario(sesion, 'rf_reobtencion3_folios', fila, [], url('rf_reobtencion2_folios'));
  const visible = textoVisible(confirmacion.cuerpo);
  if (normalizar(visible).includes('HA SIDO ANULADO')) {
    throw new ErrorPortal('RECHAZO_SII', `El rango ${rango.desde}-${rango.hasta} fue anulado en el SII.`, { paso: 'rf_reobtencion3_folios', mensajeSii: visible });
  }
  const genera = formularioDe(confirmacion, 'rf_genera_folio', 'rf_reobtencion3_folios');
  const comprobante = await enviarFormulario(sesion, 'rf_genera_folio', genera, [], url('rf_reobtencion3_folios'));
  const archivo = formularioDe(comprobante, 'rf_genera_archivo', 'rf_genera_folio');
  return descargar(sesion, 'rf_genera_archivo', archivo, url('rf_genera_folio'));
}

/* ---------- Timbraje (pedir folios nuevos) ---------- */

const BLOQUEOS = ['NO SE AUTORIZA TIMBRAJE', 'NO AUTORIZA TIMBRAJE', 'SITUACIONES PENDIENTES', 'CANTIDAD DE FOLIOS SUFICIENTE'];

/** El bloqueo del timbraje llega como página sin el formulario siguiente y con su motivo: se entrega literal. */
function bloqueoDe(r: RespuestaHttp, paso: string): ErrorPortal | null {
  const visible = textoVisible(r.cuerpo);
  const normal = normalizar(visible);
  if (!BLOQUEOS.some(b => normal.includes(b))) return null;
  if (formularioHacia(leerFormularios(r.cuerpo), 'of_confirma_folio')) return null;
  return new ErrorPortal('TIMBRAJE_BLOQUEADO', 'El SII no autoriza folios nuevos de este tipo por ahora.', { paso, mensajeSii: visible });
}

/**
 * Recorre `of_solicita_folios` y `of_solicita_folios_dcto` hasta el formulario de `of_confirma_folio`, que expone
 * `MAX_AUTOR` y `FOLIOS_DISP`. En el paso de selección no se envía `CANT_DOCTOS` (si se envía, el SII omite el tope).
 */
async function llegarAConfirmacion(sesion: SesionPortal, rutEmpresa: string, tipo: number, cantidad: number) {
  const [rut, dv] = partirRut(rutEmpresa);
  const inicio = await abrir(sesion, 'of_solicita_folios');
  const primero = await enviarFormulario(sesion, 'of_solicita_folios_dcto', inicio,
    [['RUT_EMP', rut], ['DV_EMP', dv], ['COD_DOCTO', String(tipo)], ['CANTIDAD', String(cantidad)]], url('of_solicita_folios'));
  const bloqueo = bloqueoDe(primero, 'of_solicita_folios_dcto');
  if (bloqueo) throw bloqueo;
  const directo = formularioHacia(leerFormularios(primero.cuerpo), 'of_confirma_folio');
  if (directo) return { respuesta: primero, formulario: directo };
  const tipos = opcionesDe(primero.cuerpo, 'COD_DOCTO');
  if (tipos === null) throw new ErrorPortal('RESPUESTA_INESPERADA', 'El SII no mostró el selector de documentos del timbraje.', { paso: 'of_solicita_folios_dcto', mensajeSii: textoVisible(primero.cuerpo) });
  if (!tipos.some(t => Number(t.valor) === tipo)) {
    throw new ErrorPortal('RECHAZO_SII', `El SII no ofrece timbrar el tipo ${tipo} a esta empresa (ofrece: ${tipos.map(t => t.valor).filter(v => Number(v) > 0).join(', ') || 'ninguno'}).`, { paso: 'of_solicita_folios_dcto' });
  }
  const dcto = formularioDe(primero, 'of_solicita_folios_dcto', 'of_solicita_folios_dcto');
  const segundo = await enviarFormulario(sesion, 'seleccion', dcto, [['RUT_EMP', rut], ['DV_EMP', dv], ['COD_DOCTO', String(tipo)], ['CANT_DOCTOS', '']], url('of_solicita_folios_dcto'));
  const bloqueo2 = bloqueoDe(segundo, 'seleccion');
  if (bloqueo2) throw bloqueo2;
  return { respuesta: segundo, formulario: formularioDe(segundo, 'of_confirma_folio', 'seleccion') };
}

function leerTope(html: string): TopeFolios {
  return { maximo: entero(valorDeCampo(html, 'MAX_AUTOR')), disponibles: entero(valorDeCampo(html, 'FOLIOS_DISP')) };
}

/** Cuánto autoriza hoy el SII para un tipo, sin pedir nada (se detiene antes de confirmar). */
export async function consultarTope(sesion: SesionPortal, rutEmpresa: string, tipo: number): Promise<TopeFolios> {
  const { respuesta } = await llegarAConfirmacion(sesion, rutEmpresa, tipo, 1);
  return leerTope(respuesta.cuerpo);
}

/**
 * Pide `cantidad` folios nuevos y devuelve el CAF. Nunca pide más de lo que el SII autoriza (`MAX_AUTOR`): si la
 * cantidad lo pasa, falla ANTES de gastar cupo. Cualquier rechazo sale con el texto del SII y no se repite: un rango
 * que alcanzó a quedar autorizado aparece después en el listado de reobtención, que se revisa primero.
 */
export async function pedirCaf(sesion: SesionPortal, rutEmpresa: string, tipo: number, cantidad: number): Promise<string> {
  const [rut, dv] = partirRut(rutEmpresa);
  const llegada = await llegarAConfirmacion(sesion, rutEmpresa, tipo, cantidad);
  const tope = leerTope(llegada.respuesta.cuerpo);
  if (tope.maximo !== null && cantidad > tope.maximo) {
    throw new ErrorPortal('TIMBRAJE_BLOQUEADO', `El SII autoriza como máximo ${tope.maximo} folio(s) del tipo ${tipo}.`, { paso: 'of_confirma_folio' });
  }
  let paso = await enviarFormulario(sesion, 'of_confirma_folio', llegada.formulario,
    [['RUT_EMP', rut], ['DV_EMP', dv], ['COD_DOCTO', String(tipo)], ['CANT_DOCTOS', String(cantidad)]], url('of_solicita_folios_dcto'));
  const inicial = formularioHacia(leerFormularios(paso.cuerpo), 'of_confirma_folio');
  if (inicial) {
    // La primera vez de un tipo el SII pide confirmar el folio inicial; el navegador propone 1.
    paso = await enviarFormulario(sesion, 'folio_inicial', inicial, [['FOLIO_INICIAL', valorDe(inicial, 'FOLIO_INICIAL') || '1']], url('of_confirma_folio'));
  }
  const genera = formularioDe(paso, 'of_genera_folio', 'of_confirma_folio');
  // of_genera_folio: aquí el SII autoriza el rango (consume cupo). No se repite.
  const comprobante = await enviarFormulario(sesion, 'of_genera_folio', genera, [], url('of_confirma_folio'));
  const archivo = formularioDe(comprobante, 'of_genera_archivo', 'of_genera_folio');
  return descargar(sesion, 'of_genera_archivo', archivo, url('of_genera_folio'));
}
