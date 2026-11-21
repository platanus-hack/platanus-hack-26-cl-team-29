// Crédito Bando: API pública del módulo. Fuera de server/pagos/ se importa solo este archivo.
// Decisión: docs/decisiones/20261121-2018-credito-bando.md
//
// GET  /api/pagos/yo                 → ResumenComprador (sesión de comprador): nivel, cupo, deuda, tarjeta y créditos.
// POST /api/pagos/yo/tarjeta         → { token, url } para inscribir la tarjeta en Transbank (POST de TBK_TOKEN a url).
// ALL  /api/pagos/tarjeta/vuelta     → vuelta de Transbank (TBK_TOKEN) → redirige a /app#credito.
// GET  /api/pagos/resumen            → totales de la ronda para las pantallas, sin nombres ni RUT.
// POST /api/pagos/demo/cobrar        → (x-demo-token) cobra ya todo lo pendiente: adelanta el tiempo en la demo.
// `red:evento`: credito.otorgado, credito.cobrado, tarjeta.inscrita.
import express from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { ivaDe } from '../../shared/precios.ts';
import { crearLibro, tablaMemoria, tablaPostgres, type AvisoCredito, type Credito, type Libro, type Tabla, type Tarjeta } from './credito.ts';
import { pasarelaDesdeEnv, type PasarelaTarjetas } from './oneclick.ts';
import { mismoSecreto, type Documento, type EventoRed, type Red, type Sesiones } from '../red/index.ts';

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
  const libro = await crearLibro({ ...tablas, pasarela, avisar: a => o.emitir(evento(a)) });

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
  const revisar = setInterval(() => void libro.cobrarVencidos().catch(error => console.error('[pagos] cobro de vencidos', error)), REVISAR_CADA_MS);
  revisar.unref();

  function rutas(sesiones: Sesiones) {
    const r = express.Router();
    /** El comprador con sesión y RUT, o responde 401. */
    const comprador = (req: Request, res: Response) => {
      const s = sesiones.buscar(/^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1]);
      const n = s && o.red.negocioPorId(s.negocioId);
      if (!n?.rut) res.status(401).json({ error: 'no_autorizado', mensaje: 'Necesitas iniciar sesión con tu RUT' });
      return n?.rut ? n : null;
    };

    r.get('/yo', (req, res) => {
      const n = comprador(req, res);
      if (n) res.json({ ...libro.resumen(n.rut!), ambiente: pasarela.ambiente });
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
    // La pasarela falsa: sin formulario, inscribe y vuelve al tiro.
    r.post('/tarjeta/falsa', express.urlencoded({ extended: false }), (req, res) => {
      res.redirect(303, `/api/pagos/tarjeta/vuelta?TBK_TOKEN=${encodeURIComponent(String(req.body?.TBK_TOKEN ?? ''))}`);
    });
    r.all('/tarjeta/vuelta', express.urlencoded({ extended: false }), async (req, res) => {
      const token = String(req.body?.TBK_TOKEN ?? req.query.TBK_TOKEN ?? '');
      const ok = await libro.terminarInscripcion(token).catch(error => (console.error('[pagos] cierre de inscripción', error), false));
      res.redirect(303, `/app?tarjeta=${ok ? 'ok' : 'error'}#credito`);
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

  return { rutas, libro: libro as Libro, detener: () => clearInterval(revisar) };
}
