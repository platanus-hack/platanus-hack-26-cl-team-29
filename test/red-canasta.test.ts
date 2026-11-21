import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearSii } from '../server/sii/index.ts';
import type { EntradaFactura } from '../server/sii/index.ts';
import {
  configDemo, crearAlmacenFoliosMemoria, crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, crearSiiReal,
  iniciarCompetencia, pisosDeProducto, COMPETIDORES_SALA, PROVEEDOR_SALA,
} from '../server/red/index.ts';
import type { EventoRed, LicitacionVista, PuertoSii } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { precioPorVolumen } from '../shared/precios.ts';
import { consultaConFicha, RUT_EMPRESA } from './sii-apoyo.ts';

const ENV = { DEMO_FICTICIOS: '1', DEMO_TELEFONO_PROVEEDOR: '+56 9 0000 0099', DEMO_PRECIO_PISO: '23900' };
const ANA = '+56 9 1111 2222';
const BETO = '+56 9 3333 4444';

async function redDePrueba(sii: PuertoSii = crearSiiFalso(), env: NodeJS.ProcessEnv = ENV) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), env);
  const red = await crearRed({ repo, sii, env, consultarContribuyente: consultaConFicha });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos };
}

const datos = <T>(eventos: EventoRed[], tipo: string) => eventos.filter(e => e.tipo === tipo).map(e => e.datos as T);

test('la canasta parte con cuatro productos y los campos de un solo producto reflejan el primero', async () => {
  const { red } = await redDePrueba();
  const l = red.licitacionAbierta()!;
  assert.deepEqual(l.productos.map(p => p.id), ['rollos', 'etiquetas', 'bolsas', 'guantes']);
  assert.deepEqual(l.productos.map(p => [p.precioSolo, p.totalUnidades, p.precioActual]), [[32000, 0, 32000], [6900, 0, 6900], [14900, 0, 14900], [8900, 0, 8900]]);
  assert.deepEqual([l.producto, l.unidad, l.precioSolo, l.tramos], [l.productos[0]!.nombre, 'caja', 32000, l.productos[0]!.tramos]);
  assert.deepEqual([l.totalNegocios, l.totalUnidades, l.montoTotal, l.ahorroTotal], [0, 0, 0, 0]);
  assert.equal(configDemo(ENV).productos.find(p => p.id === 'etiquetas')?.piso, 5520, '80 % del primer tramo');
  assert.equal(configDemo(ENV).productos[0]!.piso, 23900, 'DEMO_PRECIO_PISO aplica a rollos');
});

test('el carrito se reemplaza, se agrega, se quita y se sale, con su evento en cada paso', async () => {
  const { red, eventos } = await redDePrueba();
  const r1 = await red.actualizarCarrito('L-1', { telefono: ANA, nombre: 'Ana', items: [{ productoId: 'rollos', cantidad: 2 }, { productoId: 'guantes', cantidad: 3 }] });
  assert.deepEqual(r1.participante?.items, [{ productoId: 'rollos', cantidad: 2 }, { productoId: 'guantes', cantidad: 3 }]);
  assert.equal(r1.participante?.cantidad, 5);

  const r2 = await red.agregarAlCarrito('L-1', { telefono: ANA, productoId: 'etiquetas', cantidad: 4 });
  assert.deepEqual(r2.participante?.items.map(i => [i.productoId, i.cantidad]), [['rollos', 2], ['etiquetas', 4], ['guantes', 3]]);
  const r3 = await red.agregarAlCarrito('L-1', { telefono: ANA, productoId: 'rollos', cantidad: 0 });
  assert.deepEqual(r3.participante?.items.map(i => i.productoId), ['etiquetas', 'guantes']);
  const r4 = await red.actualizarCarrito('L-1', { telefono: ANA, items: [{ productoId: 'bolsas', cantidad: 1 }] });
  assert.deepEqual(r4.participante?.items, [{ productoId: 'bolsas', cantidad: 1 }], 'reemplaza el carrito completo');
  assert.equal(r4.licitacion.participantes.length, 1, 'no se duplica');
  assert.equal(r4.licitacion.montoTotal, 14900);

  const { licitacion } = await red.salirDeLicitacion('L-1', { telefono: ANA });
  assert.deepEqual([licitacion.participantes.length, licitacion.totalUnidades], [0, 0]);
  const acciones = datos<{ accion: string; participante: { cantidad: number } }>(eventos, 'licitacion.participante').map(d => d.accion);
  assert.deepEqual(acciones, ['entra', 'cambia', 'cambia', 'cambia', 'sale']);

  // Vaciar el carrito también sale; salir sin estar no avisa nada.
  await red.actualizarCarrito('L-1', { telefono: BETO, nombre: 'Beto', items: [{ productoId: 'rollos', cantidad: 1 }] });
  const vacio = await red.actualizarCarrito('L-1', { telefono: BETO, items: [] });
  assert.equal(vacio.participante, null);
  const antes = eventos.length;
  await red.salirDeLicitacion('L-1', { telefono: BETO });
  assert.equal(eventos.length, antes);

  await assert.rejects(red.agregarAlCarrito('L-1', { telefono: ANA, productoId: 'cafe', cantidad: 1 }), { codigo: 'datos_invalidos' });
  await assert.rejects(red.agregarAlCarrito('L-1', { telefono: ANA, productoId: 'rollos', cantidad: 21 }), { codigo: 'datos_invalidos' });
  await assert.rejects(red.actualizarCarrito('L-1', { nombre: 'Sin dueño', items: [] }), { codigo: 'datos_invalidos' });
});

