import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conCacheYFila, crearRed, crearRepositorioMemoria, crearSiiFalso, RUT_DESCONOCIDO } from '../server/red/index.ts';
import type { ConsultarContribuyente, DatosContribuyente, EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

// Registro cuando el SII no responde: la persona entra con lo que escribió (declarado) y su RUT se confirma después.

const RUT = '11111111-1';
const DEL_SII: DatosContribuyente = {
  razonSocial: 'Almacén Las Rosas SpA', giro: 'Venta al por menor en almacenes', direccion: 'Av. Siempre Viva 742', comuna: 'Ñuñoa', actividades: [],
};
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

async function redCon(consultar: ConsultarContribuyente) {
  const repo = crearRepositorioMemoria();
  const env = { DEMO_FICTICIOS: '1' };
  await sembrarSiVacio(repo, new Date(), env);
  const red = await crearRed({
    repo, sii: crearSiiFalso(), env, consultarContribuyente: conCacheYFila(consultar, { intervaloMs: 0 }),
    esperaRutMs: 40, reintentosRutMs: [20, 20, 20],
  });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos };
}

const registro = { nombre: 'Almacén Las Rosas', comuna: 'Ñuñoa', telefono: '+56 9 1111 2222', rut: RUT, direccionFactura: { direccion: 'Los Aromos 12', comuna: 'Ñuñoa' } };

test('si el SII falla, el comprador queda registrado con lo que escribió (declarado)', async () => {
  const { red } = await redCon(async () => { throw new Error('el SII limitó la consulta'); });
  const n = await red.registrarComprador(registro);
  assert.equal(n.rut, RUT);
  assert.equal(n.contribuyente?.declarado, true);
  assert.equal(n.contribuyente?.razonSocial, 'Almacén Las Rosas');
  assert.equal(n.contribuyente?.direccion, 'Los Aromos 12');
});

test('si el SII no contesta a tiempo, nadie se queda esperando: entra declarado', async () => {
  const { red } = await redCon(() => new Promise(() => {}));
  const inicio = Date.now();
  const n = await red.registrarComprador(registro);
  assert.ok(Date.now() - inicio < 1000, 'no espera más que el tope');
  assert.equal(n.contribuyente?.declarado, true);
});

test('cuando el SII vuelve, los datos declarados se reemplazan por los del SII y se avisa en vivo', async () => {
  let caido = true;
  const { red, eventos } = await redCon(async () => {
    if (caido) throw new Error('sin respuesta');
    return DEL_SII;
  });
  const n = await red.registrarComprador(registro);
  assert.equal(n.contribuyente?.declarado, true);
  caido = false;
  await esperar(120);
  const ahora = red.estadoDeLaRed().negocios.find(x => x.id === n.id)!;
  assert.equal(ahora.contribuyente?.razonSocial, DEL_SII.razonSocial);
  assert.ok(!ahora.contribuyente?.declarado);
  assert.equal(ahora.contribuyente?.direccion, 'Los Aromos 12', 'la dirección que dio la persona se conserva');
  assert.ok(eventos.some(e => e.tipo === 'negocio.actualizado'));
});

test('un RUT que el SII dice que no existe sigue rechazándose', async () => {
  const { red } = await redCon(async () => null);
  await assert.rejects(red.registrarComprador(registro), { message: RUT_DESCONOCIDO });
});
