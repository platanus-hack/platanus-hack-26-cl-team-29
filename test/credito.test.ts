import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineaDeCredito, vencimiento } from '../shared/credito.ts';
import { crearLibro, crearPasarelaFalsa, tablaMemoria, type Credito, type Tarjeta } from '../server/pagos/index.ts';
import { crearOneclick } from '../server/pagos/oneclick.ts';

test('el cupo y el plazo suben con los pagos a tiempo y bajan con un atraso', () => {
  assert.deepEqual([lineaDeCredito({ pagadosATiempo: 0, atrasados: 0 }).cupo, lineaDeCredito({ pagadosATiempo: 0, atrasados: 0 }).plazoDias], [500_000, 30]);
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
  assert.deepEqual([c?.plazoDias, c?.venceEn, c?.estado, !!c?.pagadoAlProveedorEn], [30, '2026-12-21', 'vigente', false]);
  assert.equal(await libro.otorgar(factura(1)), null, 'una factura abre un solo crédito');
  assert.equal((await libro.otorgar(factura(2, 600_000)))?.plazoDias, 0, 'lo que no cabe en el cupo se cobra hoy');

  assert.deepEqual(await libro.cobrarVencidos(true), { cobrados: 0, fallidos: 0 }, 'al adelantar el tiempo, a quien no tiene tarjeta no se le intenta cobrar');
  assert.deepEqual(await libro.cobrarVencidos(), { cobrados: 0, fallidos: 1 }, 'lo vencido hoy sí se intenta (y falla sin tarjeta)');
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

test('sin tarjeta inscrita no se entra a una compra: el mensaje trae el enlace firmado; con tarjeta, entra', async () => {
  const { crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } = await import('../server/red/index.ts');
  const { sembrarSiVacio } = await import('../server/red/semilla.ts');
  const { iniciarPagos } = await import('../server/pagos/index.ts');
  const { consultaConFicha } = await import('./sii-apoyo.ts');
  const { digitoVerificador } = await import('../shared/rut.ts');
  const ENV = { DEMO_TELEFONO_PROVEEDOR: '+56 9 0000 0099', PUBLIC_URL: 'https://bando.test' };
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date('2026-11-21T15:00:00Z'), ENV);
  let antes: (n: Parameters<NonNullable<Parameters<typeof crearRed>[0]['antesDeEntrar']>>[0]) => void = () => {};
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: ENV, consultarContribuyente: consultaConFicha, antesDeEntrar: n => antes(n) });
  const enviados: string[] = [];
  const pagos = await iniciarPagos({ db: null, red, emitir: () => {}, env: ENV, pasarela: crearPasarelaFalsa(), enviar: async (_t, texto) => void enviados.push(texto) });
  antes = pagos.exigirTarjeta;
  // Datos ficticios: RUT generado, teléfono de prueba.
  const uno = { telefono: '56911110001', nombre: 'Almacén Uno', rut: `30111001-${digitoVerificador('30111001')}` };
  await assert.rejects(red.actualizarCarrito(LICITACION_SALA, { ...uno, items: [{ productoId: 'rollos', cantidad: 2 }] }),
    (e: Error & { codigo?: string }) => e.codigo === 'falta_tarjeta' && e.message.includes('https://bando.test/api/pagos/inscribir/'));
  const n = red.estadoDeLaRed().negocios.find(x => x.telefono === uno.telefono)!;
  const { token } = await pagos.libro.iniciarInscripcion(n.rut!, 'http://x/vuelta');
  await pagos.libro.terminarInscripcion(token);
  const r = await red.actualizarCarrito(LICITACION_SALA, { ...uno, items: [{ productoId: 'rollos', cantidad: 2 }] });
  assert.equal(r.participante?.nombre, 'Almacén Uno');
  assert.ok(enviados.some(t => t.startsWith('Tarjeta inscrita: Visa terminada en 6623')), 'se le avisa por WhatsApp');
  pagos.detener();
});

test('se recuerda una sola vez 3 días antes, y el cobro avisa cuando sube de nivel', async () => {
  let ahora = Date.parse('2026-11-21T15:00:00Z');
  const cobrados: (string | null)[] = [];
  const libro = await crearLibro({
    tarjetas: tablaMemoria<Tarjeta>(), creditos: tablaMemoria<Credito>(), pasarela: crearPasarelaFalsa(),
    avisar: a => { if (a.tipo === 'credito.cobrado') cobrados.push(a.subioA); }, ahora: () => new Date(ahora),
  });
  const rut = '76000000-0';
  for (const n of [1, 2, 3]) await libro.otorgar({ rut, negocioId: 'n', proveedorId: 'p', ordenId: `o${n}`, documentoId: `d${n}`, monto: 10_000 });
  assert.equal((await libro.porRecordar()).length, 0, 'faltan 30 días');
  ahora += 27 * 86_400_000;
  assert.equal((await libro.porRecordar()).length, 3);
  assert.equal((await libro.porRecordar()).length, 0, 'una sola vez');
  const { token } = await libro.iniciarInscripcion(rut, 'x');
  await libro.terminarInscripcion(token);
  await libro.cobrarVencidos(true);
  assert.deepEqual(cobrados, [null, null, 'Confiable']);
});

