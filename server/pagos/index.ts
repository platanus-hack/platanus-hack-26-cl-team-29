// Crédito Bando: API pública del módulo. Fuera de server/pagos/ se importa solo este archivo.
// Decisión: docs/decisiones/20261121-2018-credito-bando.md
//
// GET  /api/pagos/yo                 → ResumenComprador (sesión de comprador): nivel, cupo, deuda, tarjeta y créditos.
// POST /api/pagos/yo/tarjeta         → { token, url } para inscribir la tarjeta en Transbank (POST de TBK_TOKEN a url).
// GET  /api/pagos/inscribir/:rut?t=  → enlace firmado (el que va por WhatsApp): abre la inscripción en Transbank sin sesión.
// ALL  /api/pagos/tarjeta/vuelta     → vuelta de Transbank (TBK_TOKEN) → /app#compra (web) o una página de listo (WhatsApp).
// GET  /api/pagos/proveedor         → (sesión de proveedor) { pagos: { ordenId, documentoId, monto, en }[] }, sin datos del comprador.
// GET  /api/pagos/resumen            → totales de la ronda para las pantallas, sin nombres ni RUT.
// POST /api/pagos/demo/cobrar        → (x-demo-token) cobra ya todo lo pendiente: adelanta el tiempo en la demo.
// `red:evento`: credito.otorgado, credito.cobrado, tarjeta.inscrita. Por WhatsApp: al comprador (crédito, recordatorio 3 días
// antes, cobro) y al proveedor (Bando te pagó). `exigirTarjeta` va en `antesDeEntrar` de la red: sin tarjeta no se entra a una
// compra (PAGOS_EXIGIR_TARJETA=0 lo apaga).
import express from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { ivaDe } from '../../shared/precios.ts';
import { puedeVender } from '../../shared/red.ts';
import { crearLibro, tablaMemoria, tablaPostgres, type AvisoCredito, type Credito, type Libro, type Tabla, type Tarjeta } from './credito.ts';
import { pasarelaDesdeEnv, type PasarelaTarjetas } from './oneclick.ts';
import { ErrorRed, mismoSecreto, tokenPdf, tokenPdfValido, type Documento, type EventoRed, type Negocio, type Red, type Sesiones } from '../red/index.ts';
import * as avisos from './avisos.ts';

export { crearLibro, historialDe, tablaMemoria } from './credito.ts';
export type { Credito, Libro, Tarjeta } from './credito.ts';
export { crearPasarelaFalsa } from './oneclick.ts';

/** Cada cuánto se buscan créditos vencidos para cobrar. */
const REVISAR_CADA_MS = 10 * 60_000;

const evento = (a: AvisoCredito): EventoRed => {
  const en = new Date().toISOString();
  if (a.tipo === 'tarjeta.inscrita') return { tipo: a.tipo, datos: {}, en };
  const c = a.credito;
  const datos = { negocioId: c.negocioId, proveedorId: c.proveedorId, ordenId: c.ordenId, monto: c.monto, plazoDias: c.plazoDias, venceEn: c.venceEn };
  return { tipo: a.tipo, datos: a.tipo === 'credito.cobrado' ? { ...datos, ok: a.ok, estado: c.estado } : datos, en };
};

