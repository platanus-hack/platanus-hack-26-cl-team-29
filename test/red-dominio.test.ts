import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, COMPRADOR_DEMO, PROVEEDOR_DEMO } from '../server/red/index.ts';
import type { EventoRed, Red } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

// Estos tests recorren la demo con sus negocios ficticios (sin DEMO_FICTICIOS la red parte vacía).
process.env.DEMO_FICTICIOS = '1';

async function redDePrueba(reloj: { ahora: Date }) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, reloj.ahora);
  const red = await crearRed({ repo, sii: crearSiiFalso(), reloj: () => reloj.ahora });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos, repo };
}

const pedirHarina = (red: Red) => red.crearOrden({
  compradorId: COMPRADOR_DEMO, proveedorId: PROVEEDOR_DEMO,
  items: [{ producto: 'Harina 25 kg', cantidad: 10, precioUnitario: 18000 }],
});

test('la orden avanza enviada, facturada, recibida y emite factura 33 y guía 52', async () => {
  const { red, eventos } = await redDePrueba({ ahora: new Date('2026-11-21T15:00:00Z') });
  const orden = await pedirHarina(red);
  assert.equal(orden.estado, 'enviada');

  assert.equal((await red.confirmarOrden(orden.id)).estado, 'facturada');
  const docs = red.estadoDeLaRed().documentos.filter(d => d.ordenId === orden.id);
  assert.deepEqual(docs.map(d => d.tipo), [33, 52]);
  assert.equal(docs[0].monto, 180000);

  assert.equal((await red.registrarRecepcion(orden.id, { conforme: true })).estado, 'recibida');
  assert.deepEqual(eventos.map(e => e.tipo), [
    'orden.creada', 'orden.confirmada', 'documento.emitido', 'documento.emitido', 'recepcion.registrada', 'nota.cambiada',
  ]);
});

test('rechaza transiciones inválidas sin tocar el SII', async () => {
  const { red } = await redDePrueba({ ahora: new Date() });
  const orden = await pedirHarina(red);
  await assert.rejects(red.registrarRecepcion(orden.id, { conforme: true }), { codigo: 'transicion_invalida' });
  await assert.rejects(red.emitirNotaCredito(orden.id), { codigo: 'transicion_invalida' });
  await red.confirmarOrden(orden.id);
  await assert.rejects(red.confirmarOrden(orden.id), { codigo: 'transicion_invalida' });
  await assert.rejects(red.registrarRecepcion(orden.id, { faltante: 11 }), { codigo: 'datos_invalidos' });
  assert.equal(red.estadoDeLaRed().documentos.filter(d => d.ordenId === orden.id).length, 2);
  await assert.rejects(red.confirmarOrden('OC-9999'), { codigo: 'no_encontrado' });
});

test('un faltante registra el reclamo y baja la nota; la nota de crédito del mismo día la recupera en parte', async () => {
  const reloj = { ahora: new Date('2026-11-21T15:00:00Z') };
  const { red, eventos } = await redDePrueba(reloj);
  const inicial = red.notaDeProveedor(PROVEEDOR_DEMO);
  const orden = await pedirHarina(red);
  await red.confirmarOrden(orden.id);
  eventos.length = 0;

  const reclamada = await red.registrarRecepcion(orden.id, { faltante: 2 });
  assert.equal(reclamada.estado, 'reclamada');
  assert.equal(reclamada.reclamo?.faltante, 2);
  const conReclamo = red.notaDeProveedor(PROVEEDOR_DEMO);
  assert.ok(conReclamo < inicial);
  assert.deepEqual(eventos.map(e => e.tipo), ['recepcion.registrada', 'reclamo.registrado', 'nota.cambiada']);
  assert.deepEqual(eventos[2].datos, { proveedorId: PROVEEDOR_DEMO, anterior: inicial, nota: conReclamo });

  reloj.ahora = new Date('2026-11-21T20:00:00Z');
  const nc = await red.emitirNotaCredito(orden.id);
  assert.equal(nc.tipo, 61);
  assert.equal(nc.monto, 36000);
  const corregida = red.notaDeProveedor(PROVEEDOR_DEMO);
  assert.ok(corregida > conReclamo && corregida < inicial, `${conReclamo} < ${corregida} < ${inicial}`);
  assert.equal(red.estadoDeLaRed().ordenes.find(o => o.id === orden.id)?.estado, 'corregida');
});

