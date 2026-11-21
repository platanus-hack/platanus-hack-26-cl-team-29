import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, COMPRADOR_DEMO, PROVEEDOR_DEMO } from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

async function redDePrueba() {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo);
  const red = await crearRed({ repo, sii: crearSiiFalso() });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos };
}

test('el público y los negocios se suman a la licitación y todos ven el evento', async () => {
  const { red, eventos } = await redDePrueba();
  await red.unirseALicitacion('L-1', { nombre: 'Ana', comuna: 'Ñuñoa', cantidad: 1 });
  await red.unirseALicitacion('L-1', { negocioId: COMPRADOR_DEMO, cantidad: 3 });
  await red.unirseALicitacion('L-1', { negocioId: COMPRADOR_DEMO, cantidad: 5 });
  const l = red.estadoDeLaRed().licitaciones[0];
  assert.deepEqual(l.participantes.map(p => [p.nombre, p.cantidad]), [
    ['Almacén Don Tito', 4], ['Minimarket Los Aromos', 2], ['Amasandería La Esquina', 6], ['Ana', 1], ['La Picá de Ñuñoa', 5],
  ]);
  assert.deepEqual(eventos.map(e => e.tipo), ['licitacion.participante', 'licitacion.participante', 'licitacion.participante']);
  await assert.rejects(red.unirseALicitacion('L-1', { nombre: '', cantidad: 1 }), { codigo: 'datos_invalidos' });
});

test('al cerrar gana el menor precio ajustado por nota, no el más barato, y se crean las órdenes', async () => {
  const { red, eventos } = await redDePrueba();
  const l = red.estadoDeLaRed().licitaciones[0];
  assert.equal(l.precioSolo, 21500);
  assert.ok(l.participantes.every(p => p.en) && l.ofertas.every(o => o.en));
  const masBarata = [...l.ofertas].sort((a, b) => a.precioUnitario - b.precioUnitario)[0];
  assert.equal(masBarata.proveedorId, 'n-molinos-del-sur');
  await red.unirseALicitacion('L-1', { nombre: 'Público', cantidad: 2 });

  const cerrada = await red.cerrarLicitacion('L-1');
  assert.equal(cerrada.estado, 'cerrada');
  assert.equal(cerrada.ganadora?.proveedorId, PROVEEDOR_DEMO);

  const ordenes = red.estadoDeLaRed().ordenes;
  assert.equal(ordenes.length, 3, 'una por negocio participante, no por el público');
  assert.ok(ordenes.every(o => o.proveedorId === PROVEEDOR_DEMO && o.items[0].precioUnitario === 17200));
  assert.equal(eventos.at(-1)?.tipo, 'licitacion.cerrada');

  await assert.rejects(red.ofertar('L-1', { proveedorId: 'n-harinas-andes', precioUnitario: 1, plazoDias: 0 }), { codigo: 'transicion_invalida' });
});

test('una oferta nueva del mismo proveedor reemplaza la anterior y queda con su hora', async () => {
  const { red } = await redDePrueba();
  const l = await red.ofertar('L-1', { proveedorId: 'n-harinas-andes', precioUnitario: 16900, plazoDias: 1 });
  const deAndes = l.ofertas.filter(o => o.proveedorId === 'n-harinas-andes');
  assert.equal(deAndes.length, 1);
  assert.equal(deAndes[0].precioUnitario, 16900);
  assert.ok(Date.parse(deAndes[0].en) > Date.parse(l.ofertas[0].en));
});

test('un comprador no puede ofertar', async () => {
  const { red } = await redDePrueba();
  await assert.rejects(red.ofertar('L-1', { proveedorId: COMPRADOR_DEMO, precioUnitario: 100, plazoDias: 1 }), { codigo: 'datos_invalidos' });
});
