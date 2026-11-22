import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capas, circulo, MUT, pulsoDeEvento, pulsosNuevos, RADIO_KM, ubicar } from '../client/src/mapa/geo.ts';
import { iniciarRedFalsaCompartida } from '../client/src/red/falso-compartido.ts';
import type { EstadoRed, EventoRed } from '../client/src/red/tipos.ts';

const estado = (): EstadoRed => ({
  negocios: [
    { id: 'p1', nombre: 'Panificadora Uno', comuna: 'San Miguel', rol: 'proveedor' },
    { id: 'c1', nombre: 'Almacén Equis', comuna: 'Ñuñoa y alrededores', rol: 'comprador' },
    { id: 'c2', nombre: 'Kiosco Lejano', comuna: 'Comuna Inventada', rol: 'comprador' },
  ],
  ordenes: [
    { id: 'o1', compradorId: 'c1', proveedorId: 'p1', items: [], estado: 'reclamada', creadaEn: '2026-11-21T10:00:00Z' },
    { id: 'o2', compradorId: 'c2', proveedorId: 'p1', items: [], estado: 'enviada', creadaEn: '2026-11-21T11:00:00Z' },
    { id: 'o3', compradorId: 'no-existe', proveedorId: 'p1', items: [], estado: 'enviada', creadaEn: '2026-11-21T09:00:00Z' },
  ],
  documentos: [],
  notas: [{ proveedorId: 'p1', nota: 4.2 }],
  licitaciones: [],
});

const km = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111.19;

test('cada negocio cae siempre en el mismo punto, cerca de su comuna y dentro del radio', () => {
  const [p1, c1, c2] = estado().negocios;
  assert.deepEqual(ubicar(c1), ubicar(c1));
  assert.ok(km(ubicar(c1), [-70.6, -33.456]) < 2, 'Ñuñoa con texto extra sigue siendo Ñuñoa');
  assert.ok(km(ubicar(c2), MUT) < 2, 'una comuna desconocida cae junto al MUT');
  assert.ok(km(ubicar(p1), ubicar(c1)) > 2, 'comunas distintas no se pisan');
  assert.notDeepEqual(ubicar({ id: 'a', comuna: 'Ñuñoa' }), ubicar({ id: 'b', comuna: 'Ñuñoa' }));
  for (const n of [p1, c1, c2]) assert.ok(km(ubicar(n), MUT) < RADIO_KM);
});

test('el círculo es un anillo cerrado del radio pedido', () => {
  const anillo = circulo(MUT, RADIO_KM);
  assert.deepEqual(anillo[0].map(x => x.toFixed(6)), anillo.at(-1)!.map(x => x.toFixed(6)));
  for (const p of anillo) assert.ok(Math.abs(km(p, MUT) - RADIO_KM) < 0.5);
});

test('las capas marcan la última orden, el reclamo y el proveedor cuya nota bajó', () => {
  const { negocios, lineas } = capas(estado(), [{ proveedorId: 'p1', anterior: 4.6, nota: 4.2, en: 0 }]);
  assert.equal(negocios.features.length, 3);
  assert.equal(negocios.features[0].properties!.cambio, 'baja');
  assert.equal(negocios.features[1].properties!.cambio, '');
  // La orden con un negocio que no existe no se dibuja.
  assert.deepEqual(lineas.features.map(f => f.properties!.tipo), ['reclamo', 'actual']);
});

test('cada evento late en el negocio correcto, y uno incompleto no late', () => {
  const e = (tipo: EventoRed['tipo'], datos: Record<string, unknown>): EventoRed => ({ tipo, datos, en: '' });
  const s = estado();
  assert.deepEqual(pulsoDeEvento(e('orden.creada', { orden: s.ordenes[1] }), s), { negocioId: 'c2', clase: 'pedido' });
  assert.deepEqual(pulsoDeEvento(e('documento.emitido', { documento: { tipo: 33, ordenId: 'o1' } }), s), { negocioId: 'c1', clase: 'venta' });
  assert.equal(pulsoDeEvento(e('documento.emitido', { documento: { tipo: 61, ordenId: 'o1' } }), s), undefined);
  assert.deepEqual(pulsoDeEvento(e('nota.cambiada', { proveedorId: 'p1', anterior: 4.6, nota: 4.2 }), s), { negocioId: 'p1', clase: 'baja' });
  assert.deepEqual(pulsoDeEvento(e('licitacion.participante', { participante: { negocioId: 'c1' } }), s), { negocioId: 'c1', clase: 'nuevo' });
  assert.equal(pulsoDeEvento(e('reclamo.registrado', {}), s), undefined);
});

test('dos pestañas con la red falsa ven la misma foto y los mismos eventos', async () => {
  const visto: Record<'a' | 'b', string[]> = { a: [], b: [] };
  const firma = (estado: EstadoRed, evento?: EventoRed) => `${evento?.tipo ?? 'foto'}:${estado.negocios.length}:${estado.licitaciones[0]?.estado}`;
  const a = iniciarRedFalsaCompartida((s, ev) => visto.a.push(firma(s, ev)));
  await new Promise(r => setTimeout(r, 50));
  const b = iniciarRedFalsaCompartida((s, ev) => visto.b.push(firma(s, ev)));
  await new Promise(r => setTimeout(r, 100));
  // La segunda pestaña cierra la compra: el guion corre en la primera y las dos lo ven.
  b.cerrar('l-1');
  await new Promise(r => setTimeout(r, 100));
  a.detener();
  b.detener();
  assert.ok(visto.b.length >= 2, 'la segunda pestaña recibió la foto al abrir y el cambio');
  assert.equal(visto.b.at(-1), visto.a.at(-1));
  const cierre = visto.a.find(x => x.endsWith(':cerrada'));
  assert.ok(cierre && visto.b.includes(cierre), 'las dos pestañas vieron el cierre');
});

test('cada evento late una sola vez, y los viejos se marcan sin latir', () => {
  const e = estado();
  const orden = { compradorId: 'c1' };
  const evento = (clave: number, recibido: number) => ({ tipo: 'orden.creada' as const, datos: { orden }, en: '', clave, recibido });
  const vistos = new Set<number>();
  const primera = pulsosNuevos([evento(1, 1000), evento(2, 0)], vistos, e, 2000, 2500);
  assert.deepEqual(primera.map(p => [p.evento.clave, p.clase, p.negocio.id]), [[1, 'pedido', 'c1']]);
  assert.deepEqual([...vistos], [1, 2]);
  assert.deepEqual(pulsosNuevos([evento(1, 1000)], vistos, e, 2000, 2500), []);
});
