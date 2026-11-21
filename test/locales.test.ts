import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAlmacenLocalesMemoria } from '../server/locales/almacen.ts';
import { crearExplorador, type Hallazgo } from '../server/locales/explorador.ts';
import { buscarEnCatalogo, distanciaKm, leerGeojsonseq, muestrear, MUT, recorrido, type Celda, type Local } from '../server/locales/osm.ts';

const RECORRIDO = { reparto: { ladoKm: 25, porCelda: 6 }, acumulando: { ladoKm: 2 } };

const local = (id: string, lng = MUT[0], lat = MUT[1]): Local =>
  ({ id, nombre: id, tipo: 'café', lat, lng, distanciaKm: distanciaKm(MUT, [lng, lat]), encontradoEn: '' });

/** Un catálogo chico: 30 locales junto al MUT, 5 en Valparaíso y 2 en Punta Arenas. */
const catalogo = (): Local[] => [
  ...Array.from({ length: 30 }, (_, i) => local(`node/mut-${i}`, MUT[0] + (i % 6) * 0.002, MUT[1] + Math.floor(i / 6) * 0.002)),
  ...Array.from({ length: 5 }, (_, i) => local(`node/valpo-${i}`, -71.62 + i * 0.001, -33.045)),
  local('node/pta-1', -70.91, -53.16), local('node/pta-2', -70.911, -53.161),
];

test('lee la exportación de osmium: puntos, polígonos por su centro, sin teléfonos ni repetidos', () => {
  const lineas = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-70.6, -33.42] }, properties: { '@type': 'node', '@id': 1, amenity: 'cafe', name: ' Café Uno ', 'addr:street': 'Av. Uno', 'addr:housenumber': '10', 'addr:city': 'Providencia', phone: '+56 9 1234 5678' } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-70.61, -33.43], [-70.59, -33.43], [-70.59, -33.41], [-70.61, -33.41]]] }, properties: { '@type': 'way', '@id': 2, shop: 'wholesale', name: 'Mayorista Dos' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-70.6, -33.42] }, properties: { '@type': 'node', '@id': 3, amenity: 'cafe' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-70.6, -33.42] }, properties: { '@type': 'node', '@id': 4, amenity: 'parking_entrance', name: 'Entrada' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-70.6, -33.42] }, properties: { '@type': 'node', '@id': 1, amenity: 'cafe', name: 'Café Uno' } },
  ];
  const locales = leerGeojsonseq(lineas.map(l => `\x1e${JSON.stringify(l)}`).join('\n'));
  assert.deepEqual(locales.map(l => l.id), ['node/1', 'way/2']);
  assert.deepEqual(
    { ...locales[0], distanciaKm: 0 },
    { id: 'node/1', nombre: 'Café Uno', tipo: 'café', lat: -33.42, lng: -70.6, direccion: 'Av. Uno 10', comuna: 'Providencia', distanciaKm: 0, encontradoEn: '' },
  );
  assert.ok(!('telefono' in locales[0]), 'no se guardan teléfonos');
  assert.deepEqual([locales[1].tipo, locales[1].lng, locales[1].lat], ['mayorista', -70.6, -33.42]);
});

test('el recorrido reparte primero por todo Chile y después acumula todo, de adentro hacia afuera', () => {
  const celdas = recorrido(catalogo(), RECORRIDO);
  const fin = celdas.findIndex(x => x.fase === 'acumulando');
  const reparto = celdas.slice(0, fin);
  const acumulando = celdas.slice(fin);
  assert.equal(reparto.length, 3, 'una celda grande por zona con locales: Santiago, Valparaíso y Punta Arenas');
  assert.ok(reparto.at(-1)!.distanciaKm > 2000, 'el reparto llega al extremo sur antes de acumular');
  for (const fase of [reparto, acumulando]) {
    for (let i = 1; i < fase.length; i++) assert.ok(fase[i].distanciaKm >= fase[i - 1].distanciaKm, 'cada fase va de adentro hacia afuera');
  }
  assert.deepEqual(celdas.map(x => x.i), celdas.map((_, i) => i));
});

test('cada celda entrega su muestra en el reparto y todos sus locales al acumular', async () => {
  const c = catalogo();
  const celdas = recorrido(c, RECORRIDO);
  const buscar = buscarEnCatalogo(c);
  const delMut = await buscar(celdas[0]);
  assert.equal(delMut.length, 6, 'el reparto toma 6 en Santiago');
  assert.deepEqual((await buscar(celdas[0])).map(l => l.id), delMut.map(l => l.id), 'la muestra es siempre la misma');
  assert.ok(delMut.every(l => l.encontradoEn), 'cada local trae la hora en que se encontró');
  const acumulados = new Set<string>();
  for (const celda of celdas.filter(x => x.fase === 'acumulando')) for (const l of await buscar(celda)) acumulados.add(l.id);
  assert.equal(acumulados.size, c.length, 'al acumular no se pierde ningún local de Chile');
});

test('la muestra no depende del orden y respeta el límite', () => {
  const muchos = Array.from({ length: 300 }, (_, i) => local(`node/${i}`));
  const a = muestrear(muchos, 12);
  assert.equal(a.length, 12);
  assert.deepEqual(muestrear([...muchos].reverse(), 12), a);
  assert.notDeepEqual(a.map(l => l.id), muchos.slice(0, 12).map(l => l.id), 'no son los primeros que llegan');
});

test('el explorador avisa solo los nuevos, reintenta tras un error y sigue desde donde quedó', async () => {
  const celdas = recorrido(catalogo(), RECORRIDO).slice(0, 3);
  const almacen = crearAlmacenLocalesMemoria();
  const avisos: Hallazgo[] = [];
  let falla = true;
  const buscar = async (c: Celda) => {
    if (c.i === 1 && falla) { falla = false; throw new Error('la base no responde'); }
    return [local(`node/${c.i}`), local('node/compartido')];
  };
  const opciones = { almacen, celdas, buscar, esperaMs: 1, alAvanzar: (h: Hallazgo) => avisos.push(h) };
  await crearExplorador(opciones).iniciar();
  assert.deepEqual(avisos.map(a => a.nuevos.map(l => l.id)), [['node/0', 'node/compartido'], ['node/1'], ['node/2']]);
  assert.equal(avisos.at(-1)!.avance.terminado, true);
  assert.equal(avisos.at(-1)!.avance.buscando, null);

  // Un explorador nuevo sobre el mismo almacén no repite celdas, y sin correr informa el avance guardado.
  avisos.length = 0;
  const otro = crearExplorador(opciones);
  assert.equal((await otro.avance()).celda, 3);
  await otro.iniciar();
  assert.equal(avisos.length, 0);
});