test('cada producto baja por sus propios tramos y avisa precio_bajo con productoId', async () => {
  const { red, eventos } = await redDePrueba();
  await red.actualizarCarrito('L-1', { telefono: ANA, nombre: 'Ana', items: [{ productoId: 'etiquetas', cantidad: 9 }, { productoId: 'rollos', cantidad: 1 }] });
  eventos.length = 0;
  const r = await red.actualizarCarrito('L-1', { telefono: BETO, nombre: 'Beto', items: [{ productoId: 'etiquetas', cantidad: 1 }, { productoId: 'bolsas', cantidad: 2 }] });
  assert.deepEqual(r.bajadas, [{ productoId: 'etiquetas', precioAnterior: 6900, precioNuevo: 6400 }]);
  assert.deepEqual(datos(eventos, 'licitacion.precio_bajo'), [{ licitacionId: 'L-1', productoId: 'etiquetas', precioAnterior: 6900, precioNuevo: 6400, totalUnidades: 10 }]);
  const etiquetas = r.licitacion.productos.find(p => p.id === 'etiquetas')!;
  assert.deepEqual(etiquetas.siguienteTramo, { desde: 25, precioUnitario: 5900, faltan: 15 });
  assert.equal(r.licitacion.precioActual, 32000, 'rollos no cruzó su tramo');
  assert.deepEqual([r.licitacion.totalNegocios, r.licitacion.totalUnidades], [2, 13]);
  assert.equal(r.licitacion.montoTotal, 32000 + 10 * 6400 + 2 * 14900);
  assert.equal(r.licitacion.ahorroTotal, 10 * 500);

  // Compatibilidad: unirse a un producto concreto cambia solo ese ítem.
  const u = await red.unirseALicitacion('L-1', { telefono: ANA, productoId: 'guantes', cantidad: 10 });
  assert.deepEqual([u.precioActual, u.bajoDePrecio], [8200, true]);
  assert.equal(u.participante.items.length, 3);
});

test('la competencia corre por producto: nadie baja de su piso y el proveedor real gana cada producto', async () => {
  const { red, eventos } = await redDePrueba();
  const competencia = iniciarCompetencia(red, { env: ENV, aleatorio: () => 0.99, esperar: async () => {} });
  for (let i = 0; i < 6; i++) {
    await red.actualizarCarrito('L-1', {
      telefono: `5699100${String(i).padStart(4, '0')}`, nombre: `N${i}`,
      items: ['rollos', 'etiquetas', 'bolsas', 'guantes'].map(productoId => ({ productoId, cantidad: 10 })),
    });
    await competencia.enCalma();
  }
  competencia.detener();
  const config = configDemo(ENV);
  const l = red.licitacionAbierta()!;
  for (const p of l.productos) {
    const piso = config.productos.find(x => x.id === p.id)!.piso;
    const pisos = pisosDeProducto(piso, config.precioPiso);
    const suyas = datos<{ productoId: string; oferta: { proveedorId: string; precioUnitario: number; productoId: string } }>(eventos, 'licitacion.oferta')
      .filter(d => d.productoId === p.id);
    for (const c of COMPETIDORES_SALA) {
      const rival = suyas.filter(d => d.oferta.proveedorId === c.id);
      assert.ok(rival.length > 0, `${c.nombre} compitió por ${p.id}`);
      assert.ok(rival.every(d => d.oferta.precioUnitario >= pisos.get(c.id)! && d.oferta.productoId === p.id), `${c.nombre} bajó de su piso en ${p.id}`);
    }
    const real = p.ofertas.find(o => o.proveedorId === PROVEEDOR_SALA)!;
    const mejorRival = Math.min(...p.ofertas.filter(o => o.proveedorId !== PROVEEDOR_SALA).map(o => o.precioUnitario));
    assert.ok(real.precioUnitario >= piso && real.precioUnitario < mejorRival, `el real gana ${p.id}`);
    assert.equal(p.precioActual, Math.min(real.precioUnitario, precioPorVolumen(p, p.totalUnidades)));
  }
  assert.equal(l.productos[0]!.precioActual, l.precioActual);
  assert.deepEqual(l.ofertas, l.productos[0]!.ofertas, 'las ofertas sueltas reflejan el primer producto');
  assert.ok(datos<{ productoId?: string }>(eventos, 'licitacion.precio_bajo').every(d => typeof d.productoId === 'string'));
});

