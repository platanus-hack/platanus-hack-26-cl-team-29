import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearSii } from '../server/sii/index.ts';
import type { EntradaFactura, EntradaGuia, EntradaNotaCredito, ResultadoEnvio, Sii } from '../server/sii/index.ts';
import { aDte, calcularTotales } from '../server/sii/dte.ts';
import { crearAlmacenFoliosMemoria, crearRed, crearRepositorioMemoria, crearSiiReal, foliosLibres, siguienteFolio } from '../server/red/index.ts';
import { veredictoDelSobre } from '../server/red/sii-real.ts';
import type { AlmacenFolios, CambioEstadoSii, DatosEmision, Documento, Negocio, OrdenCompra } from '../server/red/index.ts';
import { RUT_EMPRESA } from './sii-apoyo.ts';

const silencioso = { info() {}, warn() {}, error() {} };
/** Rangos de folios de la conexión, por tipo (los CAF no importan: el SII del módulo es el falso). */
const RANGOS: Record<number, { desde: number; hasta: number }[]> = { 33: [{ desde: 10, hasta: 12 }], 52: [{ desde: 1, hasta: 50 }], 61: [{ desde: 1, hasta: 50 }] };
const LOTE: Record<number, { desde: number; hasta: number }[]> = { ...RANGOS, 33: [{ desde: 100, hasta: 199 }] };
const rangosDe = (r: Record<number, { desde: number; hasta: number }[]>) => (tipo: number) => r[tipo] ?? [];

const proveedor: Negocio = { id: 'p', nombre: 'Proveedor', comuna: 'Ñuñoa', rol: 'proveedor', telefono: '' };
const comprador: Negocio = {
  id: 'c', nombre: 'Comprador', comuna: 'Ñuñoa', rol: 'comprador', telefono: '', rut: '11111111-1',
  contribuyente: { razonSocial: 'Comprador de Prueba', giro: 'Comercio', direccion: 'Calle 1', comuna: 'Santiago', actividades: [] },
};
const orden = (id: string): OrdenCompra => ({
  id, compradorId: 'c', proveedorId: 'p', estado: 'confirmada', creadaEn: '2026-11-21T15:00:00.000Z',
  items: [{ producto: 'Harina 25 kg', cantidad: 4, precioUnitario: 20000, cantidadDespachada: 2 }],
});
const datos = (id: string): DatosEmision => ({ orden: orden(id), emisor: proveedor, receptor: comprador });

/** El SII falso del módulo, anotando cada emisión que le llega. */
function siiEspia(sobrescribir: Partial<Sii> = {}) {
  const facturas: EntradaFactura[] = [];
  const notas: EntradaNotaCredito[] = [];
  const base = crearSii({ env: { SII_RUT_EMISOR: RUT_EMPRESA }, log: silencioso });
  const sii: Sii = {
    ...base,
    prepararFactura: e => { facturas.push(e); return base.prepararFactura(e); },
    prepararNotaCredito: e => { notas.push(e); return base.prepararNotaCredito(e); },
    ...sobrescribir,
  };
  return { sii, facturas, notas };
}

const adaptador = (sii: Sii, folios: AlmacenFolios) => crearSiiReal({ sii, folios, rangos: rangosDe(RANGOS), log: silencioso, seguirEnvios: false });

test('los folios avanzan por tipo desde el CAF, no se reusan tras un reinicio y se agotan con el rango', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const primero = adaptador(siiEspia().sii, folios);
  assert.equal((await primero.emitirFactura(datos('OC-1'))).folio, 10);
  assert.equal((await primero.emitirFactura(datos('OC-2'))).folio, 11);
  assert.equal((await primero.emitirGuia(datos('OC-1'))).folio, 1);

  const trasReinicio = adaptador(siiEspia().sii, folios);
  assert.equal((await trasReinicio.emitirFactura(datos('OC-3'))).folio, 12);
  await assert.rejects(trasReinicio.emitirFactura(datos('OC-4')), /no tienen folios libres/);
});

