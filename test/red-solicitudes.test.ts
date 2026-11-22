// Solicitudes de compra en grupo: un comprador la inicia con su producto y su cantidad, otros se suman, pueden estar
// varias abiertas a la vez y cierran solas al vencer. Decisión: docs/decisiones/20261121-2255-lista-de-productos-y-solicitudes.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso } from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

async function redDePrueba(precioDeReferencia?: (producto: string) => number | undefined) {
  let ahora = Date.parse('2026-11-21T12:00:00Z');
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(ahora), {});
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {}, reloj: () => new Date(ahora), ...(precioDeReferencia ? { precioDeReferencia } : {}) });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  const comprador = async (nombre: string) => (await red.registrarComprador({ nombre, comuna: 'Ñuñoa', telefono: `+56 9 ${nombre.length}000 000${nombre.length}` })).id;
  return { red, eventos, comprador, avanzar: (minutos: number) => { ahora += minutos * 60_000; } };
}

test('un comprador abre una solicitud con su cantidad, otros se suman y puede haber varias abiertas', async () => {
  const { red, eventos, comprador } = await redDePrueba(p => (p.includes('tiquetas') ? 2100 : undefined));
  const ana = await comprador('Ana');
  const beto = await comprador('Beto Díaz');

  const etiquetas = await red.abrirSolicitud({ compradorId: ana, producto: 'Etiquetas adhesivas', unidad: 'Rollo', cantidad: 10 });
  assert.deepEqual([etiquetas.estado, etiquetas.proveedorId, etiquetas.productos[0].precioSolo, etiquetas.totalUnidades], ['abierta', undefined, 2100, 10]);
  assert.equal(eventos.filter(e => e.tipo === 'licitacion.abierta').length, 1);

  const cafe = await red.abrirSolicitud({ compradorId: beto, producto: 'Café molido', unidad: 'kilo', cantidad: 3, precioHoy: 12000, minutos: 60 });
  assert.equal(cafe.productos[0].precioSolo, 12000, 'lo que paga hoy manda sobre la referencia');
  assert.equal(red.estadoDeLaRed().licitaciones.filter(l => l.estado === 'abierta').length, 3, 'la de la sala y las dos solicitudes');

  await assert.rejects(red.abrirSolicitud({ compradorId: beto, producto: 'etiquetas ADHESIVAS', unidad: 'rollo', cantidad: 1 }), /súmate a ella/);
  await red.agregarAlCarrito(etiquetas.id, { negocioId: beto, productoId: etiquetas.productos[0].id, cantidad: 5 });
  assert.equal(red.estadoDeLaRed().licitaciones.find(l => l.id === etiquetas.id)!.totalUnidades, 15);
  const sinReferencia = await red.abrirSolicitud({ compradorId: ana, producto: 'Guantes de látex', unidad: 'caja', cantidad: 2 });
  assert.equal(sinReferencia.productos[0].precioSolo, 0, 'sin referencia parte esperando ofertas');
});

test('las solicitudes vencidas cierran solas, sin tocar las que siguen abiertas', async () => {
  const { red, comprador, avanzar } = await redDePrueba();
  const ana = await comprador('Ana');
  const corta = await red.abrirSolicitud({ compradorId: ana, producto: 'Café molido', unidad: 'kilo', cantidad: 3, minutos: 15 });
  const larga = await red.abrirSolicitud({ compradorId: ana, producto: 'Azúcar flor', unidad: 'kilo', cantidad: 3, minutos: 120 });
  avanzar(30);
  assert.ok(await red.cerrarVencidas() >= 1);
  const estado = (id: string) => red.estadoDeLaRed().licitaciones.find(l => l.id === id)!.estado;
  assert.deepEqual([estado(corta.id), estado(larga.id)], ['cerrada', 'abierta']);
});
