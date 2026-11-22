import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirReposicion, demandaManual, demandaParaTener, esperaTrasFallo, minimoDeFolios, type Situacion } from '../shared/folios.ts';
import { crearPortalConexion, crearReposicion, GESTION_INICIAL } from '../server/conexion-sii/index.ts';
import type { FuenteFolios, GestionFolios, PortalConexion } from '../server/conexion-sii/index.ts';
import * as portalSii from '../server/sii-portal/index.ts';
import { ErrorPortal, type PortalSii } from '../server/sii-portal/index.ts';

const silencioso = { info() {}, warn() {}, error() {} };
const HOY = '2026-11-21';
const MINUTO = 60_000;

const situacion = (s: Partial<Situacion> = {}): Situacion => ({
  tipo: 33, libres: 0, demanda: 0, tieneCaf: true, esperaHasta: null, ahora: 0, quedanReobtenibles: null, tope: null, ...s,
});

test('política: mínimo de facturas max(10, demanda + 5); guía y nota solo con CAF; reobtener antes de pedir y nunca sobre el tope', () => {
  assert.equal(minimoDeFolios(33, 0), 10);
  assert.equal(minimoDeFolios(33, 12), 17);
  assert.equal(minimoDeFolios(61, 2), 5);
  assert.deepEqual(decidirReposicion(situacion({ libres: 10 })), { accion: 'nada', motivo: 'suficiente', minimo: 10 });
  assert.deepEqual(decidirReposicion(situacion({ tipo: 52, tieneCaf: false })), { accion: 'nada', motivo: 'sin_caf', minimo: 5 });
  assert.deepEqual(decidirReposicion(situacion({ libres: 4 })), { accion: 'reobtener', faltan: 6, minimo: 10 });
  assert.deepEqual(decidirReposicion(situacion({ libres: 4, quedanReobtenibles: false })), { accion: 'pedir', cantidad: 6, minimo: 10 });
  assert.deepEqual(decidirReposicion(situacion({ libres: 4, quedanReobtenibles: false, tope: 2 })), { accion: 'pedir', cantidad: 2, minimo: 10 });
  assert.deepEqual(decidirReposicion(situacion({ quedanReobtenibles: false, tope: 0 })), { accion: 'sin_cupo', minimo: 10 });
  assert.deepEqual(decidirReposicion(situacion({ esperaHasta: 5, ahora: 1 })), { accion: 'esperar', hasta: 5, minimo: 10 });
  // "Traer más folios" con el mínimo cubierto trae un lote del tamaño del piso, no más.
  assert.equal(minimoDeFolios(33, demandaManual(33, 30)) - 30, 10);
  assert.equal(minimoDeFolios(52, demandaManual(52, 8)) - 8, 5);
});

test('política: la espera tras un fallo se duplica con tope de un día, y un rechazo espera más que una falla pasajera', () => {
  assert.equal(esperaTrasFallo('rechazo', 1), 60 * MINUTO);
  assert.equal(esperaTrasFallo('rechazo', 2), 120 * MINUTO);
  assert.equal(esperaTrasFallo('transitorio', 1), 15 * MINUTO);
  assert.equal(esperaTrasFallo('rechazo', 30), 24 * 60 * MINUTO);
});

interface Rango { tipo: number; desde: number; hasta: number; cantidad: number; fecha: string }

