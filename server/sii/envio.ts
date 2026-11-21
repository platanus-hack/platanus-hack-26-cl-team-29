// Subida de un EnvioDTE por DTEUpload: multipart, cookie TOKEN y el archivo en bytes ISO-8859-1.
import { randomUUID } from 'node:crypto';
import type { Autenticador } from './autenticacion.ts';
import { etiqueta, type Http, URLS, USER_AGENT } from './soap.ts';
import type { ResultadoEnvio } from './tipos.ts';
import { partirRut } from '../../shared/rut.ts';

export interface EntradaSubida {
  readonly sobreXml: string;
  readonly rutEmisor: string;
  /** Titular del certificado. */
  readonly rutEnvia: string;
}

function multipart(campos: readonly [string, string][], archivo: string, limite: string): Buffer {
  if (/[^\x00-\xFF]/.test(archivo)) throw new Error('El sobre tiene caracteres fuera de ISO-8859-1.');
  const partes = campos.map(
    ([nombre, valor]) => `--${limite}\r\nContent-Disposition: form-data; name="${nombre}"\r\n\r\n${valor}\r\n`,
  );
  return Buffer.concat([
    Buffer.from(partes.join(''), 'latin1'),
    Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="EnvioDTE.xml"\r\nContent-Type: text/xml\r\n\r\n`,
      'latin1',
    ),
    Buffer.from(archivo, 'latin1'),
    Buffer.from(`\r\n--${limite}--\r\n`, 'latin1'),
  ]);
}

/**
 * UNA solicitud, nunca se reintenta sola: maullin corta entre el 10 y el 40 % de las subidas (ECONNRESET) y en esos
 * casos el sobre no llegó, pero un reintento ciego arriesga un folio duplicado. Un corte vuelve como `incierto` y quien
 * llama consulta `estadoDocumento` antes de reenviar. El token se pide nuevo para no perder una subida por un token
 * vencido. Si la autenticación falla, lanza: en ese caso no se subió nada.
 */
export async function subirSobre(http: Http, autenticador: Autenticador, e: EntradaSubida): Promise<ResultadoEnvio> {
  const token = await autenticador.tokenNuevo();
  const [rutSender, dvSender] = partirRut(e.rutEnvia);
  const [rutCompany, dvCompany] = partirRut(e.rutEmisor);
  const limite = `----sii-${randomUUID()}`;
  const cuerpo = multipart(
    [['rutSender', rutSender], ['dvSender', dvSender], ['rutCompany', rutCompany], ['dvCompany', dvCompany]],
    e.sobreXml,
    limite,
  );
  let status: number;
  let respuesta: string;
  try {
    ({ status, cuerpo: respuesta } = await http({
      url: URLS.subida,
      cabeceras: {
        Cookie: `TOKEN=${token}`,
        'Content-Type': `multipart/form-data; boundary=${limite}`,
        'User-Agent': USER_AGENT,
        Accept: '*/*',
      },
      cuerpo,
      codificacion: 'latin1',
    }));
  } catch (error) {
    return { estado: 'incierto', error: error instanceof Error ? `${error.message} ${String(error.cause ?? '')}`.trim() : String(error) };
  }
  return leerSubida(status, respuesta);
}

/** `STATUS 0` con `TRACKID` es "subida aceptada" (no documento aceptado). Otro STATUS es un rechazo del sobre. */
export function leerSubida(status: number, respuesta: string): ResultadoEnvio {
  const estado = etiqueta(respuesta, 'STATUS');
  const trackId = etiqueta(respuesta, 'TRACKID');
  if (status === 200 && estado === '0' && trackId) return { estado: 'recibido', trackId, respuesta };
  if (status === 200 && estado !== null) return { estado: 'rechazado', status: estado, respuesta };
  // Un 5xx o un cuerpo sin STATUS no dice si el sobre quedó en el SII.
  return { estado: 'incierto', error: `HTTP ${status} sin STATUS legible: ${respuesta}` };
}
