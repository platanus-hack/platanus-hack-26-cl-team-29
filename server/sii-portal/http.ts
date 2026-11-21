// Transporte HTTPS hacia el portal del SII. Reglas aplicadas (ver docs/hallazgos, reglas del portal del SII):
// - Cabeceras de un navegador real, en su orden; `Origin` y `Cache-Control` solo en POST. Un solo User-Agent.
// - Tope de conexión (10 s) y de respuesta (60 s). Sin reintentos ocultos: la política vive en `portal.ts`.
// - El error dice si la solicitud alcanzó a salir (`llego`): solo lo que nunca llegó al SII se puede repetir sin riesgo.
// - `herculesr` (login) pide el certificado de cliente en el handshake; los demás hosts no.
// - El cuerpo se decodifica como lo declara la respuesta y, si no declara, como ISO-8859-1 (el portal no lo declara).
import { constants } from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TOPE_CONEXION_MS = 10_000;
const TOPE_RESPUESTA_MS = 60_000;

export interface PeticionHttp {
  metodo: 'GET' | 'POST';
  url: string;
  /** Cabeceras en el orden en que viajan. */
  cabeceras: [string, string][];
  cuerpo?: string;
  /** Presentar el certificado de cliente (solo el login en herculesr). */
  conCertificado: boolean;
}

export interface RespuestaHttp {
  metodo: 'GET' | 'POST';
  url: string;
  estado: number;
  /** `Location`, si la hay. */
  ubicacion: string | null;
  setCookie: string[];
  tipoContenido: string;
  cuerpo: string;
}

/** Credencial TLS del certificado: hoja más la cadena que traiga el .pfx, y la llave, en PEM. */
export interface CredencialTls {
  cert: string;
  key: string;
}

export type Http = (peticion: PeticionHttp, credencial: CredencialTls) => Promise<RespuestaHttp>;

export class ErrorTransporte extends Error {
  readonly causa: string;
  /** false si la solicitud nunca salió (DNS, conexión rechazada, handshake): repetirla no abre nada en el SII. */
  readonly llego: boolean;
  constructor(mensaje: string, causa: string, llego: boolean) {
    super(mensaje);
    this.name = 'ErrorTransporte';
    this.causa = causa;
    this.llego = llego;
  }
}

export interface OpcionesCabeceras {
  metodo: 'GET' | 'POST';
  cookies?: string;
  referer?: string;
  origen?: string;
}

/** Cabeceras de Chrome capturadas del portal, en su orden. */
export function cabecerasNavegador(o: OpcionesCabeceras): [string, string][] {
  const post = o.metodo === 'POST';
  const c: [string, string][] = [];
  if (post) c.push(['cache-control', 'max-age=0']);
  c.push(['upgrade-insecure-requests', '1']);
  if (post && o.origen) c.push(['origin', o.origen]);
  if (post) c.push(['content-type', 'application/x-www-form-urlencoded']);
  c.push(
    ['user-agent', USER_AGENT],
    ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'],
    ['sec-fetch-site', o.referer ? 'same-site' : 'none'],
    ['sec-fetch-mode', 'navigate'],
    ['sec-fetch-user', '?1'],
    ['sec-fetch-dest', 'document'],
  );
  if (o.referer) c.push(['referer', o.referer]);
  c.push(['accept-encoding', 'gzip, deflate, br'], ['accept-language', 'es-419,es;q=0.9']);
  if (o.cookies) c.push(['cookie', o.cookies]);
  return c;
}

function descomprimir(datos: Buffer, codificacion: string): Buffer {
  if (codificacion === 'gzip') return zlib.gunzipSync(datos);
  if (codificacion === 'deflate') return zlib.inflateSync(datos);
  if (codificacion === 'br') return zlib.brotliDecompressSync(datos);
  return datos;
}

/** Lo declarado manda; sin declaración, ISO-8859-1, salvo el login (`herculesr`), que responde UTF-8 sin declararlo. */
function decodificarCuerpo(datos: Buffer, tipoContenido: string, host: string): string {
  if (/charset=utf-?8/i.test(tipoContenido) || (!/charset=/i.test(tipoContenido) && host === 'herculesr.sii.cl')) return datos.toString('utf8');
  return datos.toString('latin1');
}

const opcionesTls = {
  // Configuración probada contra herculesr con certificado de cliente.
  maxVersion: 'TLSv1.2' as const,
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT | constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
};

