import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearAlmacenLocalesMemoria, sembrarDesdeArchivo } from '../server/locales/almacen.ts';
import { crearExplorador, type Hallazgo } from '../server/locales/explorador.ts';
import { distanciaKm, leerElementos, muestrear, MUT, recorrido, type Celda, type Local } from '../server/locales/osm.ts';

const RECORRIDO = { reparto: { ladoKm: 6, cajaKm: 1.5, porCelda: 8 }, acumulando: { ladoKm: 2, porCelda: 12 } };

const local = (id: string, distancia = 1): Local => ({ id, nombre: id, tipo: 'café', lat: 0, lng: 0, distanciaKm: distancia, encontradoEn: '' });

test('el recorrido reparte primero por toda la zona y después acumula de adentro hacia afuera', () => {
  const celdas = recorrido(MUT, 30, RECORRIDO);
  const fin = celdas.findIndex(c => c.fase === 'acumulando');
  assert.ok(fin > 50, 'hay una fase de reparto con muchas celdas');
  assert.ok(celdas.slice(fin).every(c => c.fase === 'acumulando'), 'las fases no se mezclan');
  assert.ok(celdas.slice(0, fin).some(c => c.distanciaKm > 25), 'el reparto llega al borde de la zona');
  for (const fase of [celdas.slice(0, fin), celdas.slice(fin)]) {
    for (let i = 1; i < fase.length; i++) assert.ok(fase[i].distanciaKm >= fase[i - 1].distanciaKm, 'cada fase va de adentro hacia afuera');
  }
  assert.ok(celdas.every(c => c.distanciaKm < 30 + 6), 'ninguna celda queda fuera del radio');
  assert.deepEqual(celdas.map(c => c.i), celdas.map((_, i) => i));
});

test('lee nodos y vías de Overpass, y descarta lo que no sirve', () => {
  const locales = leerElementos({
    elements: [
      { type: 'node', id: 1, lat: -33.42, lon: -70.6, tags: { amenity: 'cafe', name: ' Café Uno ', 'addr:street': 'Av. Uno', 'addr:housenumber': '10', 'addr:city': 'Providencia', phone: '+56 9 1234 5678' } },
      { type: 'way', id: 2, center: { lat: -33.43, lon: -70.61 }, tags: { shop: 'wholesale', name: 'Mayorista Dos' } },
      { type: 'node', id: 3, lat: -33.42, lon: -70.6, tags: { amenity: 'cafe' } },
      { type: 'node', id: 4, lat: -33.42, lon: -70.6, tags: { amenity: 'bank', name: 'Banco' } },
      { type: 'way', id: 5, tags: { amenity: 'restaurant', name: 'Sin centro' } },
    ],
  }, 'ahora');
  assert.equal(locales.length, 2);
  assert.deepEqual(
    { ...locales[0], distanciaKm: undefined },
    { id: 'node/1', nombre: 'Café Uno', tipo: 'café', lat: -33.42, lng: -70.6, direccion: 'Av. Uno 10', comuna: 'Providencia', distanciaKm: undefined, encontradoEn: 'ahora' },
  );
  assert.ok(!('telefono' in locales[0]), 'no se guardan teléfonos');
  assert.equal(locales[1].tipo, 'mayorista');
  assert.ok(Math.abs(locales[0].distanciaKm - distanciaKm(MUT, [-70.6, -33.42])) < 0.01);
  assert.deepEqual(leerElementos(null, ''), []);
});

test('la muestra de una celda es siempre la misma y respeta el límite', () => {
  const muchos = Array.from({ length: 300 }, (_, i) => local(`node/${i}`));
  const a = muestrear(muchos, 12);
  assert.equal(a.length, 12);
  assert.deepEqual(muestrear([...muchos].reverse(), 12), a, 'no depende del orden en que llegan');
  assert.notDeepEqual(a.map(l => l.id), muchos.slice(0, 12).map(l => l.id), 'no son los primeros que llegan');
  assert.equal(muestrear(muchos.slice(0, 5), 12).length, 5, 'si hay pocos, se traen todos');
});

test('el explorador avisa solo los nuevos, reintenta tras un error y sigue desde donde quedó', async () => {
  const celdas = recorrido(MUT, 6, { reparto: { ladoKm: 6, cajaKm: 1.5, porCelda: 8 }, acumulando: { ladoKm: 6, porCelda: 12 } }).slice(0, 3);
  const almacen = crearAlmacenLocalesMemoria();
  const avisos: Hallazgo[] = [];
  let falla = true;
  const buscar = async (c: Celda) => {
    if (c.i === 1 && falla) { falla = false; throw new Error('Overpass respondió 429'); }
    return [local(`node/${c.i}`), local('node/compartido')];
  };
  const opciones = { almacen, celdas, buscar, esperaMs: 1, alAvanzar: (h: Hallazgo) => avisos.push(h) };
  await crearExplorador(opciones).iniciar();
  assert.deepEqual(avisos.map(a => a.nuevos.map(l => l.id)), [['node/0', 'node/compartido'], ['node/1'], ['node/2']]);
  assert.deepEqual(avisos.at(-1)!.avance, { celda: 3, total: 3, distanciaKm: Number(celdas[2].distanciaKm.toFixed(1)), fase: celdas[2].fase, buscando: null, terminado: true });

  // Un explorador nuevo sobre el mismo almacén no repite celdas.
  avisos.length = 0;
  await crearExplorador(opciones).iniciar();
  assert.equal(avisos.length, 0);
});

test('el servidor arranca desde el JSON del repo si su almacén va más atrás', async () => {
  const ruta = join(await mkdtemp(join(tmpdir(), 'locales-')), 'locales.json');
  await writeFile(ruta, JSON.stringify({ siguienteCelda: 4, locales: [local('node/1'), local('node/2')] }));
  const almacen = crearAlmacenLocalesMemoria();
  assert.equal(await sembrarDesdeArchivo(almacen, ruta), 2);
  assert.equal(await almacen.siguienteCelda(), 4);
  assert.equal(await sembrarDesdeArchivo(almacen, ruta), 0, 'no vuelve a sembrar si ya va igual o más adelante');
  assert.equal(await sembrarDesdeArchivo(crearAlmacenLocalesMemoria(), join(ruta, 'no-existe')), 0);
});