test('al cerrar, una orden por comprador con todos sus ítems al precio de cada producto', async () => {
  const { red } = await redDePrueba();
  await red.actualizarCarrito('L-1', { telefono: ANA, nombre: 'Ana', items: [{ productoId: 'rollos', cantidad: 6 }, { productoId: 'bolsas', cantidad: 2 }] });
  await red.actualizarCarrito('L-1', { telefono: BETO, nombre: 'Beto', items: [{ productoId: 'rollos', cantidad: 4 }, { productoId: 'guantes', cantidad: 1 }] });
  await red.unirseALicitacion('L-1', { nombre: 'Público', cantidad: 1 });
  const ordenes = await red.cerrarLicitacion('L-1');
  assert.equal(ordenes.length, 3);
  assert.ok(ordenes.every(o => o.proveedorId === PROVEEDOR_SALA && o.estado === 'enviada'));
  assert.deepEqual(ordenes[0]!.items.map(i => [i.productoId, i.cantidad, i.precioUnitario]), [['rollos', 6, 29900], ['bolsas', 2, 14900]]);
  assert.deepEqual(ordenes[1]!.items.map(i => [i.productoId, i.cantidad, i.precioUnitario]), [['rollos', 4, 29900], ['guantes', 1, 8900]]);
  assert.equal(ordenes[0]!.items[1]!.producto, 'Paquete de bolsas camiseta (1.000 un.)');
});

test('una factura 33 por comprador con una línea por producto, todas en un sobre con folios consecutivos', async () => {
  const silencioso = { info() {}, warn() {}, error() {} };
  const base = crearSii({ env: { SII_RUT_EMISOR: RUT_EMPRESA }, log: silencioso });
  const sobres: EntradaFactura[][] = [];
  const sii = { ...base, emitirFacturas: (e: readonly EntradaFactura[]) => { sobres.push([...e]); return base.emitirFacturas(e); } };
  const { red, eventos } = await redDePrueba(crearSiiReal({ sii, folios: crearAlmacenFoliosMemoria(), rangos: () => [{ desde: 40, hasta: 99 }], log: silencioso, seguirEnvios: false }));

  await red.actualizarCarrito('L-1', { telefono: ANA, nombre: 'Ana', rut: '11111111-1', items: [{ productoId: 'rollos', cantidad: 2 }, { productoId: 'etiquetas', cantidad: 3 }, { productoId: 'guantes', cantidad: 1 }] });
  await red.actualizarCarrito('L-1', { telefono: BETO, nombre: 'Beto', rut: '33333333-3', items: [{ productoId: 'bolsas', cantidad: 5 }] });
  await red.cerrarLicitacion('L-1');
  const facturas = await red.confirmarOrdenesDeLicitacion('L-1');

  assert.equal(sobres.length, 1, 'un solo sobre');
  assert.deepEqual(sobres[0]!.map(e => [e.folio, e.items.length]), [[40, 3], [41, 1]]);
  assert.deepEqual(sobres[0]![0]!.items.map(i => [i.nombre, i.cantidad, i.precioUnitario]), [
    ['Caja de rollos térmicos 80 mm (50 un.)', 2, 32000], ['Rollo de etiquetas adhesivas 50x30 (1.000 un.)', 3, 6900], ['Caja de guantes de nitrilo (100 un.)', 1, 8900],
  ]);
  assert.deepEqual(facturas.map(f => [f.folio, f.estadoSii, f.monto]), [[40, 'recibido', 2 * 32000 + 3 * 6900 + 8900], [41, 'recibido', 5 * 14900]]);
  const facturada = datos<{ documentos: number; total: number; ahorroTotal: number }>(eventos, 'licitacion.facturada')[0]!;
  assert.deepEqual(facturada, { licitacionId: 'L-1', documentos: 2, total: 2 * 32000 + 3 * 6900 + 8900 + 5 * 14900, ahorroTotal: 0 });

  // El reinicio vuelve a sembrar la canasta y no reusa folios.
  await red.reiniciarDemo();
  assert.equal(red.licitacionAbierta()!.productos.length, 4);
  await red.agregarAlCarrito('L-1', { telefono: ANA, nombre: 'Ana', rut: '11111111-1', productoId: 'guantes', cantidad: 1 });
  await red.cerrarLicitacion('L-1');
  assert.deepEqual((await red.confirmarOrdenesDeLicitacion('L-1')).map(f => f.folio), [42]);
});

