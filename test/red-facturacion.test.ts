// Vender exige poder facturar: un proveedor registrado sin SII conectado se ve, pero no compite ni gana. Y los
// rechazos conocidos del SII llegan explicados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } from '../server/red/index.ts';
import type { Negocio, PuertoSii } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { explicarRechazoSii } from '../shared/sii-rechazos.ts';

const TEL = { ana: '+56 9 1111 1111', beto: '+56 9 2222 2222', caro: '+56 9 3333 3333' };

/** Red sin ficticios donde solo factura quien está en `conSii` (por id de negocio). */
async function redConFacturacion(conSii: Set<string>) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  const sii: PuertoSii = { ...crearSiiFalso(), puedeFacturar: async (n: Negocio) => conSii.has(n.id) };
  return crearRed({ repo, sii, env: {} });
}

test('un proveedor sin SII conectado no gana aunque oferte más barato; quien factura, sí', async () => {
  const conSii = new Set<string>();
  const red = await redConFacturacion(conSii);
  const ana = await red.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1', nombre: 'Ana' });
  const beto = await red.registrarProveedor({ telefono: TEL.beto, rut: '22222222-2', nombre: 'Beto' });
  conSii.add(beto.id);
  const vista = await red.ofertar(LICITACION_SALA, { proveedorId: ana.id, productoId: 'guantes', precioUnitario: 5_000, plazoDias: 1 });
  await red.ofertar(LICITACION_SALA, { proveedorId: beto.id, productoId: 'guantes', precioUnitario: 8_000, plazoDias: 1 });
  const guantes = () => red.licitacionAbierta()!.productos.find(p => p.id === 'guantes')!;
  assert.equal(vista.productos.find(p => p.id === 'guantes')!.ofertas.find(o => o.proveedorId === ana.id)?.pendienteSii, true);
  await red.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.caro, nombre: 'Kiosco Caro', rut: '33333333-3', productoId: 'guantes', cantidad: 3 });
  assert.equal(guantes().precioActual, 8_000, 'la oferta sin SII no baja el precio del grupo');
  const ordenes = await red.cerrarLicitacion(LICITACION_SALA);
  assert.deepEqual(ordenes.map(o => [o.proveedorId, o.items[0]!.precioUnitario]), [[beto.id, 8_000]], 'gana quien puede facturar');
});

test('quien conecta su SII después de ofertar compite al cerrar', async () => {
  const conSii = new Set<string>();
  const red = await redConFacturacion(conSii);
  const ana = await red.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1', nombre: 'Ana' });
  await red.ofertar(LICITACION_SALA, { proveedorId: ana.id, productoId: 'guantes', precioUnitario: 5_000, plazoDias: 1 });
  await red.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.caro, nombre: 'Kiosco Caro', rut: '33333333-3', productoId: 'guantes', cantidad: 3 });
  assert.equal(await red.puedeFacturar(ana.id), false);
  conSii.add(ana.id);
  assert.equal(await red.puedeFacturar(ana.id), true);
  const ordenes = await red.cerrarLicitacion(LICITACION_SALA);
  assert.deepEqual(ordenes.map(o => o.proveedorId), [ana.id]);
});

test('el rechazo de folios por falta de verificación de actividad llega explicado, sin rutas del portal', () => {
  const sii = 'No ha sido posible completar su solicitud. Esto debido a que El Servicio de Impuestos Internos informa que no puede '
    + 'emitir este tipo de documento tributario electronico porque no registra Verificacion de Actividades.';
  const texto = explicarRechazoSii(sii)!;
  assert.match(texto, /no tiene verificación de actividad/);
  assert.match(texto, /Peticiones Administrativas > Verificación de actividad/);
  assert.doesNotMatch(texto, /tope_33|of_solicita/);
  assert.equal(explicarRechazoSii('Otro error cualquiera'), null);
});
