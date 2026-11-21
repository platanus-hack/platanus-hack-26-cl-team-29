import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, COMPRADOR_DEMO, PROVEEDOR_DEMO } from '../server/red/index.ts';
import type { EventoRed, Red } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

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
  assert.equal(foto.negocios.length, 8);
  assert.equal(foto.notas[PROVEEDOR_DEMO], 4.7);
  assert.equal(foto.notas['n-molinos-del-sur'], 3.9);
  assert.equal(foto.licitaciones[0].estado, 'abierta');
  foto.negocios.length = 0;
  assert.equal(red.estadoDeLaRed().negocios.length, 8);
});

test('negocioPorTelefono encuentra el negocio aunque el número venga con otro formato', async () => {
  const { red } = await redDePrueba({ ahora: new Date() });
  assert.equal(red.negocioPorTelefono('56900000011')?.id, COMPRADOR_DEMO);
  assert.equal(red.negocioPorTelefono('+56 9 0000 0001')?.id, PROVEEDOR_DEMO);
  assert.equal(red.negocioPorTelefono('56999999999'), undefined);
});
