import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aparicion, camara, capitulo, distanciaKm, DURACION_HISTORIA, historia, HITOS, relaciones } from '../client/src/mapa/crece.ts';
import { MUT } from '../client/src/mapa/geo.ts';
import type { EstadoRed } from '../client/src/red/tipos.ts';

const estado = (): EstadoRed => ({
  negocios: [
    { id: 'p1', nombre: 'Proveedor Uno', comuna: 'San Miguel', rol: 'proveedor' },
    { id: 'p2', nombre: 'Proveedor Dos', comuna: 'Maipú', rol: 'proveedor' },
    { id: 'p3', nombre: 'Proveedor Tres', comuna: 'Recoleta', rol: 'proveedor' },
    { id: 'c1', nombre: 'Almacén Uno', comuna: 'Ñuñoa', rol: 'comprador' },
    { id: 'c2', nombre: 'Almacén Dos', comuna: 'Puente Alto', rol: 'comprador' },
  ],
  ordenes: [
    { id: 'o1', compradorId: 'c1', proveedorId: 'p2', items: [], estado: 'enviada', creadaEn: '2026-11-21T10:00:00Z' },
    { id: 'o2', compradorId: 'c1', proveedorId: 'p2', items: [], estado: 'facturada', creadaEn: '2026-11-21T11:00:00Z' },
    { id: 'o3', compradorId: 'fantasma', proveedorId: 'p1', items: [], estado: 'enviada', creadaEn: '2026-11-21T11:00:00Z' },
  ],
  documentos: [],
  notas: [],
  licitaciones: [{
    id: 'l1', producto: 'rollos', comuna: 'Ñuñoa', cierraEn: '', estado: 'abierta', proveedorId: 'p3', ofertas: [],
    participantes: [{ negocioId: 'c2', cantidad: 3 }, { negocioId: 'c1', cantidad: 0 }],
  }],
});

/** Una grilla de locales alrededor del MUT, cada 300 m. */
const locales = Array.from({ length: 120 * 120 }, (_, i) => ({
  id: String(i), lng: MUT[0] + ((i % 120) - 60) * 0.0032, lat: MUT[1] + (Math.floor(i / 120) - 60) * 0.0027,
}));

test('relaciones junta órdenes y compras conjuntas, sin repetir ni negocios que no existen', () => {
  assert.deepEqual(relaciones(estado()), [['c1', 'p2'], ['c2', 'p3']]);
});

test('la secuencia parte por los compradores de la red y se completa con locales, del MUT hacia afuera', () => {
  const h = historia(estado(), locales);
  assert.equal(h.length, HITOS.at(-1));
  assert.deepEqual(h.slice(0, 2).map(n => [n.id, n.ilustrativo]), [['c1', false], ['c2', false]]);
  assert.deepEqual(h[0].proveedores, ['p2'], 'un comprador con compras usa sus proveedores reales');
  assert.equal(h[2].proveedores.length, 2, 'un local se une a sus dos proveedores más cercanos');
  const lejos = h.slice(2).map(n => distanciaKm(n.punto, MUT));
  assert.ok(lejos.every((d, i) => i === 0 || d >= lejos[i - 1] - 1e-9), 'los locales salen en orden de distancia');
  for (let i = 3; i < h.length; i++) {
    for (let j = 2; j < i; j++) assert.ok(distanciaKm(h[i].punto, h[j].punto) >= 0.3, 'no se enciman');
  }
});

test('sin proveedores no hay secuencia, y sin locales queda solo la red', () => {
  const e = estado();
  assert.deepEqual(historia({ ...e, negocios: e.negocios.filter(n => n.rol === 'comprador') }, locales), []);
  assert.equal(historia(e, []).length, 2);
});

test('cada hito llega a tiempo: 1 negocio, después 10, después 80, siempre en orden', () => {
  const tiempos = Array.from({ length: 80 }, (_, i) => aparicion(i));
  assert.ok(tiempos.every((t, i) => i === 0 || t > tiempos[i - 1]));
  assert.ok(tiempos[0] < 2000 && tiempos[1] >= 2000);
  assert.ok(tiempos[9] < 8000 && tiempos[10] >= 8000);
  assert.ok(tiempos[79] < 15_000);
});

test('la pantalla cuenta la historia y al final deja paso a la red en vivo', () => {
  assert.match(capitulo(1000, 1, 29_680)!.texto, /sus compras/);
  assert.match(capitulo(5000, 6, 29_680)!.texto, /precios/);
  assert.match(capitulo(12_000, 60, 29_680)!.texto, /nota/);
  assert.equal(capitulo(16_000, 80, 29_680)!.cifra, 29_680);
  assert.equal(capitulo(16_000, 80, 0)!.cifra, 80, 'sin locales sigue mostrando los negocios');
  assert.equal(capitulo(DURACION_HISTORIA, 80, 29_680), null);
});

test('la cámara del recorrido es determinista, continua y sigue girando después de la secuencia', () => {
  const foco: [number, number] = [-70.6, -33.456];
  assert.deepEqual(camara(5000, foco), camara(5000, foco));
  assert.deepEqual(camara(0, foco).center, foco);
  for (let t = 0; t < DURACION_HISTORIA + 5000; t += 100) {
    const [a, b] = [camara(t, foco), camara(t + 100, foco)];
    assert.ok(Math.abs(a.zoom - b.zoom) < 0.2 && Math.abs(a.bearing - b.bearing) < 1.5, `salto en ${t} ms`);
  }
  assert.ok(camara(DURACION_HISTORIA + 4000, foco).bearing > camara(DURACION_HISTORIA, foco).bearing);
});