/** Transporte real con `node:https`. Un agente por solicitud: las cookies las lleva quien llama. */
export const httpNode: Http = (p, credencial) => {
  const destino = new URL(p.url);
  if (destino.protocol !== 'https:' || !destino.hostname.endsWith('.sii.cl')) {
    return Promise.reject(new ErrorTransporte(`Solo se habla con el SII por HTTPS: ${destino.host}`, 'destino', false));
  }
  const agente = new https.Agent(p.conCertificado ? { ...opcionesTls, cert: credencial.cert, key: credencial.key } : {});
  const cabeceras: Record<string, string> = {};
  for (const [nombre, valor] of p.cabeceras) cabeceras[nombre] = valor;
  if (p.cuerpo !== undefined) cabeceras['content-length'] = String(Buffer.byteLength(p.cuerpo, 'latin1'));
  return new Promise<RespuestaHttp>((resolver, rechazar) => {
    let conectado = false;
    const req = https.request(p.url, { method: p.metodo, headers: cabeceras, agent: agente, timeout: TOPE_CONEXION_MS }, res => {
      const partes: Buffer[] = [];
      res.on('data', (parte: Buffer) => partes.push(parte));
      res.on('error', e => rechazar(new ErrorTransporte(`Se cortó la respuesta de ${destino.host}`, e.message, true)));
      res.on('end', () => {
        try {
          const tipoContenido = String(res.headers['content-type'] ?? '');
          const datos = descomprimir(Buffer.concat(partes), String(res.headers['content-encoding'] ?? '').toLowerCase());
          const setCookie = res.headers['set-cookie'] ?? [];
          resolver({
            metodo: p.metodo,
            url: p.url,
            estado: res.statusCode ?? 0,
            ubicacion: typeof res.headers.location === 'string' ? res.headers.location : null,
            setCookie: Array.isArray(setCookie) ? setCookie : [setCookie],
            tipoContenido,
            cuerpo: decodificarCuerpo(datos, tipoContenido, destino.hostname),
          });
        } catch (e) {
          rechazar(new ErrorTransporte(`Respuesta ilegible de ${destino.host}`, (e as Error).message, true));
        }
      });
    });
    req.on('socket', socket => {
      socket.once('secureConnect', () => {
        conectado = true;
        socket.setTimeout(TOPE_RESPUESTA_MS);
      });
    });
    req.on('timeout', () => req.destroy(new Error(conectado ? 'tiempo de respuesta agotado' : 'tiempo de conexión agotado')));
    req.on('error', e => rechazar(new ErrorTransporte(`No hubo respuesta de ${destino.host}: ${e.message}`, (e as NodeJS.ErrnoException).code ?? e.message, conectado)));
    if (p.cuerpo !== undefined) req.write(p.cuerpo, 'latin1');
    req.end();
  }).finally(() => agente.destroy());
};

/**
 * `application/x-www-form-urlencoded` con percent-encoding de bytes ISO-8859-1, nunca `encodeURIComponent` (UTF-8):
 * los formularios `cvc_cgi` son Latin-1. Un carácter fuera de Latin-1 es un error, no se recorta.
 */
export function codificarFormulario(campos: [string, string][]): string {
  const uno = (texto: string) => {
    let salida = '';
    for (const c of texto) {
      const codigo = c.codePointAt(0) ?? 0;
      if (codigo > 0xff) throw new Error(`El campo tiene un carácter que no existe en ISO-8859-1: ${c}`);
      salida += /[A-Za-z0-9\-_.~]/.test(c) ? c : `%${codigo.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return salida;
  };
  return campos.map(([n, v]) => `${uno(n)}=${uno(v)}`).join('&');
}

/** Suma los `Set-Cookie` a las cookies actuales (`nombre=valor; ...`). Respeta los borrados por `Max-Age` o `Expires` vencido. */
export function unirCookies(actual: string, setCookie: string[]): string {
  const jar = new Map<string, string>();
  for (const par of actual.split(';')) {
    const i = par.indexOf('=');
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
  for (const linea of setCookie) {
    const [par = '', ...atributos] = linea.split(';');
    const i = par.indexOf('=');
    if (i <= 0) continue;
    const nombre = par.slice(0, i).trim();
    const borrar = atributos.some(a => {
      const [n = '', v = ''] = a.split('=').map(t => t.trim());
      return (/^max-age$/i.test(n) && Number(v) <= 0) || (/^expires$/i.test(n) && Date.parse(v) < Date.UTC(1980, 0, 1));
    });
    if (borrar) jar.delete(nombre);
    else jar.set(nombre, par.slice(i + 1).trim());
  }
  return [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
}

export const tieneSesion = (cookies: string): boolean => /(^|;\s*)NETSCAPE_LIVEWIRE\./.test(cookies);

/** Respuesta redactada para registros: sin cookies, sin llaves privadas de CAF (`RSASK`), sin la clave de un solo uso. */
export function redactar(cuerpo: string): string {
  return cuerpo
    .replace(/<RSASK>[\s\S]*?<\/RSASK>/gi, '<RSASK>[redactado]</RSASK>')
    .replace(/(NETSCAPE_LIVEWIRE\.[a-z]+=)[^;"'\s]*/gi, '$1[redactado]')
    .replace(/(name\s*=\s*["']?key["']?[^>]*value\s*=\s*["']?)[^"'\s>]*/gi, '$1[redactado]');
}
