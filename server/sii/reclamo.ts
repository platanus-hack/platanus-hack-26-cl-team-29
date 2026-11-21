// WS de aceptación o reclamo de un DTE recibido (Ley 19.983): el receptor acepta, acusa recibo o reclama.
import type { Autenticador } from './autenticacion.ts';
import { desescapar, ErrorSii, etiqueta, type Http, sobreSoap, todas, URLS } from './soap.ts';
import type { AccionReceptor, DocumentoRecibido, EventosDocumento, RespuestaReclamo, ResultadoReclamo } from './tipos.ts';
import { escaparXml, partirRut } from './texto.ts';

const ESPACIO = 'http://ws.registroreclamodte.diii.sdi.sii.cl';
export const ACCIONES: readonly AccionReceptor[] = ['ACD', 'ERM', 'RCD', 'RFP', 'RFT'];
/** El servicio solo opera sobre facturas (33), facturas exentas (34) y liquidaciones factura (43). */
export const TIPOS_RECLAMABLES: readonly number[] = [33, 34, 43];

/**
 * `codResp` del servicio. 7 (ya registrado) es éxito para quien reintenta; 16 y 18 son datos, no errores;
 * -1 es un error interno del SII que se puede volver a intentar más tarde.
 */
export function resultadoDe(codigo: number): ResultadoReclamo {
  switch (codigo) {
    case 0:
    case 15: // "Listado de eventos del documento"
      return 'ok';
    case 7:
      return 'ya_registrado';
    case 8:
      return 'fuera_de_plazo';
    case 11:
      return 'previamente_aceptado';
    case 14:
    case 17:
      return 'no_autorizado';
    case 16:
      return 'sin_eventos';
    case 18:
      return 'no_recibido';
    case -1:
      return 'error_sii';
    default:
      return 'rechazado';
  }
}

/** Llama un método con la cookie TOKEN. Ante 401 o 403 (token vencido) se renueva el token y se reintenta una vez. */
function llamar(
  http: Http,
  autenticador: Autenticador,
  metodo: string,
  documento: DocumentoRecibido,
  extra: string,
): Promise<{ texto: string; respuesta: RespuestaReclamo }> {
  const [rut, dv] = partirRut(documento.rutEmisor);
  const parametros =
    `<rutEmisor>${rut}</rutEmisor><dvEmisor>${dv}</dvEmisor><tipoDoc>${documento.tipo}</tipoDoc>` +
    `<folio>${documento.folio}</folio>${extra}`;
  return autenticador.conToken(async token => {
    const r = await http({
      url: URLS.reclamo,
      cabeceras: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '', Cookie: `TOKEN=${token}` },
      cuerpo: sobreSoap(`<ws:${metodo}>${parametros}</ws:${metodo}>`, { espacios: ` xmlns:ws="${ESPACIO}"`, cabecera: true }),
    });
    const tokenRechazado = r.status === 401 || r.status === 403;
    const texto = desescapar(r.cuerpo);
    const codigo = etiqueta(texto, 'codResp');
    if (tokenRechazado) return { tokenRechazado, valor: { texto, respuesta: { codigo: -1, descripcion: texto, resultado: 'error_sii' } } };
    if (codigo === null || !/^-?\d+$/.test(codigo)) {
      throw new ErrorSii(`Respuesta inesperada del WS de reclamos (HTTP ${r.status})`, texto);
    }
    const n = Number(codigo);
    return {
      tokenRechazado,
      valor: { texto, respuesta: { codigo: n, descripcion: etiqueta(texto, 'descResp') ?? '', resultado: resultadoDe(n) } },
    };
  });
}

export function validarReclamo(documento: DocumentoRecibido, accion?: string): void {
  if (!TIPOS_RECLAMABLES.includes(documento.tipo)) {
    throw new Error(`El WS de reclamos solo admite los tipos ${TIPOS_RECLAMABLES.join(', ')} (recibido ${documento.tipo}).`);
  }
  if (accion !== undefined && !(ACCIONES as readonly string[]).includes(accion)) {
    throw new Error(`Acción inválida "${accion}": se admite ${ACCIONES.join(', ')}.`);
  }
}

/** Escribe en el SII: no se repite por cortes. Antes de reintentar, consultar los eventos (7 = ya estaba). */
export async function registrarAccion(
  http: Http,
  autenticador: Autenticador,
  documento: DocumentoRecibido,
  accion: AccionReceptor,
): Promise<RespuestaReclamo> {
  validarReclamo(documento, accion);
  const extra = `<accionDoc>${escaparXml(accion)}</accionDoc>`;
  return (await llamar(http, autenticador, 'ingresarAceptacionReclamoDoc', documento, extra)).respuesta;
}

export async function listarEventos(
  http: Http,
  autenticador: Autenticador,
  documento: DocumentoRecibido,
): Promise<EventosDocumento> {
  validarReclamo(documento);
  const { texto, respuesta } = await llamar(http, autenticador, 'listarEventosHistDoc', documento, '');
  const eventos = todas(texto, 'listaEventosDoc').map(e => ({
    codigo: etiqueta(e, 'codEvento') ?? '',
    descripcion: etiqueta(e, 'descEvento') ?? '',
    rutResponsable: `${etiqueta(e, 'rutResponsable') ?? ''}-${etiqueta(e, 'dvResponsable') ?? ''}`,
    fecha: etiqueta(e, 'fechaEvento') ?? '',
  }));
  return { ...respuesta, eventos };
}
