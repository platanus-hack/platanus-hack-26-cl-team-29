import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearSii } from '../server/sii/index.ts';
import type { EntradaFactura, EntradaGuia, EntradaNotaCredito, Sii } from '../server/sii/index.ts';
import { aDte, calcularTotales } from '../server/sii/dte.ts';
import { crearAlmacenFoliosMemoria, crearSiiReal } from '../server/red/index.ts';
import { veredictoDelSobre } from '../server/red/sii-real.ts';
import type { AlmacenFolios, DatosEmision, Documento, Negocio, OrdenCompra } from '../server/red/index.ts';
import { generarCaf, RUT_EMPRESA } from './sii-apoyo.ts';

const silencioso = { info() {}, warn() {}, error() {} };
const caf = (tipo: number, desde: number, hasta: number) => generarCaf(tipo, { desde, hasta }).bytes.toString('base64');
const env = {
  SII_RUT_EMISOR: RUT_EMPRESA,
  SII_CAF_33_BASE64: caf(33, 10, 12),
  SII_CAF_33_LOTE: caf(33, 100, 199),
  SII_CAF_52_BASE64: caf(52, 1, 50),
  SII_CAF_61_BASE64: caf(61, 1, 50),
  SII_RUT_RECEPTOR: '11111111-1',
  SII_RECEPTOR_RAZON_SOCIAL: 'Comprador de Prueba',
  SII_RECEPTOR_GIRO: 'Comercio',
  SII_RECEPTOR_DIRECCION: 'Calle 1',
  SII_RECEPTOR_COMUNA: 'Santiago',
};

const proveedor: Negocio = { id: 'p', nombre: 'Proveedor', comuna: 'Ñuñoa', rol: 'proveedor', telefono: '' };
const comprador: Negocio = { id: 'c', nombre: 'Comprador', comuna: 'Ñuñoa', rol: 'comprador', telefono: '' };
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
    emitirFactura: e => { facturas.push(e); return base.emitirFactura(e); },
    emitirNotaCredito: e => { notas.push(e); return base.emitirNotaCredito(e); },
    ...sobrescribir,
  };
  return { sii, facturas, notas };
}

const adaptador = (sii: Sii, folios: AlmacenFolios) => crearSiiReal({ sii, folios, env, log: silencioso, seguirEnvios: false });

test('los folios avanzan por tipo desde el CAF, no se reusan tras un reinicio y se agotan con el rango', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const primero = adaptador(siiEspia().sii, folios);
  assert.equal((await primero.emitirFactura(datos('OC-1'))).folio, 10);
  assert.equal((await primero.emitirFactura(datos('OC-2'))).folio, 11);
  assert.equal((await primero.emitirGuia(datos('OC-1'))).folio, 1);

  const trasReinicio = adaptador(siiEspia().sii, folios);
  assert.equal((await trasReinicio.emitirFactura(datos('OC-3'))).folio, 12);
  await assert.rejects(trasReinicio.emitirFactura(datos('OC-4')), /no tiene folios libres/);
});

test('un folio que falla antes de subir queda usado: el reintento toma el siguiente', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const falla = adaptador(siiEspia({ emitirFactura: async () => { throw new Error('token rechazado'); } }).sii, folios);
  await assert.rejects(falla.emitirFactura(datos('OC-1')), /token rechazado/);
  assert.equal((await folios.buscar(33, 10))?.estado, 'fallido');
  assert.equal((await adaptador(siiEspia().sii, folios).emitirFactura(datos('OC-1'))).folio, 11);
});

test('un envío incierto no se reenvía ni toma otro folio, y se revisa con QueryEstDte', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const { sii, facturas } = siiEspia();
  const conCorte = adaptador({
    ...sii,
    emitirFactura: async e => ({ ...(await sii.emitirFactura(e)), envio: { estado: 'incierto', error: 'ECONNRESET' } }),
  }, folios);
  const { impreso, ...r } = await conCorte.emitirFactura(datos('OC-1'));
  assert.deepEqual(r, { folio: 10, trackId: '', estadoSii: 'incierto' });
  assert.equal(impreso?.folio, 10, 'el documento se armó: trae su representación impresa');

  // Otro intento para la misma orden (por ejemplo tras un reinicio) no sube nada ni gasta un folio.
  assert.deepEqual(await adaptador(sii, folios).emitirFactura(datos('OC-1')), r);
  assert.equal(facturas.length, 1);
  assert.equal(await folios.buscar(33, 11), undefined);

  // En el SII falso el sobre sí llegó: QueryEstDte responde DOK, el folio pasa a recibido y se avisa a la red.
  const cambios: unknown[] = [];
  conCorte.alCambiarEstado?.(c => cambios.push(c));
  const { estado, registro } = await conCorte.consultarDocumento(33, 10);
  assert.equal(estado.codigo, 'DOK');
  assert.equal(registro.estado, 'recibido');
  assert.deepEqual(cambios, [{ tipo: 33, folio: 10, estadoSii: 'recibido' }]);
});

test('la factura lleva la OC como referencia 801, la guía lo despachado y la nota de crédito corrige la 33 por lo que faltó', async () => {
  const { sii, facturas, notas } = siiEspia();
  const guias: EntradaGuia[] = [];
  const folios = crearAlmacenFoliosMemoria();
  const adapt = adaptador({ ...sii, emitirGuia: e => { guias.push(e); return sii.emitirGuia(e); } }, folios);

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
  const espia: Sii = { ...sii, emitirFacturas: e => { lotes.push([...e]); return sii.emitirFacturas(e); } };
  const adapt = crearSiiReal({ sii: espia, folios, env: { ...env, SII_CAF_33_BASE64: env.SII_CAF_33_LOTE }, log: silencioso, seguirEnvios: false });

  const suelta = await adapt.emitirFactura(datos('OC-2'));
  const r = await adapt.emitirFacturas(['OC-1', 'OC-2', 'OC-3', 'OC-4'].map(datos));
  assert.equal(lotes.length, 1, 'una sola subida');
  assert.deepEqual(lotes[0]!.map(e => e.folio), [101, 102, 103], 'OC-2 ya tenía su factura y no va en el sobre');
  assert.ok(lotes[0]!.every(e => e.receptor.rut === '11111111-1'), 'en certificación todas van al receptor del entorno');
  assert.deepEqual(r.map(x => x.folio), [101, suelta.folio, 102, 103]);
  assert.equal(new Set([r[0]!.trackId, r[2]!.trackId, r[3]!.trackId]).size, 1, 'mismo track id para el sobre');
  assert.equal((await folios.buscar(33, 103))?.estado, 'recibido');
});

test('un lote que falla antes de subir deja todos sus folios usados y el reintento toma folios nuevos', async () => {
  const folios = crearAlmacenFoliosMemoria();
  const falla = crearSiiReal({
    sii: siiEspia({ emitirFacturas: async () => { throw new Error('token rechazado'); } }).sii,
    folios, env: { ...env, SII_CAF_33_BASE64: env.SII_CAF_33_LOTE }, log: silencioso, seguirEnvios: false,
  });
  await assert.rejects(falla.emitirFacturas([datos('OC-1'), datos('OC-2')]), /token rechazado/);
  assert.equal((await folios.buscar(33, 100))?.estado, 'fallido');
  assert.equal((await folios.buscar(33, 101))?.estado, 'fallido');
  const ok = crearSiiReal({ sii: siiEspia().sii, folios, env: { ...env, SII_CAF_33_BASE64: env.SII_CAF_33_LOTE }, log: silencioso, seguirEnvios: false });
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
