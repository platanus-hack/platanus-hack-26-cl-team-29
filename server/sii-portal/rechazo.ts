// Reconoce un rechazo del portal dentro de una respuesta. Casi todo error del SII llega con HTTP 200 y en un lugar
// fijo por familia: redirección al login (sesión vencida), `alert()` con código `01.01.NNN.NNN.NNN`, plantilla
// "No ha sido posible completar su solicitud", cortafuegos ("Solicitud Bloqueada"). Se extrae el mensaje literal de
// ese lugar; nunca se decide por el tamaño de la página ni por subcadenas sueltas en todo el cuerpo.
import { ErrorPortal } from './errores.ts';
import { alertas, normalizar, textoVisible, titulo } from './html.ts';
import type { RespuestaHttp } from './http.ts';

/** Código de mensaje de autenticación: cinco grupos y a veces un sufijo (`01.01.215.500.720.27`). */
export const CODIGO_AUTENTICACION = /\b\d{2}\.\d{2}\.\d{3}\.\d{3}\.\d{3}(?:\.\d{2})?\b/;
const DESTINO_LOGIN = /zeusr?\.sii\.cl\/(?:AUT2000\/|cgi_AUT2000\/autInicioDTE)|InicioAutenticacion|IngresoRutClave/i;
const PAGINA_404 = /custom_pages\/Error404/i;
const ENCABEZADO_PLANTILLA = 'NO HA SIDO POSIBLE COMPLETAR SU SOLICITUD';
const NO_AUTENTICADO = 'NO SE ENCUENTRA AUTENTICADO CON CERTIFICADO DIGITAL';
const NO_AUTORIZADA_MODALIDAD = /(EMPRESA|CONTRIBUYENTE) NO ESTA AUTORIZAD[OA] PARA OPERAR EN ESTA MODALIDAD/;

/** Texto visible desde el encabezado de la plantilla de error (incluye "Esto debido a que ..." o el código). */
function mensajePlantilla(visible: string): string | null {
  const i = normalizar(visible).indexOf(ENCABEZADO_PLANTILLA);
  return i < 0 ? null : visible.slice(i).trim();
}

/** El error que corresponde a la respuesta, o null si no es un rechazo conocido. */
export function detectarRechazo(r: RespuestaHttp, paso: string): ErrorPortal | null {
  if (r.estado >= 300 && r.estado < 400) {
    const destino = r.ubicacion ?? '';
    if (DESTINO_LOGIN.test(destino)) return new ErrorPortal('SESION_VENCIDA', 'La sesión del SII venció.', { paso });
    if (PAGINA_404.test(destino)) {
      return new ErrorPortal('RESPUESTA_INESPERADA', `El SII respondió con su página de error 404 en ${paso} (HTTP ${r.estado}).`, { paso });
    }
    return null;
  }
  if (r.estado >= 500) return new ErrorPortal('RESPUESTA_INESPERADA', `El SII respondió HTTP ${r.estado} en ${paso}.`, { paso, mensajeSii: textoVisible(r.cuerpo) });
  const codigo = alertas(r.cuerpo).find(a => CODIGO_AUTENTICACION.test(a));
  if (codigo) return new ErrorPortal('RECHAZO_SII', `El SII rechazó la solicitud en ${paso}.`, { paso, mensajeSii: codigo });
  const t = titulo(r.cuerpo);
  const visible = textoVisible(r.cuerpo);
  if (t !== null && normalizar(t) === 'SOLICITUD BLOQUEADA') {
    return new ErrorPortal('RECHAZO_SII', `El cortafuegos del SII bloqueó la solicitud en ${paso}.`, { paso, mensajeSii: `${t} ${visible}` });
  }
  const normal = normalizar(visible);
  if (NO_AUTORIZADA_MODALIDAD.test(normal)) {
    return new ErrorPortal('EMPRESA_NO_AUTORIZADA', 'El SII no tiene a esta empresa como emisor electrónico en certificación.', { paso, mensajeSii: visible });
  }
  const plantilla = mensajePlantilla(visible);
  if (plantilla) return new ErrorPortal('RECHAZO_SII', `El SII rechazó la solicitud en ${paso}.`, { paso, mensajeSii: plantilla });
  // Un GET a un CGI que solo acepta POST muestra este texto con la sesión vigente: solo cuenta tras un POST.
  if (r.metodo === 'POST' && normal.includes(NO_AUTENTICADO)) return new ErrorPortal('SESION_VENCIDA', 'La sesión del SII venció.', { paso, mensajeSii: visible });
  return null;
}
