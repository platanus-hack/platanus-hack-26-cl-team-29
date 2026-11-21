import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, PROVEEDOR_SALA } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { crearReparto, crearViajeOsrm } from '../server/reparto/index.ts';
import { armarRuta, enlaceGoogleMaps, largoDelCircuito, MAX_PARADAS_GOOGLE, ordenarParadas } from '../shared/ruta.ts';
import type { Punto } from '../shared/ubicacion.ts';

const ENV = { DEMO_FICTICIOS: '1', DEMO_TELEFONO_PROVEEDOR: '+56 9 0000 0099' };

test('ordenarParadas: sale de la bodega a la más cercana y no deja cruces', () => {
  const bodega: Punto = [0, 0];
  // Cuatro esquinas de un cuadrado, desordenadas: el circuito bueno las recorre por el borde.
  const puntos: Punto[] = [[0.01, 0.01], [0, 0.01], [0.01, 0], [0.02, 0.02]];
  const orden = ordenarParadas(bodega, puntos);
  assert.deepEqual([...orden].sort(), [0, 1, 2, 3]);
  assert.ok([1, 2].includes(orden[0]!), 'parte por una de las dos más cercanas a la bodega');
  const largo = largoDelCircuito(bodega, puntos, orden);
  // Ninguna permutación es más corta (4! = 24): 2-opt llega al óptimo en un caso así de chico.
  const permutaciones = (xs: number[]): number[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutaciones(xs.filter((_, j) => j !== i)).map(r => [x, ...r]));
  const mejor = Math.min(...permutaciones([0, 1, 2, 3]).map(o => largoDelCircuito(bodega, puntos, o)));
  assert.ok(largo <= mejor + 1e-9, `${largo} > ${mejor}`);
});

test('enlaceGoogleMaps: ida y vuelta a la bodega, con hasta 9 paradas', () => {
  const paradas = Array.from({ length: 12 }, (_, i): Punto => [-70.6 + i / 100, -33.4]);
  const e = enlaceGoogleMaps([-70.6, -33.45], paradas)!;
  const q = new URL(e.url).searchParams;
  assert.equal(e.paradas, MAX_PARADAS_GOOGLE);
  assert.equal(q.get('origin'), '-33.450000,-70.600000');
  assert.equal(q.get('destination'), q.get('origin'));
  assert.equal(q.get('waypoints')!.split('|').length, MAX_PARADAS_GOOGLE);
  assert.equal(enlaceGoogleMaps([0, 0], []), null);
});

test('crearViajeOsrm: si OSRM falla, no hay viaje y la ruta queda en línea recta', async () => {
  const viaje = crearViajeOsrm({ buscar: async () => { throw new Error('sin red'); } });
  assert.equal(await viaje([[0, 0], [0.01, 0.01]]), null);
  const ruta = armarRuta({ punto: [0, 0], aproximada: true }, [
    { negocioId: 'a', nombre: 'A', comuna: 'X', punto: [0.02, 0], aproximado: true, items: [], guias: [] },
    { negocioId: 'b', nombre: 'B', comuna: 'X', punto: [0.01, 0], aproximado: true, items: [], guias: [] },
  ], await viaje([[0, 0], [0.02, 0], [0.01, 0]]));
  assert.equal(ruta.porCalles, false);
  assert.deepEqual(ruta.paradas.map(p => [p.orden, p.negocioId]), [[1, 'b'], [2, 'a']]);
  assert.deepEqual(ruta.geometria[0], [0, 0]);
});

test('crearViajeOsrm: lee el orden de visita de los waypoints', async () => {
  const respuesta = {
    code: 'Ok',
    trips: [{ distance: 12_300, duration: 1_500, geometry: { coordinates: [[0, 0], [1, 1]] } }],
    // La bodega (0) primero; la parada 1 se visita tercera y la 2 segunda.
    waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }],
  };
  const viaje = crearViajeOsrm({ buscar: async () => new Response(JSON.stringify(respuesta)) });
  const v = await viaje([[0, 0], [0.02, 0], [0.01, 0]]);
  assert.deepEqual(v?.orden, [1, 0]);
  assert.equal(v?.distanciaKm, 12.3);
  assert.equal(v?.duracionMin, 25);
});

test('ruta y guías: después de vender, cada negocio es una parada y las guías que faltan se emiten', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), ENV);
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: ENV });
  await red.unirseALicitacion('L-1', { telefono: '56991000001', nombre: 'Almacén Uno', comuna: 'Ñuñoa', cantidad: 3 });
  await red.unirseALicitacion('L-1', { telefono: '56991000002', nombre: 'Almacén Dos', comuna: 'Macul', cantidad: 2 });
  await red.cerrarLicitacion('L-1');
  await red.confirmarOrdenesDeLicitacion('L-1');

  const rutaDe = crearReparto(red);
  const antes = await rutaDe(PROVEEDOR_SALA);
  assert.ok(antes.paradas.length >= 2);
  assert.ok(antes.paradas.every(p => p.guias.length === 0), 'la compra conjunta factura sin guía');
  assert.deepEqual(antes.paradas.map(p => p.orden), antes.paradas.map((_, i) => i + 1));

  const guias = await red.emitirGuiasDeReparto(PROVEEDOR_SALA);
  assert.equal(guias.length, antes.paradas.length);
  assert.ok(guias.every(g => g.tipo === 52));
  const despues = await rutaDe(PROVEEDOR_SALA);
  assert.ok(despues.paradas.every(p => p.guias.length === 1));
  // Volver a llamar no emite otra guía.
  assert.equal((await red.emitirGuiasDeReparto(PROVEEDOR_SALA)).length, 0);
});