test('la nota de crédito de otro día no recupera la nota', async () => {
  const reloj = { ahora: new Date('2026-11-21T15:00:00Z') };
  const { red } = await redDePrueba(reloj);
  const orden = await pedirHarina(red);
  await red.confirmarOrden(orden.id);
  await red.registrarRecepcion(orden.id, { faltante: 1 });
  const conReclamo = red.notaDeProveedor(PROVEEDOR_DEMO);
  reloj.ahora = new Date('2026-11-23T15:00:00Z');
  await red.emitirNotaCredito(orden.id);
  assert.equal(red.notaDeProveedor(PROVEEDOR_DEMO), conReclamo);
});

test('estadoDeLaRed entrega la foto completa y no se puede alterar desde afuera', async () => {
  const { red } = await redDePrueba({ ahora: new Date() });
  const foto = red.estadoDeLaRed();
  assert.equal(foto.negocios.length, 12);
  // Todos los que venden, también el proveedor de la compra y sus competidores: una sola nota para todas las vistas.
  assert.deepEqual(foto.notas, {
    [PROVEEDOR_DEMO]: 4.7, 'n-molinos-del-sur': 4.6, 'n-harinas-andes': 4.5, 'n-distribuidora-sur': 4.4,
    'n-proveedor-demo': 4.8, 'n-papelera-central': 4.6, 'n-insumos-del-sur': 4.5, 'n-rollos-express': 4.4,
  });
  assert.equal(foto.licitaciones[0].estado, 'abierta');
  foto.negocios.length = 0;
  assert.equal(red.estadoDeLaRed().negocios.length, 12);
});

test('negocioPorTelefono encuentra el negocio aunque el número venga con otro formato', async () => {
  const { red } = await redDePrueba({ ahora: new Date() });
  assert.equal(red.negocioPorTelefono('56900000011')?.id, COMPRADOR_DEMO);
  assert.equal(red.negocioPorTelefono('+56 9 0000 0001')?.id, PROVEEDOR_DEMO);
  assert.equal(red.negocioPorTelefono('56999999999'), null);
});

test('el producto en texto libre se normaliza y el precio lo pone el proveedor', async () => {
  const { red } = await redDePrueba({ ahora: new Date() });
  const orden = await red.crearOrden({ compradorId: COMPRADOR_DEMO, proveedorId: 'n-molinos-del-sur', items: [{ producto: 'sacos de harina', cantidad: 4 }] });
  assert.deepEqual(orden.items, [{ producto: 'Harina 25 kg', cantidad: 4, precioUnitario: 17100 }]);
  await assert.rejects(
    red.crearOrden({ compradorId: COMPRADOR_DEMO, proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'bicicletas', cantidad: 1 }] }),
    { codigo: 'datos_invalidos' },
  );
});

test('la guía de un despacho parcial dice menos que la orden y la factura', async () => {
  const { red } = await redDePrueba({ ahora: new Date() });
  const orden = await red.crearOrden({ compradorId: COMPRADOR_DEMO, proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'harina', cantidad: 4 }] });
  await red.fijarDespacho(orden.id, 2);
  const facturada = await red.confirmarOrden(orden.id);
  assert.equal(facturada.items[0].cantidadDespachada, 2);
  const [factura, guia] = red.estadoDeLaRed().documentos.filter(d => d.ordenId === orden.id);
  assert.deepEqual([factura.tipo, factura.monto, guia.tipo, guia.monto], [33, 72000, 52, 36000]);
  await assert.rejects(red.fijarDespacho(orden.id, 1), { codigo: 'transicion_invalida' });
});