test('un folio que falla antes de subir queda usado: el reintento toma el siguiente', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const falla = adaptador(siiEspia({ prepararFactura: async () => { throw new Error('CAF ilegible'); } }).sii, folios);
  await assert.rejects(falla.emitirFactura(datos('OC-1')), /CAF ilegible/);
  assert.equal((await folios.buscar(33, 10))?.estado, 'fallido');
  assert.equal((await adaptador(siiEspia().sii, folios).emitirFactura(datos('OC-1'))).folio, 11);
});

test('un envío incierto no se reenvía ni toma otro folio, y se revisa con QueryEstDte', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const { sii, facturas } = siiEspia();
  const conCorte = adaptador({
    ...sii,
    prepararFactura: async e => ({ ...(await sii.prepararFactura(e)), subir: async () => ({ estado: 'incierto', error: 'ECONNRESET' }) }),
  }, folios);
  const cambios: CambioEstadoSii[] = [];
  conCorte.alCambiarEstado?.(c => cambios.push(c));
  const { impreso, ...r } = await conCorte.emitirFactura(datos('OC-1'));
  assert.deepEqual(r, { folio: 10, trackId: '', estadoSii: 'enviando' });
  assert.equal(impreso?.folio, 10, 'el documento se armó: trae su representación impresa');
  await conCorte.subidasTerminadas();
  assert.deepEqual(cambios, [{ tipo: 33, folio: 10, ordenId: 'OC-1', estadoSii: 'incierto', detalle: 'ECONNRESET' }]);

  // Otro intento para la misma orden (por ejemplo tras un reinicio) no sube nada ni gasta un folio.
  assert.deepEqual(await adaptador(sii, folios).emitirFactura(datos('OC-1')), { folio: 10, trackId: '', estadoSii: 'incierto' });
  assert.equal(facturas.length, 1);
  assert.equal(await folios.buscar(33, 11), undefined);

  // El SII falso nunca recibió el sobre (la subida se cortó): QueryEstDte responde FAU y queda para una persona.
  cambios.length = 0;
  const { estado, registro } = await conCorte.consultarDocumento(33, 10);
  assert.equal(estado.codigo, 'FAU');
  assert.equal(registro.estado, 'no_recibido');
  assert.deepEqual(cambios.map(c => c.estadoSii), ['no_recibido']);
});

/** Un SII cuya subida tarda `ms` (como maullin lento) y responde `envio`; cuenta las subidas. */
function siiConSubida(ms: number, envio?: ResultadoEnvio | Error) {
  const { sii } = siiEspia();
  let subidas = 0;
  const demorar = <T,>(subir: () => Promise<T>) => async () => {
    subidas++;
    await new Promise(r => setTimeout(r, ms));
    if (envio instanceof Error) throw envio;
    return envio ?? subir();
  };
  const lento: Sii = {
    ...sii,
    prepararFacturas: async e => { const l = await sii.prepararFacturas(e); return { ...l, subir: demorar(l.subir) as typeof l.subir }; },
    prepararGuia: async e => { const d = await sii.prepararGuia(e); return { ...d, subir: demorar(d.subir) as typeof d.subir }; },
  };
  return { sii: lento, subidas: () => subidas };
}

