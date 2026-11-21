import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configDemo, crearRed, crearRepositorioMemoria, crearSiiFalso, iniciarCompetencia,
  COMPETIDORES_SALA, PROVEEDOR_SALA,
} from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

const ENV = { DEMO_TELEFONO_PROVEEDOR: '+56 9 0000 0099', DEMO_PRECIO_PISO: '23900' };

/** Sala con competencia sin esperas y con un azar fijo, para que el resultado sea reproducible. */
async function salaQueCompite(env: NodeJS.ProcessEnv = ENV, aleatorio = () => 0.99) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), env);
  const red = await crearRed({ repo, sii: crearSiiFalso(), env });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  const competencia = iniciarCompetencia(red, { env, aleatorio, esperar: async () => {} });
  /** Suma `n` negocios de a 10 cajas y deja que los proveedores terminen de responder tras cada uno. */
  async function sumar(n: number) {
    for (let i = 0; i < n; i++) {
      await red.unirseALicitacion('L-1', { telefono: `5699100${String(i).padStart(4, '0')}`, nombre: `N${i}`, cantidad: 10 });
      await competencia.enCalma();
    }
  }
  return { red, eventos, competencia, sumar };
}

const ofertas = (eventos: EventoRed[]) => eventos.filter(e => e.tipo === 'licitacion.oferta')
  .map(e => (e.datos as { oferta: { proveedorId: string; proveedorNombre: string; precioUnitario: number; nota: number } }).oferta);

test('los rivales nunca bajan de su piso y el proveedor real gana con su mejor nota al cerrar', async () => {
  const { red, eventos, sumar } = await salaQueCompite();
  await sumar(12); // cruza todos los tramos y las rondas llevan a los rivales a su piso
  const piso = configDemo(ENV).precioPiso;
  for (const c of COMPETIDORES_SALA) {
    const suyas = ofertas(eventos).filter(o => o.proveedorId === c.id);
    assert.ok(suyas.length > 0, `${c.nombre} compitió`);
    assert.ok(suyas.every(o => o.precioUnitario >= piso + c.sobrePiso), `${c.nombre} bajó de su piso`);
  }
  const l = red.licitacionAbierta()!;
  const mejorRival = Math.min(...l.ofertas.filter(o => o.proveedorId !== PROVEEDOR_SALA).map(o => o.precioUnitario));
  const real = l.ofertas.find(o => o.proveedorId === PROVEEDOR_SALA)!;
  assert.ok(real.precioUnitario < mejorRival && real.precioUnitario >= piso);
  assert.equal(l.precioActual, real.precioUnitario);
  assert.ok(l.precioActual < 24500, 'la competencia baja más que el último tramo');
  assert.ok(red.notaDeProveedor(PROVEEDOR_SALA) > Math.max(...COMPETIDORES_SALA.map(c => red.notaDeProveedor(c.id))));

  const ordenes = await red.cerrarLicitacion('L-1');
  assert.ok(ordenes.every(o => o.proveedorId === PROVEEDOR_SALA && o.items[0].precioUnitario === real.precioUnitario));
});

test('el precio de la sala nunca sube y cada baja, por tramo o por oferta, avisa con licitacion.precio_bajo', async () => {
  const { eventos, sumar } = await salaQueCompite(ENV, () => 0.3);
  await sumar(8);
  const bajas = eventos.filter(e => e.tipo === 'licitacion.precio_bajo').map(e => e.datos as { precioAnterior: number; precioNuevo: number });
  assert.ok(bajas.length > 4, 'hay bajas por oferta además de las de tramo');
  for (const b of bajas) assert.ok(b.precioNuevo < b.precioAnterior);
  for (const [k, b] of bajas.entries()) if (k > 0) assert.equal(b.precioAnterior, bajas[k - 1]!.precioNuevo);
  const precios = eventos.filter(e => e.tipo === 'licitacion.participante' || e.tipo === 'licitacion.oferta')
    .map(e => (e.datos as { licitacion: { precioActual: number } }).licitacion.precioActual);
  for (const [k, p] of precios.entries()) if (k > 0) assert.ok(p <= precios[k - 1]!, 'el precio subió');
  const ultima = eventos.filter(e => e.tipo === 'licitacion.oferta').at(-1)!.datos as Record<string, unknown>;
  assert.deepEqual(Object.keys(ultima).sort(), ['licitacion', 'licitacionId', 'mejor', 'nota', 'oferta', 'productoId']);
  assert.equal(ultima.mejor, true);
});

test('con DEMO_COMPETENCIA=0 no hay ofertas y el precio es solo el del tramo', async () => {
  const env = { ...ENV, DEMO_COMPETENCIA: '0' };
  assert.equal(configDemo(env).competencia, false);
  assert.equal(configDemo(ENV).competencia, true);
  // iniciarRed no arranca la competencia con DEMO_COMPETENCIA=0; sin ella la sala queda solo con tramos.
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), env);
  const red = await crearRed({ repo, sii: crearSiiFalso(), env });
  for (let i = 0; i < 3; i++) await red.unirseALicitacion('L-1', { nombre: `N${i}`, cantidad: 10 });
  assert.deepEqual([red.licitacionAbierta()!.ofertas.length, red.licitacionAbierta()!.precioActual], [0, 27900]);
});

test('las ofertas no llevan teléfonos y el reinicio deja la competencia de cero', async () => {
  const { red, eventos, competencia, sumar } = await salaQueCompite();
  await sumar(3);
  const telefonos = red.estadoDeLaRed().negocios.map(n => n.telefono.replace(/\D/g, '').slice(-8)).filter(Boolean);
  const ofertasEventos = eventos.filter(e => e.tipo === 'licitacion.oferta');
  assert.ok(ofertasEventos.length > 0);
  for (const e of ofertasEventos) {
    const texto = JSON.stringify(e);
    assert.ok(!texto.includes('"telefono"'));
    const numeros = texto.replace(/\D/g, ' ').split(' ');
    for (const t of telefonos) assert.ok(!numeros.some(n => n.endsWith(t)), `apareció el teléfono ${t}`);
  }
  assert.ok(ofertas(eventos).some(o => o.proveedorNombre === 'Papelera Central' && o.nota === 4.6));

  await red.reiniciarDemo();
  assert.deepEqual(red.licitacionAbierta()!.ofertas, []);
  eventos.length = 0;
  await sumar(1);
  assert.ok(ofertas(eventos).length > 0, 'tras reiniciar vuelven a competir desde el primer tramo');
  await competencia.enCalma();
});