/** Fuente en memoria: CAF guardados por tipo con su primer libre, y la gestión. */
function fuenteFalsa(usados = new Set<number>()) {
  const cafs: { tipo: number; desde: number; hasta: number; primerLibre: number }[] = [];
  const gestiones = new Map<number, GestionFolios>();
  const consultados: number[] = [];
  const fuente: FuenteFolios = {
    credenciales: async () => ({ certificado: { pfx: Buffer.alloc(0), clave: '' }, rutEmpresa: '22222222-2' }),
    rangos: async tipo => cafs.filter(c => c.tipo === tipo),
    libres: async tipo => cafs.filter(c => c.tipo === tipo).reduce((n, c) => n + c.hasta - c.primerLibre + 1, 0),
    async guardarCaf(xml, primerLibre) {
      const [, tipo, desde, hasta] = /TD(\d+) D(\d+) H(\d+)/.exec(xml)!.map(Number);
      cafs.push({ tipo: tipo!, desde: desde!, hasta: hasta!, primerLibre: primerLibre === 'nuevo' ? desde! : primerLibre });
    },
    gestion: async tipo => structuredClone(gestiones.get(tipo) ?? GESTION_INICIAL),
    guardarGestion: async (tipo, g) => { gestiones.set(tipo, structuredClone(g)); },
    consultarFolio: async (_tipo, folio) => {
      consultados.push(folio);
      return { codigo: usados.has(folio) ? 'DNK' : 'FAU', detalle: '' };
    },
  };
  return { fuente, cafs, consultados };
}

/** Portal falso a nivel de operaciones: rangos reobtenibles, tope y pedidos; anota cada llamada. */
function portalFalso(o: { rangos?: Rango[]; tope?: number | null; bloqueo?: string } = {}) {
  const llamadas: string[] = [];
  let siguiente = 900;
  const portal: PortalConexion = {
    ficha: async () => { throw new Error('no se usa'); },
    resolucion: async () => { throw new Error('no se usa'); },
    reobtenibles: async (_c, _r, tipo, max = 15, incluir = () => true) => {
      llamadas.push('listar');
      return (o.rangos ?? []).filter(r => r.tipo === tipo && incluir(r)).slice(0, max);
    },
    reobtener: async (_c, _r, rango) => {
      llamadas.push(`reobtener ${rango.desde}-${rango.hasta}`);
      return `TD${rango.tipo} D${rango.desde} H${rango.hasta}`;
    },
    tope: async () => {
      llamadas.push('tope');
      if (o.bloqueo) throw new ErrorPortal('TIMBRAJE_BLOQUEADO', 'El SII no autoriza folios nuevos de este tipo por ahora.', { mensajeSii: o.bloqueo });
      return { maximo: o.tope ?? null, disponibles: 0 };
    },
    pedir: async (_c, _r, tipo, cantidad) => {
      llamadas.push(`pedir ${cantidad}`);
      const desde = siguiente + 1;
      siguiente += cantidad;
      return `TD${tipo} D${desde} H${siguiente}`;
    },
  };
  return { portal, llamadas };
}

function montar(o: Parameters<typeof portalFalso>[0] = {}, usados?: Set<number>) {
  const f = fuenteFalsa(usados);
  const p = portalFalso(o);
  let ahora = Date.UTC(2026, 10, 21, 15);
  const reposicion = crearReposicion({
    fuente: f.fuente, portal: p.portal, log: silencioso, hoy: () => HOY, ahora: () => ahora, esperar: async ms => { ahora += ms; },
  });
  return { ...f, ...p, reposicion, avanzar: (ms: number) => { ahora += ms; } };
}

const rango = (desde: number, hasta: number, fecha = HOY): Rango => ({ tipo: 33, desde, hasta, cantidad: hasta - desde + 1, fecha });

test('reobtiene del rango más nuevo al más viejo y no pide folios nuevos si la reobtención cubre el mínimo', async () => {
  const { reposicion, llamadas, cafs } = montar({ rangos: [rango(200, 209), rango(300, 309), rango(100, 104)] }, new Set([300, 301]));
  const f = await reposicion.reponer(33);
  assert.deepEqual(llamadas, ['listar', 'reobtener 300-309', 'reobtener 200-209']);
  assert.deepEqual(cafs.map(c => [c.desde, c.primerLibre]), [[300, 302], [200, 200]], 'solo desde el primer libre que dijo el SII');
  assert.equal(f.libres, 18);
  assert.equal(f.estado, 'suficiente');
  assert.ok(!llamadas.some(x => x.startsWith('pedir') || x === 'tope'));
});