test('un reclamo baja a Molinos 0,4 (del segundo al cuarto lugar) y la nota de crédito del mismo día recupera 0,2', async () => {
  const { red } = await redDePrueba({ ahora: new Date('2026-11-21T15:00:00Z') });
  // El ranking de los proveedores de harina (los de la sala tienen su propia historia).
  const HARINA = new Set([PROVEEDOR_DEMO, 'n-molinos-del-sur', 'n-harinas-andes', 'n-distribuidora-sur']);
  const ranking = () => Object.entries(red.estadoDeLaRed().notas).filter(([id]) => HARINA.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  assert.equal(ranking().indexOf('n-molinos-del-sur'), 1);
  const orden = await red.crearOrden({ compradorId: COMPRADOR_DEMO, proveedorId: 'n-molinos-del-sur', items: [{ producto: 'harina', cantidad: 4 }] });
  await red.confirmarOrden(orden.id);
  await red.registrarRecepcion(orden.id, { faltante: 2 });
  assert.equal(red.notaDeProveedor('n-molinos-del-sur'), 4.2);
  assert.equal(ranking().indexOf('n-molinos-del-sur'), 3);
  await red.emitirNotaCredito(orden.id);
  assert.equal(red.notaDeProveedor('n-molinos-del-sur'), 4.4);
});

test('cuando el SII cambia el estado de un documento emitido, la red lo actualiza y emite documento.actualizado', async () => {
  let avisar: (c: { tipo: 33 | 52 | 61; folio: number; estadoSii: string }) => void = () => {};
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo);
  const red = await crearRed({ repo, sii: { ...crearSiiFalso(), alCambiarEstado: oyente => { avisar = oyente; } } });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  const orden = await pedirHarina(red);
  await red.confirmarOrden(orden.id);
  const factura = red.estadoDeLaRed().documentos.find(d => d.tipo === 33)!;

  avisar({ tipo: 33, folio: factura.folio, estadoSii: 'aceptado' });
  await new Promise(r => setImmediate(r));
  assert.equal(red.estadoDeLaRed().documentos.find(d => d.id === factura.id)?.estadoSii, 'aceptado');
  assert.equal(eventos.at(-1)?.tipo, 'documento.actualizado');
  assert.equal((eventos.at(-1)?.datos as { documento: { id: string } }).documento.id, factura.id);
  assert.equal(await red.actualizarEstadoDocumento(33, 999999, 'aceptado'), null);
});

test('reiniciar la demo borra órdenes y documentos, resiembra la licitación y no reusa folios', async () => {
  const reloj = { ahora: new Date('2026-11-21T15:00:00Z') };
  const { red, eventos } = await redDePrueba(reloj);
  const primera = await pedirHarina(red);
  await red.confirmarOrden(primera.id);
  const folioAntes = red.estadoDeLaRed().documentos.find(d => d.tipo === 33)!.folio;
  await red.unirseALicitacion('L-1', { nombre: 'Ana', cantidad: 1 });

  reloj.ahora = new Date('2026-11-21T16:00:00Z');
  const estado = await red.reiniciarDemo();
  assert.equal(estado.ordenes.length, 0);
  assert.equal(estado.documentos.length, 0);
  assert.equal(estado.licitaciones[0].participantes.length, 0);
  assert.equal(estado.licitaciones[0].cierraEn, '2026-11-21T16:05:00.000Z');
  assert.equal(estado.notas[PROVEEDOR_DEMO], 4.7);
  assert.equal(eventos.at(-1)?.tipo, 'red.reiniciada');

  const segunda = await pedirHarina(red);
  await red.confirmarOrden(segunda.id);
  assert.ok(red.estadoDeLaRed().documentos.find(d => d.tipo === 33)!.folio > folioAntes);
});