export async function iniciarPagos(o: {
  db: pg.Pool | null;
  red: Pick<Red, 'escuchar' | 'estadoDeLaRed' | 'negocioPorId'>;
  emitir: (e: EventoRed) => void;
  env?: NodeJS.ProcessEnv;
  pasarela?: PasarelaTarjetas;
  /** Manda un WhatsApp. Sin él no se avisa nada. */
  enviar?: (telefono: string, texto: string) => Promise<unknown>;
}) {
  const env = o.env ?? process.env;
  let tablas: { tarjetas: Tabla<Tarjeta>; creditos: Tabla<Credito> } = { tarjetas: tablaMemoria(), creditos: tablaMemoria() };
  if (o.db) {
    try {
      tablas = { tarjetas: await tablaPostgres(o.db, 'pagos_tarjetas'), creditos: await tablaPostgres(o.db, 'pagos_creditos') };
    } catch (error) {
      console.error('[pagos] no se pudo usar Postgres, el crédito queda en memoria', error);
    }
  }
  const pasarela = o.pasarela ?? pasarelaDesdeEnv(env);
  const libro: Libro = await crearLibro({
    ...tablas, pasarela,
    avisar: a => {
      o.emitir(evento(a));
      avisarPorWhatsapp(a);
    },
  });

  // El enlace para inscribir la tarjeta sin sesión (va por WhatsApp), firmado con la misma llave que los enlaces a los PDF.
  const firma = (rut: string) => tokenPdf(`tarjeta:${rut}`, env);
  const enlaceInscripcion = (rut: string) => `${(env.PUBLIC_URL ?? '').replace(/\/+$/, '')}/api/pagos/inscribir/${encodeURIComponent(rut)}?t=${firma(rut)}`;

  const enviar = (telefono: string | undefined, texto: string) => {
    if (telefono && o.enviar) o.enviar(telefono, texto).catch(error => console.error('[pagos] no se pudo mandar el WhatsApp', error));
  };
  const nombre = (id: string) => o.red.negocioPorId(id)?.nombre ?? 'el proveedor';
  const datosDe = (c: Credito) => ({
    monto: c.monto, proveedor: nombre(c.proveedorId), venceEn: c.venceEn, plazoDias: c.plazoDias, tarjeta: avisos.textoTarjeta(libro.resumen(c.rut).tarjeta),
  });
  function avisarPorWhatsapp(a: AvisoCredito) {
    if (a.tipo === 'tarjeta.inscrita') {
      const n = o.red.estadoDeLaRed().negocios.find(x => x.rut === a.rut);
      return enviar(n?.telefono, `Tarjeta inscrita: ${avisos.textoTarjeta(a.tarjeta)}. Ya puedes comprar con Bando.`);
    }
    const c = a.credito;
    const comprador = o.red.negocioPorId(c.negocioId)?.telefono;
    if (a.tipo === 'credito.otorgado') {
      enviar(comprador, avisos.creditoOtorgado(datosDe(c)));
      const folio = o.red.estadoDeLaRed().documentos.find(d => d.id === c.documentoId)?.folio ?? null;
      return enviar(o.red.negocioPorId(c.proveedorId)?.telefono, avisos.pagoAlProveedor({ monto: c.monto, folio }));
    }
    enviar(comprador, a.ok
      ? avisos.cobrado({ ...datosDe(c), disponible: libro.resumen(c.rut).disponible, subioA: a.subioA })
      : avisos.cobroFallido(datosDe(c), enlaceInscripcion(c.rut)));
  }

  /** Para `antesDeEntrar` de la red: sin tarjeta inscrita no se entra a una compra. */
  function exigirTarjeta(n: Negocio) {
    if (env.PAGOS_EXIGIR_TARJETA === '0' || !n.rut || libro.tieneTarjeta(n.rut)) return;
    throw new ErrorRed('falta_tarjeta', avisos.faltaTarjeta(enlaceInscripcion(n.rut)));
  }

  // Cada factura emitida abre un crédito: Bando le paga al proveedor y el comprador le paga a Bando a su plazo.
  o.red.escuchar(e => {
    const doc = e.tipo === 'documento.emitido' ? (e.datos as { documento?: Documento }).documento : undefined;
    if (doc?.tipo !== 33) return;
    const orden = o.red.estadoDeLaRed().ordenes.find(x => x.id === doc.ordenId);
    const comprador = orden && o.red.negocioPorId(orden.compradorId);
    if (!orden || !comprador?.rut) return;
    libro.otorgar({ rut: comprador.rut, negocioId: comprador.id, proveedorId: orden.proveedorId, ordenId: orden.id, documentoId: doc.id, monto: doc.monto + ivaDe(doc.monto) })
      .catch(error => console.error('[pagos] no se pudo abrir el crédito', doc.id, error));
  });
  async function revisarPlazos() {
    for (const c of await libro.porRecordar()) enviar(o.red.negocioPorId(c.negocioId)?.telefono, avisos.recordatorio(datosDe(c)));
    await libro.cobrarVencidos();
  }
  const revisar = setInterval(() => void revisarPlazos().catch(error => console.error('[pagos] revisión de plazos', error)), REVISAR_CADA_MS);
  revisar.unref();

  function rutas(sesiones: Sesiones) {
    const r = express.Router();
    /** El negocio de la sesión (Bearer), si hay. */
    const deSesion = (req: Request) => {
      const s = sesiones.buscar(/^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1]);
      return s ? o.red.negocioPorId(s.negocioId) : undefined;
    };
    /** El comprador con sesión y RUT, o responde 401. */
    const comprador = (req: Request, res: Response) => {
      const n = deSesion(req);
      if (!n?.rut) res.status(401).json({ error: 'no_autorizado', mensaje: 'Necesitas iniciar sesión con tu RUT' });
      return n?.rut ? n : null;
    };

    r.get('/yo', (req, res) => {
      const n = comprador(req, res);
      if (n) res.json({ ...libro.resumen(n.rut!), ambiente: pasarela.ambiente, exigeTarjeta: env.PAGOS_EXIGIR_TARJETA !== '0' });
    });
    r.post('/yo/tarjeta', async (req, res) => {
      const n = comprador(req, res);
      if (!n) return;
      try {
        res.json(await libro.iniciarInscripcion(n.rut!, `${req.protocol}://${req.get('host')}/api/pagos/tarjeta/vuelta`));
      } catch (error) {
        console.error('[pagos] no se pudo abrir la inscripción', error);
        res.status(502).json({ error: 'pasarela', mensaje: 'Transbank no respondió. Intenta de nuevo en un rato.' });
      }
    });
    /** Tokens de inscripciones que partieron desde WhatsApp: a la vuelta no hay sesión web que mostrar. */
    const desdeWhatsapp = new Set<string>();
    r.get('/inscribir/:rut', async (req, res) => {
      const rut = String(req.params.rut);
      if (!tokenPdfValido(`tarjeta:${rut}`, req.query.t, env)) return void res.status(404).send('Enlace no válido');
      try {
        const { token, url } = await libro.iniciarInscripcion(rut, `${req.protocol}://${req.get('host')}/api/pagos/tarjeta/vuelta`);
        desdeWhatsapp.add(token);
        res.type('html').send(paginaAutoenvio(url, token));
      } catch (error) {
        console.error('[pagos] no se pudo abrir la inscripción', error);
        res.status(502).send('Transbank no respondió. Intenta de nuevo en un rato.');
      }
    });
    // La pasarela falsa: sin formulario, inscribe y vuelve al tiro.
    r.post('/tarjeta/falsa', express.urlencoded({ extended: false }), (req, res) => {
      res.redirect(303, `/api/pagos/tarjeta/vuelta?TBK_TOKEN=${encodeURIComponent(String(req.body?.TBK_TOKEN ?? ''))}`);
    });
    r.all('/tarjeta/vuelta', express.urlencoded({ extended: false }), async (req, res) => {
      const token = String(req.body?.TBK_TOKEN ?? req.query.TBK_TOKEN ?? '');
      const ok = await libro.terminarInscripcion(token).catch(error => (console.error('[pagos] cierre de inscripción', error), false));
      if (desdeWhatsapp.delete(token)) return void res.type('html').send(paginaListo(ok));
      res.redirect(303, `/app?tarjeta=${ok ? 'ok' : 'error'}#${ok ? 'compra' : 'credito'}`);
    });
    r.get('/proveedor', (req, res) => {
      const n = deSesion(req);
      if (!n || !puedeVender(n)) return void res.status(401).json({ error: 'no_autorizado', mensaje: 'Necesitas iniciar sesión como proveedor' });
      res.json({ pagos: libro.pagosAlProveedor(n.id) });
    });
    r.get('/resumen', (_req, res) => {
      res.json({ ...libro.totales(new Set(o.red.estadoDeLaRed().negocios.map(n => n.id))), ambiente: pasarela.ambiente });
    });
    r.post('/demo/cobrar', async (req, res) => {
      if (!env.DEMO_TOKEN) return void res.status(404).json({ error: 'no_encontrado', mensaje: 'Ruta no disponible' });
      if (!mismoSecreto(req.get('x-demo-token'), env.DEMO_TOKEN)) return void res.status(403).json({ error: 'token_invalido', mensaje: 'x-demo-token no coincide' });
      res.json(await libro.cobrarVencidos(true));
    });
    return r;
  }

  return { rutas, libro, exigirTarjeta, detener: () => clearInterval(revisar) };
}

const escapar = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const pagina = (cuerpo: string) =>
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bando</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#1a1a1a;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px">${cuerpo}</body></html>`;

/** Página que manda sola el token a Transbank (Transbank lo pide por POST de formulario). */
const paginaAutoenvio = (url: string, token: string) => pagina(
  `<form method="post" action="${escapar(url)}"><input type="hidden" name="TBK_TOKEN" value="${escapar(token)}"><p>Abriendo Transbank para inscribir tu tarjeta...</p><button>Continuar</button></form><script>document.forms[0].submit()</script>`,
);

const paginaListo = (ok: boolean) => pagina(ok
  ? '<div><p style="font-size:24px;font-weight:800">Tarjeta inscrita</p><p>Vuelve a WhatsApp y manda tu pedido.</p></div>'
  : '<div><p style="font-size:24px;font-weight:800">No se inscribió</p><p>Vuelve a WhatsApp y pide el enlace de nuevo.</p></div>');