test('sin nada que reobtener lee el tope y pide solo lo que falta, nunca más que el tope', async () => {
  const conTope = montar({ tope: 4 });
  await conTope.reposicion.reponer(33);
  assert.deepEqual(conTope.llamadas, ['listar', 'tope', 'pedir 4']);
  const sinTope = montar({ tope: null });
  await sinTope.reposicion.reponer(33, { demanda: 12 });
  assert.deepEqual(sinTope.llamadas, ['listar', 'tope', 'pedir 17']);
});

test('antes de facturar: repone primero y deja pasar; si aun así no alcanza, falla con el texto del SII y en espera', async () => {
  const ok = montar({ tope: 20 });
  await ok.reposicion.asegurar(33, 12);
  assert.ok(ok.llamadas.includes('pedir 17'));

  const bloqueo = 'NO SE AUTORIZA TIMBRAJE. Usted tiene disponible una cantidad de folios suficiente.';
  const malo = montar({ bloqueo });
  await assert.rejects(malo.reposicion.asegurar(33, 3), (e: Error & { codigo?: string }) =>
    e.codigo === 'sin_folios' && /se necesitan 3 folios y quedan 0.*No se envió nada al SII.*NO SE AUTORIZA TIMBRAJE/s.test(e.message));
  // En espera: el siguiente intento no toca el SII.
  const antes = malo.llamadas.length;
  await assert.rejects(malo.reposicion.asegurar(33, 3), /NO SE AUTORIZA TIMBRAJE/);
  assert.equal(malo.llamadas.length, antes);
  assert.equal((await malo.reposicion.estado(33)).estado, 'en_espera');
  // Pasada la espera (una hora tras el primer rechazo) se vuelve a intentar.
  malo.avanzar(61 * MINUTO);
  await assert.rejects(malo.reposicion.asegurar(33, 3));
  assert.ok(malo.llamadas.length > antes);
});

test('después de emitir repone en segundo plano y avisa sin textos del SII', async () => {
  const { reposicion } = montar({ tope: 10 });
  const avisos: unknown[] = [];
  reposicion.escuchar(a => avisos.push(a));
  reposicion.enFondo(33);
  await new Promise(r => setTimeout(r, 5));
  await reposicion.esperarCorridas();
  assert.deepEqual(avisos.at(-1), { tipo: 33, libres: 10, minimo: 10, estado: 'suficiente', repuestos: 10 });
  assert.ok(avisos.some(a => (a as { estado: string }).estado === 'reponiendo'));
});

test('anular no existe: ni el portal ni la conexión tienen cómo hacerlo', () => {
  const conexion = crearPortalConexion({} as PortalSii);
  assert.ok(!Object.keys(conexion).some(k => /anul/i.test(k)));
  assert.ok(!Object.keys(portalSii).some(k => /anul/i.test(k)));
});

test('el objetivo de la operación deja exactamente esos folios libres como mínimo', () => {
  assert.equal(minimoDeFolios(33, demandaParaTener(33, 200)), 200, 'factura: el margen de 5 no se suma dos veces');
  assert.equal(minimoDeFolios(52, demandaParaTener(52, 200)), 200);
  assert.equal(minimoDeFolios(61, demandaParaTener(61, 50)), 50);
  assert.equal(minimoDeFolios(33, demandaParaTener(33, 3)), 10, 'nunca bajo el piso');
});

test('rangos viejos ya gastados se descartan con una consulta cada uno y la corrida llega a pedir', async () => {
  const viejos = Array.from({ length: 15 }, (_, i) => rango(1000 + i * 100, 1099 + i * 100, '2026-11-01'));
  const usados = new Set(viejos.flatMap(r => Array.from({ length: 100 }, (_, k) => r.desde + k)));
  const { reposicion, llamadas, consultados } = montar({ rangos: viejos, tope: null }, usados);
  await reposicion.reponer(33, { demanda: 195, conexion: true });
  assert.equal(consultados.length, 15, 'solo el último folio de cada rango');
  assert.ok(!llamadas.some(x => x.startsWith('reobtener')), 'nada que reobtener');
  assert.equal(llamadas.at(-1), 'pedir 200', 'pide lo que falta para el objetivo');
});
