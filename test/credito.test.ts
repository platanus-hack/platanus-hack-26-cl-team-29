import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineaDeCredito, vencimiento } from '../shared/credito.ts';
import { crearLibro, crearPasarelaFalsa, tablaMemoria, type Credito, type Tarjeta } from '../server/pagos/index.ts';
import { crearOneclick } from '../server/pagos/oneclick.ts';

test('el cupo y el plazo suben con los pagos a tiempo y bajan con un atraso', () => {
  assert.deepEqual([lineaDeCredito({ pagadosATiempo: 0, atrasados: 0 }).cupo, lineaDeCredito({ pagadosATiempo: 0, atrasados: 0 }).plazoDias], [300_000, 30]);
  assert.equal(lineaDeCredito({ pagadosATiempo: 2, atrasados: 0 }).siguiente?.faltan, 1);
  assert.equal(lineaDeCredito({ pagadosATiempo: 3, atrasados: 0 }).nombre, 'Confiable');
  assert.equal(lineaDeCredito({ pagadosATiempo: 9, atrasados: 0 }).plazoDias, 60);
  assert.equal(lineaDeCredito({ pagadosATiempo: 9, atrasados: 1 }).nombre, 'Confiable', 'un atraso resta 3: baja de Socio a Confiable');
  assert.equal(vencimiento('2026-11-21T15:00:00Z', 30), '2026-12-21');
});

test('al facturar, Bando paga al proveedor y abre el crédito; al cobrar con tarjeta, la confianza sube', async () => {
  const avisos: string[] = [];
  const libro = await crearLibro({
    tarjetas: tablaMemoria<Tarjeta>(), creditos: tablaMemoria<Credito>(), pasarela: crearPasarelaFalsa(),
    avisar: a => avisos.push(a.tipo), ahora: () => new Date('2026-11-21T15:00:00Z'),
  });
  const rut = '76000000-0';
  const factura = (n: number, monto = 50_000) => ({ rut, negocioId: 'n-1', proveedorId: 'p-1', ordenId: `o-${n}`, documentoId: `d-${n}`, monto });

  const c = await libro.otorgar(factura(1));
  assert.deepEqual([c?.plazoDias, c?.venceEn, c?.estado, !!c?.pagadoAlProveedorEn], [30, '2026-12-21', 'vigente', true]);
  assert.equal(await libro.otorgar(factura(1)), null, 'una factura abre un solo crédito');
  assert.equal((await libro.otorgar(factura(2, 400_000)))?.plazoDias, 0, 'lo que no cabe en el cupo se cobra hoy');

  assert.deepEqual(await libro.cobrarVencidos(true), { cobrados: 0, fallidos: 2 }, 'sin tarjeta no se cobra');
  const { token } = await libro.iniciarInscripcion(rut, 'http://x/vuelta');
  assert.equal(await libro.terminarInscripcion(token), true);
  assert.deepEqual(libro.resumen(rut).tarjeta, { marca: 'Visa', ultimos4: '6623' });

  for (const n of [3, 4]) await libro.otorgar(factura(n));
  const r = await libro.cobrarVencidos(true);
  assert.equal(r.cobrados, 4);
  // Los 3 de 30 días se pagaron antes de vencer; el que vencía hoy, también: 4 a tiempo → Confiable.
  assert.deepEqual([libro.resumen(rut).linea.nombre, libro.resumen(rut).deuda], ['Confiable', 0]);
  assert.ok(avisos.includes('credito.otorgado') && avisos.includes('credito.cobrado') && avisos.includes('tarjeta.inscrita'));
  assert.deepEqual(libro.totales(new Set(['n-1'])).porCobrar, 0);
  assert.equal(libro.totales(new Set(['otro'])).creditos, 0, 'la sala cuenta solo los negocios de la ronda');
});

test('Oneclick: inscribe y cobra con los encabezados y el cuerpo que pide Transbank', async () => {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const respuestas = [
    { token: 't1', url_webpay: 'https://tbk/inscribir' },
    { response_code: 0, tbk_user: 'u1', card_type: 'Visa', card_number: 'XXXXXXXXXXXX6623' },
    { details: [{ status: 'AUTHORIZED', response_code: 0, authorization_code: '1213' }] },
    { details: [{ status: 'FAILED', response_code: -1 }] },
  ];
  const pedir = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(respuestas.shift()), { status: 200 });
  }) as typeof fetch;
  const tbk = crearOneclick({ base: 'https://tbk', comercio: '597055555541', tienda: '597055555542', llave: 'k' }, 'integracion', pedir);
  assert.deepEqual(await tbk.iniciarInscripcion({ usuario: 'u', email: 'u@x.cl', volverA: 'https://app/vuelta' }), { token: 't1', url: 'https://tbk/inscribir' });
  assert.deepEqual(await tbk.terminarInscripcion('t1'), { tbkUser: 'u1', marca: 'Visa', ultimos4: '6623' });
  assert.equal(await tbk.cobrar({ usuario: 'u', tbkUser: 'u1', ordenCompra: 'oc1', monto: 59_500 }), '1213');
  await assert.rejects(tbk.cobrar({ usuario: 'u', tbkUser: 'u1', ordenCompra: 'oc2', monto: 1 }), /rechazado/);
  assert.equal(llamadas[1]!.init.method, 'PUT');
  assert.match(llamadas[1]!.url, /\/inscriptions\/t1$/);
  assert.equal((llamadas[0]!.init.headers as Record<string, string>)['Tbk-Api-Key-Id'], '597055555541');
  const cuerpo = JSON.parse(String(llamadas[2]!.init.body));
  assert.deepEqual(cuerpo.details, [{ commerce_code: '597055555542', buy_order: 'oc1-1', amount: 59_500, installments_number: 1 }]);
});
