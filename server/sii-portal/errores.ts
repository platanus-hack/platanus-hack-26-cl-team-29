// Errores del portal del SII. Cada uno lleva el texto literal del SII cuando lo hay (nunca una traducción propia) y
// dice qué hacer: esperar, tramitar, corregir o reintentar más tarde.

export type CodigoPortal =
  /** El SII dice "superado el máximo de sesiones" (código ...720): no se reintenta, se espera. */
  | 'LIMITE_SESIONES'
  /** El certificado no está habilitado para entrar al sitio del SII (trámite del contribuyente). */
  | 'CERTIFICADO_NO_HABILITADO'
  /** La sesión guardada ya no sirve (el SII redirige al login). Uso interno: se hace un solo login nuevo. */
  | 'SESION_VENCIDA'
  /** El SII rechazó la solicitud dentro de un 200 (plantilla de error, alerta, cortafuegos, página terminal). */
  | 'RECHAZO_SII'
  /** El timbraje no autoriza folios ("NO SE AUTORIZA TIMBRAJE", advertencia de folios suficientes, situaciones pendientes). */
  | 'TIMBRAJE_BLOQUEADO'
  /** La empresa no figura como emisor electrónico en este ambiente. */
  | 'EMPRESA_NO_AUTORIZADA'
  /** No se llegó al SII o la conexión se cortó. */
  | 'TRANSPORTE'
  /** El SII respondió una página que no es la esperada en este paso. */
  | 'RESPUESTA_INESPERADA';

export class ErrorPortal extends Error {
  readonly codigo: CodigoPortal;
  /** Texto del SII sin recortar, si lo hay. */
  readonly mensajeSii: string | null;
  /** Operación y paso del portal donde ocurrió. */
  readonly paso: string;
  /** Con `LIMITE_SESIONES`: hasta cuándo (epoch ms) no se intenta otro login. */
  readonly esperarHasta: number | null;

  constructor(codigo: CodigoPortal, mensaje: string, opciones: { mensajeSii?: string | null; paso?: string; esperarHasta?: number | null } = {}) {
    super(mensaje);
    this.name = 'ErrorPortal';
    this.codigo = codigo;
    this.mensajeSii = opciones.mensajeSii ?? null;
    this.paso = opciones.paso ?? '';
    this.esperarHasta = opciones.esperarHasta ?? null;
  }
}

export const esErrorPortal = (e: unknown, codigo?: CodigoPortal): e is ErrorPortal =>
  e instanceof ErrorPortal && (codigo === undefined || e.codigo === codigo);