test('los avisos de WhatsApp dicen monto, proveedor, fecha y tarjeta', async () => {
  const a = await import('../server/pagos/avisos.ts');
  const d = { monto: 114_240, proveedor: 'Distribuidora Sur', venceEn: '2026-12-21', plazoDias: 30, tarjeta: 'Visa terminada en 6623' };
  assert.equal(a.creditoOtorgado(d), 'Bando le paga $114.240 a Distribuidora Sur por ti. Tú pagas el 21-12-2026, solo, con tu Visa terminada en 6623.');
  assert.match(a.cobrado({ ...d, disponible: 300_000, subioA: 'Confiable' }), /Cupo disponible: \$300\.000\. Subiste a Confiable/);
  assert.match(a.pagoPorTransferir({ monto: 114_240, folio: 1234, conCuenta: false, panel: 'https://bando.test/proveedor' }), /^Bando te paga \$114\.240 por la factura folio 1234[\s\S]*Deja tu cuenta[\s\S]*bando\.test\/proveedor$/);
  assert.equal(a.pagoTransferido({ monto: 114_240, folio: 1234, cuenta: 'BancoEstado · Cuenta vista o RUT terminada en 6789' }), 'Bando te transfirió $114.240 por la factura folio 1234 a tu BancoEstado · Cuenta vista o RUT terminada en 6789.');
});

test('el proveedor ve lo que Bando le paga por cada factura, sin datos del comprador', async () => {
  const libro = await crearLibro({
    tarjetas: tablaMemoria<Tarjeta>(), creditos: tablaMemoria<Credito>(), pasarela: crearPasarelaFalsa(),
    avisar: () => {}, ahora: () => new Date('2026-11-21T15:00:00Z'),
  });
  await libro.otorgar({ rut: '76000000-0', negocioId: 'n-1', proveedorId: 'p-1', ordenId: 'o-1', documentoId: 'd-1', monto: 59_500 });
  await libro.otorgar({ rut: '76000000-0', negocioId: 'n-1', proveedorId: 'p-2', ordenId: 'o-2', documentoId: 'd-2', monto: 10_000 });
  assert.deepEqual(libro.pagosAlProveedor('p-1'), [{ ordenId: 'o-1', documentoId: 'd-1', monto: 59_500, en: '2026-11-21T15:00:00.000Z', transferido: false }]);
});

test('el pago al proveedor queda por transferir hasta que el equipo lo marca; se marca una sola vez', async () => {
  const avisos: string[] = [];
  const libro = await crearLibro({ tarjetas: tablaMemoria<Tarjeta>(), creditos: tablaMemoria<Credito>(), pasarela: crearPasarelaFalsa(), avisar: a => avisos.push(a.tipo) });
  const c = (await libro.otorgar({ rut: '76000000-0', negocioId: 'n', proveedorId: 'p', ordenId: 'o', documentoId: 'd', monto: 10_000 }))!;
  assert.deepEqual(libro.porTransferir().map(x => x.id), [c.id]);
  assert.equal(libro.pagosAlProveedor('p')[0]?.transferido, false);
  assert.ok(await libro.marcarTransferido(c.id, ' 123456 '));
  assert.equal(await libro.marcarTransferido(c.id), null, 'no se marca dos veces');
  assert.deepEqual([libro.porTransferir().length, libro.pagosAlProveedor('p')[0]?.transferido, libro.transferidos()[0]?.comprobante], [0, true, '123456']);
  assert.ok(avisos.includes('proveedor.pagado'));
});

test('la cuenta del proveedor se valida igual en la web y en el servidor', async () => {
  const { validarCuenta, cuentaCorta } = await import('../shared/cuenta-bancaria.ts');
  const { digitoVerificador } = await import('../shared/rut.ts');
  // Datos ficticios: RUT generado y número de cuenta inventado.
  const rut = `30111001-${digitoVerificador('30111001')}`;
  const ok = validarCuenta({ banco: 'BancoEstado', tipo: 'vista', numero: '123-456-789', rutTitular: rut, titular: ' Almacén Uno ' });
  assert.deepEqual(typeof ok === 'object' && [ok.numero, ok.titular, cuentaCorta(ok)], ['123456789', 'Almacén Uno', 'BancoEstado · Cuenta vista o RUT terminada en 6789']);
  assert.equal(validarCuenta({ banco: 'Banco Inventado', tipo: 'vista', numero: '1234', rutTitular: rut, titular: 'X' }), 'Elige tu banco de la lista.');
  assert.equal(validarCuenta({ banco: 'BancoEstado', tipo: 'vista', numero: '12ab', rutTitular: rut, titular: 'X' }), 'El número de cuenta lleva solo dígitos (entre 4 y 20).');
});