test('el carrito por la web: PUT y DELETE con la sesión, config con la canasta y nada público lleva teléfonos', async () => {
  const env = { ...ENV, DEMO_PROVEEDOR_LOGO_URL: 'https://ejemplo.cl/logo.png' };
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), env);
  const red = await crearRed({ repo, sii: crearSiiFalso(), env });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, env));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const pedir = async (method: string, ruta: string, body?: unknown, token?: string) => {
    const r = await fetch(url + ruta, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, cuerpo: await r.json(), texto: '' };
  };
  try {
    const config = await pedir('GET', '/config');
    assert.deepEqual(config.cuerpo.productos.map((p: { id: string }) => p.id), ['rollos', 'etiquetas', 'bolsas', 'guantes']);
    assert.equal(config.cuerpo.producto, config.cuerpo.productos[0].nombre);
    assert.ok(!JSON.stringify(config.cuerpo).includes('piso'), 'los pisos son ocultos');
    assert.equal(config.cuerpo.proveedorLogoUrl, 'https://ejemplo.cl/logo.png');
    assert.equal(red.estadoPublico().negocios.find(n => n.id === PROVEEDOR_SALA)?.logoUrl, 'https://ejemplo.cl/logo.png');
    assert.equal(red.negocioPorId('n-almacen-don-tito')?.rubro, 'almacen');

    // Alguien por WhatsApp también compra: su teléfono no puede aparecer en nada público.
    await red.actualizarCarrito('L-1', { telefono: ANA, nombre: 'Ana', items: [{ productoId: 'rollos', cantidad: 1 }] });
    const { cuerpo: { token, negocio } } = await pedir('POST', '/sesion', { nombre: 'Carla', rubro: 'Panadería', rut: '33333333-3' });
    assert.equal(negocio.rubro, 'panaderia');
    assert.equal((await pedir('POST', '/licitaciones/L-1/unirse', { nombre: 'Dani', rubro: 'astronauta', rut: '44444444-4', cantidad: 1 })).cuerpo.participante.rubro, 'otro');
    assert.equal((await pedir('PUT', '/yo/carrito', { licitacionId: 'L-1', items: [] })).status, 401);
    const puesto = await pedir('PUT', '/yo/carrito', { licitacionId: 'L-1', items: [{ productoId: 'etiquetas', cantidad: 3 }, { productoId: 'bolsas', cantidad: 1 }] }, token);
    assert.equal(puesto.status, 200);
    assert.deepEqual(puesto.cuerpo.participante.items, [{ productoId: 'etiquetas', cantidad: 3 }, { productoId: 'bolsas', cantidad: 1 }]);
    assert.equal((await pedir('PUT', '/yo/carrito', { licitacionId: 'L-1', items: [{ productoId: 'cafe', cantidad: 1 }] }, token)).status, 400);

    const yo = await pedir('GET', '/yo', undefined, token);
    const items = yo.cuerpo.participaciones[0].items as { productoId: string; precioActual: number; nombre: string }[];
    assert.deepEqual(items.map(i => [i.productoId, i.precioActual]), [['etiquetas', 6900], ['bolsas', 14900]]);

    const fuera = await pedir('DELETE', '/yo/carrito/L-1', undefined, token);
    assert.equal(fuera.status, 200);
    assert.equal((fuera.cuerpo.licitacion as LicitacionVista).participantes.length, 2);

    const publico = JSON.stringify([eventos, puesto.cuerpo, yo.cuerpo, fuera.cuerpo, (await pedir('GET', '/estado')).cuerpo]);
    assert.ok(!publico.includes('"telefono"') && !publico.includes('11112222') && !publico.includes('"token"'));
  } finally {
    server.close();
  }
});