test('facturar no espera al SII: el lote vuelve firmado y con PDF al instante, y la subida lo pasa a recibido en vivo', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const { sii, subidas } = siiConSubida(300);
  const adapt = crearSiiReal({ sii, folios, rangos: rangosDe(LOTE), log: silencioso, seguirEnvios: false });
  const cambios: CambioEstadoSii[] = [];
  adapt.alCambiarEstado?.(c => cambios.push(c));

  const inicio = Date.now();
  const r = await adapt.emitirFacturas(['OC-1', 'OC-2'].map(datos));
  const ms = Date.now() - inicio;
  assert.ok(ms < 150, `volvió en ${ms} ms, sin esperar los 300 ms de la subida`);
  assert.deepEqual(r.map(x => [x.folio, x.estadoSii, x.impreso?.folio]), [[100, 'enviando', 100], [101, 'enviando', 101]]);
  assert.equal((await folios.buscar(33, 100))?.estado, 'enviando');

  await adapt.subidasTerminadas();
  assert.equal(subidas(), 1, 'una sola subida para el sobre');
  const recibidos = await Promise.all([100, 101].map(f => folios.buscar(33, f)));
  assert.deepEqual(recibidos.map(x => x?.estado), ['recibido', 'recibido']);
  assert.equal(new Set(recibidos.map(x => x?.trackId)).size, 1, 'mismo track id para el sobre');
  assert.deepEqual(cambios.map(c => [c.folio, c.estadoSii, !!c.trackId]), [[100, 'recibido', true], [101, 'recibido', true]]);
});

test('una subida rechazada o que falla queda así en cada folio, se avisa y no se reintenta sola', async () => {
  const rechazo: ResultadoEnvio = { estado: 'rechazado', status: '3', respuesta: '<STATUS>3</STATUS>' };
  for (const [envio, estado] of [[rechazo, 'rechazado'], [new Error('token rechazado'), 'fallido']] as const) {
    const folios = crearAlmacenFoliosMemoria();
    const { sii, subidas } = siiConSubida(20, envio);
    const adapt = crearSiiReal({ sii, folios, rangos: rangosDe(RANGOS), log: silencioso, seguirEnvios: false });
    const cambios: CambioEstadoSii[] = [];
    adapt.alCambiarEstado?.(c => cambios.push(c));
    assert.equal((await adapt.emitirGuia(datos('OC-1'))).estadoSii, 'enviando');
    await adapt.subidasTerminadas();
    await new Promise(r => setTimeout(r, 60));
    assert.equal(subidas(), 1, `${estado}: una sola subida, sin reintento`);
    assert.equal((await folios.buscar(52, 1))?.estado, estado);
    assert.deepEqual(cambios.map(c => [c.tipo, c.folio, c.estadoSii]), [[52, 1, estado]]);
  }
});

test('un folio que quedó enviándose al reiniciar queda incierto: ni se reenvía ni toma otro', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const registro = await folios.reservar(33, RANGOS[33]!, 'OC-1');
  await folios.guardar({ ...registro, estado: 'enviando', fechaEmision: '2026-11-21', montoTotal: 95200, rutReceptor: '11111111-1' });
  const { sii, facturas } = siiEspia();
  const r = await adaptador(sii, folios).emitirFactura(datos('OC-1'));
  assert.deepEqual(r, { folio: 10, trackId: '', estadoSii: 'incierto' });
  assert.equal(facturas.length, 0, 'no se armó ni se subió nada');
  assert.equal((await folios.buscar(33, 10))?.estado, 'incierto');

  // La red, al arrancar, deja en revisión el documento que quedó "enviando al SII".
  const repo = crearRepositorioMemoria();
  await repo.guardar('documentos', { id: 'd', ordenId: 'OC-1', tipo: 33, folio: 10, trackId: '', estadoSii: 'enviando', monto: 80000, emitidoEn: '' });
  const red = await crearRed({ repo, sii: adaptador(sii, folios), env: {} });
  assert.equal(red.estadoDeLaRed().documentos[0]?.estadoSii, 'incierto');
});

