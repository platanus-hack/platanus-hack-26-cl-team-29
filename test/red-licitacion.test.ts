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
    ['Almacén Don Tito', 4], ['Minimarket Los Aromos', 2], ['Ana', 1], ['La Picá de Ñuñoa', 5],
  ]);
  assert.deepEqual(eventos.map(e => e.tipo), ['licitacion.participante', 'licitacion.participante', 'licitacion.participante']);
  await assert.rejects(red.unirseALicitacion('L-1', { nombre: '', cantidad: 1 }), { codigo: 'datos_invalidos' });
});

test('al cerrar gana el menor precio ajustado por nota, no el más barato, y se crean las órdenes', async () => {
  const { red, eventos } = await redDePrueba();
  // Molinos del Sur (3.9) ofrece lo más barato; Panificadora Ñuble (4.7) un poco más caro.
  await red.ofertar('L-1', { proveedorId: 'n-molinos-del-sur', precioUnitario: 17000, plazoDias: 1 });
  await red.ofertar('L-1', { proveedorId: PROVEEDOR_DEMO, precioUnitario: 17500, plazoDias: 1 });
  await red.unirseALicitacion('L-1', { nombre: 'Público', cantidad: 2 });

  const cerrada = await red.cerrarLicitacion('L-1');
  assert.equal(cerrada.estado, 'cerrada');
  assert.equal(cerrada.ganadora?.proveedorId, PROVEEDOR_DEMO);

  const ordenes = red.estadoDeLaRed().ordenes;
  assert.equal(ordenes.length, 2, 'una por negocio participante, no por el público');
  assert.ok(ordenes.every(o => o.proveedorId === PROVEEDOR_DEMO && o.items[0].precioUnitario === 17500));
  assert.equal(eventos.at(-1)?.tipo, 'licitacion.cerrada');

  await assert.rejects(red.ofertar('L-1', { proveedorId: 'n-harinas-andes', precioUnitario: 1, plazoDias: 0 }), { codigo: 'transicion_invalida' });
});

test('un comprador no puede ofertar', async () => {
  const { red } = await redDePrueba();
  await assert.rejects(red.ofertar('L-1', { proveedorId: COMPRADOR_DEMO, precioUnitario: 100, plazoDias: 1 }), { codigo: 'datos_invalidos' });
});
