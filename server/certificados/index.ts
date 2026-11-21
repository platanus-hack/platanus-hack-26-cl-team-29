// Certificado digital de cada negocio, conectado desde WhatsApp con un link privado. API pública del módulo:
// fuera de server/certificados/ se importa solo este archivo.
//
// El link es de un uso, vence en 15 minutos y aguanta 5 intentos fallidos. La página sube el .pfx y su clave a nuestro servidor; se abren para
// validarlos (clave, vigencia) y sacar el RUT del titular, se guardan cifrados (SII_LLAVE_CIFRADO) y se avisa al agente
// de WhatsApp, que sigue el registro con ese RUT. Ni el archivo ni la clave pasan por el chat ni salen en respuestas.
import { randomBytes } from 'node:crypto';
import express from 'express';
import type pg from 'pg';
import { abrirCertificado } from '../sii/index.ts';
import { cifrar, descifrar, llaveDesdeEnv } from '../conexion-sii/index.ts';
import { crearLimitador } from '../limite.ts';
import { crearAlmacenMemoria, crearAlmacenPostgres, type AlmacenCertificados } from './almacen.ts';
import { paginaInvalida, paginaSubida } from './pagina.ts';

const VIGENCIA_LINK_MS = 15 * 60_000;
/** Intentos fallidos (clave mala, archivo equivocado) antes de que el link muera. */
const MAX_INTENTOS = 5;
/** Links nuevos por teléfono cada 10 minutos; pasado eso se repite el último, para no llenar la memoria de links. */
const MAX_LINKS = 5;
const VENTANA_LINKS_MS = 10 * 60_000;
/** Un .pfx real pesa unos pocos KB; esto deja holgura sin aceptar cualquier cosa. */
const MAX_PFX_BASE64 = 200_000;

export interface Certificados {
  /** Rutas de la página y la subida. Montar antes de `express.json()` y del fallback del front. */
  readonly rutas: express.Router;
  /** Link privado de un uso para ese teléfono. */
  enlace(telefono: string): string;
  /** Se llama cuando un certificado queda conectado, con el teléfono que pidió el link y el RUT del titular. */
  alConectar(oyente: (telefono: string, rut: string) => void | Promise<void>): void;
  /** Para el módulo del SII: el certificado de un RUT (aceptar o reclamar a su nombre). `null` si no lo conectó. */
  certificadoDe(rut: string): Promise<{ pfx: Buffer; clave: string; rut: string; venceEl: Date } | null>;
}

export interface OpcionesCertificados {
  readonly db?: pg.Pool | null;
  readonly env?: NodeJS.ProcessEnv;
  readonly almacen?: AlmacenCertificados;
  readonly log?: Pick<Console, 'info' | 'warn' | 'error'>;
}