test('la factura lleva la OC como referencia 801, la guía lo despachado y la nota de crédito corrige la 33 por lo que faltó', async () => {
  const { sii, facturas, notas } = siiEspia();
  const guias: EntradaGuia[] = [];
  const folios = crearAlmacenFoliosMemoria();
  const adapt = adaptador({ ...sii, prepararGuia: e => { guias.push(e); return sii.prepararGuia(e); } }, folios);

  const factura = await adapt.emitirFactura(datos('OC-1001'));
  const referencias33 = aDte.factura(facturas[0]!).referencias;
  assert.deepEqual(referencias33, [{ tipoDocumento: 801, folio: 'OC-1001', fecha: '2026-11-21' }]);
  assert.equal(facturas[0]!.receptor.rut, '11111111-1');
  assert.equal(calcularTotales(facturas[0]!.items).neto, 80000);

  await adapt.emitirGuia(datos('OC-1001'));
  assert.deepEqual(guias[0]!.items.map(i => i.cantidad), [2]);

  const documento: Documento = {
    id: 'd', ordenId: 'OC-1001', tipo: 33, folio: factura.folio, trackId: factura.trackId,
    estadoSii: factura.estadoSii, monto: 80000, emitidoEn: '2026-11-21T15:00:00.000Z',
  };
  const faltante = [{ producto: 'Harina 25 kg', cantidad: 2, precioUnitario: 20000 }];
  await adapt.emitirNotaCredito({ ...datos('OC-1001'), factura: documento, items: faltante });
  const nota = notas[0]!;
  assert.equal(calcularTotales(nota.items).neto, 40000);
  const [referencia] = aDte.notaCredito(nota).referencias;
  assert.equal(referencia?.tipoDocumento, 33);
  assert.equal(referencia?.folio, String(factura.folio));
  assert.equal(referencia?.fecha, (await folios.buscar(33, factura.folio))?.fechaEmision);
  assert.equal(referencia?.codigo, 3);
});

test('el reclamo del comprador es RFP sobre la factura 33 del emisor', async () => {
  const acciones: string[] = [];
  const { sii } = siiEspia();
  const adapt = adaptador({ ...sii, registrarAccionReceptor: async (d, a) => { acciones.push(`${a} ${d.tipo} ${d.folio} ${d.rutEmisor}`); return sii.registrarAccionReceptor(d, a); } }, crearAlmacenFoliosMemoria());
  const f = await adapt.emitirFactura(datos('OC-1'));
  const factura: Documento = { id: 'd', ordenId: 'OC-1', tipo: 33, folio: f.folio, trackId: f.trackId, estadoSii: f.estadoSii, monto: 1, emitidoEn: '' };
  assert.deepEqual(await adapt.registrarReclamo({ factura, receptor: comprador, motivo: 'Faltan 2' }), { estadoSii: 'reclamado' });
  assert.deepEqual(acciones, [`RFP 33 ${f.folio} ${RUT_EMPRESA}`]);
});

test('el lote de facturas va en una sola subida, con folios consecutivos y sin reenviar una orden que ya tiene folio', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const { sii } = siiEspia();
  const lotes: EntradaFactura[][] = [];
  const espia: Sii = { ...sii, prepararFacturas: e => { lotes.push([...e]); return sii.prepararFacturas(e); } };
  const adapt = crearSiiReal({ sii: espia, folios, rangos: rangosDe(LOTE), log: silencioso, seguirEnvios: false });

  const suelta = await adapt.emitirFactura(datos('OC-2'));
  const r = await adapt.emitirFacturas(['OC-1', 'OC-2', 'OC-3', 'OC-4'].map(datos));
  assert.equal(lotes.length, 1, 'una sola subida');
  assert.deepEqual(lotes[0]!.map(e => e.folio), [101, 102, 103], 'OC-2 ya tenía su factura y no va en el sobre');
  assert.ok(lotes[0]!.every(e => e.receptor.rut === '11111111-1'), 'cada factura va al RUT de su comprador');
  assert.deepEqual(r.map(x => x.folio), [101, suelta.folio, 102, 103]);
  await adapt.subidasTerminadas();
  const sobre = await Promise.all([101, 102, 103].map(f => folios.buscar(33, f)));
  assert.equal(new Set(sobre.map(x => x?.trackId)).size, 1, 'mismo track id para el sobre');
  assert.equal(sobre[2]?.estado, 'recibido');
});

