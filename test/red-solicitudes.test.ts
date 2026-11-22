// Solicitudes de compra en grupo: un comprador la inicia con su producto y su cantidad, otros se suman, pueden estar
// varias abiertas a la vez y cierran solas al vencer. Decisión: docs/decisiones/20261121-2255-lista-de-productos-y-solicitudes.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso } from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { iniciarCatalogos } from '../server/catalogo/index.ts';
import { conectarOfertasDeListas } from '../server/catalogo/ofertas.ts';

async function redDePrueba(precioDeReferencia?: (producto: string) => number | undefined, env: NodeJS.ProcessEnv = {}) {
  let ahora = Date.parse('2026-11-21T12:00:00Z');
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(ahora), {});
  const red = await crearRed({ repo, sii: crearSiiFalso(), env, reloj: () => new Date(ahora), ...(precioDeReferencia ? { precioDeReferencia } : {}) });
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

test('las listas de precios compiten solas: gana el mejor precio para el volumen del grupo y la oferta a mano no se pisa', async () => {
  const { red, comprador, avanzar } = await redDePrueba();
  const catalogos = await iniciarCatalogos({ emitir: () => {} });
  conectarOfertasDeListas(red, catalogos, { warn: () => {} });
  const caro = (await red.registrarProveedor({ telefono: '+56 9 7000 0001', rut: '11.111.111-1' })).id;
  const barato = (await red.registrarProveedor({ telefono: '+56 9 7000 0002', rut: '22.222.222-2' })).id;
  const cafe = { nombre: 'Café molido 1 kg', unidad: 'bolsa' };
  // El "caro" parte más barato, pero el otro baja más con volumen.
  await catalogos.agregar({ id: caro }, { ...cafe, tramos: [{ desde: 1, precioUnitario: 11000 }, { desde: 10, precioUnitario: 10500 }] });
  await catalogos.agregar({ id: barato }, { ...cafe, tramos: [{ desde: 1, precioUnitario: 12000 }, { desde: 10, precioUnitario: 9800 }] });

  const ana = await comprador('Ana');
  const beto = await comprador('Beto Díaz');
  const l = await red.abrirSolicitud({ compradorId: ana, producto: 'cafe molido 1 KG', unidad: 'bolsa', cantidad: 4, minutos: 30 });
  await new Promise(r => setTimeout(r, 20));
  const producto = () => red.estadoDeLaRed().licitaciones.find(x => x.id === l.id)!.productos[0];
  assert.deepEqual(producto().ofertas.map(o => [o.proveedorId, o.automatica]).sort(), [[caro, true], [barato, true]].sort());
  assert.equal(producto().precioActual, 11000, 'con 4 bolsas, el mejor es 11.000');

  await red.agregarAlCarrito(l.id, { negocioId: beto, productoId: producto().id, cantidad: 8 });
  assert.equal(producto().precioActual, 9800, 'con 12 bolsas, baja el que tiene mejor tramo');

  // Si el caro mejora a mano, su lista ya no la pisa.
  await red.ofertar(l.id, { proveedorId: caro, productoId: producto().id, precioUnitario: 9500, plazoDias: 1 });
  await catalogos.editar({ id: caro }, catalogos.listas().find(x => x.proveedorId === caro)!.productos[0].clave, { ...cafe, tramos: [{ desde: 1, precioUnitario: 11500 }] });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(producto().ofertas.find(o => o.proveedorId === caro)!.precioUnitario, 9500);

  avanzar(31);
  await red.cerrarVencidas();
  const ordenes = red.estadoDeLaRed().ordenes.filter(o => o.items.some(i => i.producto === 'cafe molido 1 KG'));
  assert.deepEqual(ordenes.map(o => [o.proveedorId, o.items[0].precioUnitario]).sort(), [[caro, 9500], [caro, 9500]]);
});

for (const aSiMismo of [true, false]) {
  test(`un proveedor ${aSiMismo ? 'puede' : 'no puede'} comprarse a sí mismo ${aSiMismo ? 'con' : 'sin'} DEMO_COMPRA_A_SI_MISMO=1`, async () => {
    const { red, avanzar } = await redDePrueba(undefined, aSiMismo ? { DEMO_COMPRA_A_SI_MISMO: '1' } : {});
    const catalogos = await iniciarCatalogos({ emitir: () => {} });
    conectarOfertasDeListas(red, catalogos, { warn: () => {} });
    const yo = (await red.registrarProveedor({ telefono: '+56 9 7000 0003', rut: '33.333.333-3' })).id;
    await catalogos.agregar({ id: yo }, { nombre: 'Café molido 1 kg', unidad: 'bolsa', tramos: [{ desde: 1, precioUnitario: 12000 }] });
    await red.abrirSolicitud({ compradorId: yo, producto: 'Café molido 1 kg', unidad: 'bolsa', cantidad: 3, minutos: 10 });
    await new Promise(r => setTimeout(r, 20));
    avanzar(11);
    await red.cerrarVencidas();
    const ordenes = red.estadoDeLaRed().ordenes.filter(o => o.compradorId === yo);
    assert.deepEqual(ordenes.map(o => o.proveedorId), aSiMismo ? [yo] : []);
  });
}