class ErrorSubida extends Error {
  readonly status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

interface Link {
  readonly telefono: string;
  readonly vence: number;
  intentos: number;
  /** Hay una subida en curso con este link. */
  enUso: boolean;
}

const LINK_MUERTO = 'Este link ya no sirve. Pide otro en WhatsApp escribiendo "conectar certificado".';

const enmascarar = (telefono: string) => `***${telefono.slice(-3)}`;

export async function crearCertificados(o: OpcionesCertificados = {}): Promise<Certificados> {
  const env = o.env ?? process.env;
  const log = o.log ?? console;
  const almacen = o.almacen ?? (await almacenPara(o.db ?? null, log));
  const tokens = new Map<string, Link>();
  const ultimoLink = new Map<string, string>();
  const cabeLink = crearLimitador(MAX_LINKS, VENTANA_LINKS_MS);
  const oyentes: ((telefono: string, rut: string) => void | Promise<void>)[] = [];
  const base = (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');

  function tokenVigente(token: string) {
    const t = tokens.get(token);
    if (t && t.vence > Date.now()) return t;
    tokens.delete(token);
    return null;
  }

  /**
   * Toma el link en el mismo paso en que se valida (sin esperas entre medio): si llegan dos subidas a la vez,
   * solo una pasa y la otra recibe 409. Si la subida falla, el link se devuelve con un intento menos.
   */
  async function subir(token: string, pfxBase64: unknown, clave: unknown): Promise<string> {
    const t = tokenVigente(token);
    if (!t) throw new ErrorSubida(410, LINK_MUERTO);
    if (t.enUso) throw new ErrorSubida(409, 'Ya estamos revisando tu certificado. Espera un momento.');
    t.enUso = true;
    try {
      const rut = await conectar(t, pfxBase64, clave);
      tokens.delete(token);
      for (const oyente of oyentes) {
        Promise.resolve().then(() => oyente(t.telefono, rut)).catch(e => log.error('[certificados] falló el aviso:', e instanceof Error ? e.message : e));
      }
      return rut;
    } catch (error) {
      t.enUso = false;
      // Solo cuentan los errores de quien sube (clave, archivo); una falla nuestra no le gasta intentos.
      if (!(error instanceof ErrorSubida) || error.status >= 500 || ++t.intentos < MAX_INTENTOS) throw error;
      tokens.delete(token);
      throw new ErrorSubida(410, `${error.message} Este link ya no acepta más intentos. Pide otro en WhatsApp escribiendo "conectar certificado".`);
    }
  }

  async function conectar(t: Link, pfxBase64: unknown, clave: unknown): Promise<string> {
    if (typeof pfxBase64 !== 'string' || !pfxBase64) throw new ErrorSubida(400, 'Sube el archivo .pfx de tu certificado digital.');
    if (pfxBase64.length > MAX_PFX_BASE64) throw new ErrorSubida(413, 'El archivo es demasiado grande para ser un certificado .pfx.');
    if (typeof clave !== 'string' || !clave) throw new ErrorSubida(400, 'Escribe la clave de tu certificado.');
    let cert: ReturnType<typeof abrirCertificado>;
    try {
      cert = abrirCertificado(Buffer.from(pfxBase64, 'base64'), clave);
    } catch {
      throw new ErrorSubida(400, 'No pudimos abrir el certificado. Revisa que sea el .pfx correcto y su clave.');
    }
    if (cert.venceEl.getTime() <= Date.now()) {
      throw new ErrorSubida(400, `El certificado venció el ${cert.venceEl.toISOString().slice(0, 10)}. Sube uno vigente.`);
    }
    let llave: Buffer;
    try {
      llave = llaveDesdeEnv(env);
    } catch (error) {
      log.error('[certificados] no se puede cifrar:', error instanceof Error ? error.message : error);
      throw new ErrorSubida(503, 'No podemos guardar certificados en este momento. Intenta más tarde.');
    }
    await almacen.guardar({ rut: cert.rut, telefono: t.telefono, cifrado: cifrar(llave, JSON.stringify({ pfxBase64, clave })), venceEl: cert.venceEl });
    log.info(`[certificados] ${enmascarar(t.telefono)} conectó su certificado (vence ${cert.venceEl.toISOString().slice(0, 10)})`);
    return cert.rut;
  }

  const rutas = express.Router();
  rutas.get('/certificado/:token', (req, res) => {
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
    res.type('html').send(tokenVigente(req.params.token) ? paginaSubida(req.params.token) : paginaInvalida());
  });
  rutas.post('/api/certificado/:token', express.json({ limit: '300kb' }), async (req, res) => {
    try {
      const cuerpo = (req.body ?? {}) as { pfxBase64?: unknown; clave?: unknown };
      await subir(req.params.token, cuerpo.pfxBase64, cuerpo.clave);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof ErrorSubida) {
        res.status(error.status).json({ error: 'certificado', mensaje: error.message });
        return;
      }
      log.error('[certificados] falló la subida:', error instanceof Error ? error.message : error);
      res.status(500).json({ error: 'certificado', mensaje: 'No se pudo conectar el certificado. Intenta de nuevo.' });
    }
  });

  return {
    rutas,
    enlace(telefono) {
      const digitos = telefono.replace(/\D/g, '');
      const ultimo = ultimoLink.get(digitos);
      if (!cabeLink(digitos) && ultimo && tokenVigente(ultimo)) return `${base}/certificado/${ultimo}`;
      for (const [k, t] of tokens) if (t.vence <= Date.now()) tokens.delete(k);
      const token = randomBytes(18).toString('base64url');
      tokens.set(token, { telefono: digitos, vence: Date.now() + VIGENCIA_LINK_MS, intentos: 0, enUso: false });
      ultimoLink.set(digitos, token);
      return `${base}/certificado/${token}`;
    },
    alConectar(oyente) {
      oyentes.push(oyente);
    },
    async certificadoDe(rut) {
      const c = await almacen.buscar(rut);
      if (!c) return null;
      const { pfxBase64, clave } = JSON.parse(descifrar(llaveDesdeEnv(env), c.cifrado)) as { pfxBase64: string; clave: string };
      return { pfx: Buffer.from(pfxBase64, 'base64'), clave, rut: c.rut, venceEl: c.venceEl };
    },
  };
}

async function almacenPara(db: pg.Pool | null, log: Pick<Console, 'error'>): Promise<AlmacenCertificados> {
  if (db) {
    try {
      return await crearAlmacenPostgres(db);
    } catch (error) {
      log.error('[certificados] no se pudo usar Postgres, sigo en memoria', error);
    }
  }
  return crearAlmacenMemoria();
}