test('un lote que falla antes de subir deja todos sus folios usados y el reintento toma folios nuevos', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const falla = crearSiiReal({
    sii: siiEspia({ prepararFacturas: async () => { throw new Error('CAF ilegible'); } }).sii,
    folios, rangos: rangosDe(LOTE), log: silencioso, seguirEnvios: false,
  });
  await assert.rejects(falla.emitirFacturas([datos('OC-1'), datos('OC-2')]), /CAF ilegible/);
  assert.equal((await folios.buscar(33, 100))?.estado, 'fallido');
  assert.equal((await folios.buscar(33, 101))?.estado, 'fallido');
  const ok = crearSiiReal({ sii: siiEspia().sii, folios, rangos: rangosDe(LOTE), log: silencioso, seguirEnvios: false });
  assert.deepEqual((await ok.emitirFacturas([datos('OC-1'), datos('OC-2')])).map(x => x.folio), [102, 103]);
});

test('el veredicto de un sobre con varios documentos es común solo si todos coinciden', () => {
  const estado = (aceptados: number, rechazados: number, reparos: number) =>
    ({ trackId: '1', codigo: 'EPR', glosa: null, respuesta: '', porTipo: [{ tipo: 33, informados: 3, aceptados, rechazados, reparos }] });
  assert.equal(veredictoDelSobre(estado(3, 0, 0), 33, 3), 'aceptado');
  assert.equal(veredictoDelSobre(estado(0, 3, 0), 33, 3), 'rechazado');
  assert.equal(veredictoDelSobre(estado(0, 0, 3), 33, 3), 'reparo');
  assert.equal(veredictoDelSobre(estado(2, 1, 0), 33, 3), undefined);
});

test('con varios CAF del tipo los folios salen en orden, rango por rango, y un hueco bajo lo tomado no se reusa', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const rangos = [{ desde: 500, hasta: 501 }, { desde: 20, hasta: 21 }, { desde: 7, hasta: 7 }];
  const adapt = crearSiiReal({ sii: siiEspia().sii, folios, rangos: () => rangos, log: silencioso, seguirEnvios: false });
  const r = await adapt.emitirFacturas(['OC-1', 'OC-2', 'OC-3', 'OC-4', 'OC-5'].map(datos));
  assert.deepEqual(r.map(x => x.folio), [7, 20, 21, 500, 501], 'el rango más bajo primero, sin repetir');
  assert.equal(foliosLibres(rangos, await folios.tomados(33)), 0);
  assert.equal(siguienteFolio([{ desde: 1, hasta: 10 }], [5]), 6, 'dentro de un rango, después del mayor tomado');
});

test('si los folios no alcanzan para todo el lote no se reserva ninguno ni se sube nada', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const { sii } = siiEspia();
  let subidas = 0;
  const espia: Sii = { ...sii, prepararFacturas: e => { subidas++; return sii.prepararFacturas(e); } };
  const adapt = crearSiiReal({ sii: espia, folios, rangos: () => [{ desde: 10, hasta: 11 }], log: silencioso, seguirEnvios: false });
  await assert.rejects(adapt.emitirFacturas(['OC-1', 'OC-2', 'OC-3'].map(datos)), (e: Error & { codigo?: string }) =>
    e.codigo === 'sin_folios' && /se necesitan 3 folios y quedan 2/.test(e.message));
  assert.equal(subidas, 0);
  assert.deepEqual(await folios.tomados(33), [], 'ningún folio quedó tomado');
});

test('un comprador sin RUT verificado no se factura: se rechaza antes de tomar folio', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const adapt = crearSiiReal({ sii: siiEspia().sii, folios, rangos: rangosDe(RANGOS), log: silencioso, seguirEnvios: false });
  const sinRut: DatosEmision = { ...datos('OC-9'), receptor: { ...comprador, nombre: 'Caro', rut: undefined, contribuyente: undefined } };
  await assert.rejects(adapt.emitirFacturas([datos('OC-1'), sinRut]), /Caro no tiene su RUT verificado/);
  await assert.rejects(adapt.emitirGuia(sinRut), /Caro no tiene su RUT verificado/);
  assert.deepEqual(await folios.tomados(33), []);
  assert.deepEqual(await folios.tomados(52), []);
});
