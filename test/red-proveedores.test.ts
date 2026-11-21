// Proveedores reales: la red sin datos ficticios, varios proveedores que compiten producto por producto,
// productos creados por un proveedor y la factura de cada ganador con su propio emisor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configDemo, crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } from '../server/red/index.ts';
import type { EventoRed, PuertoSii } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

test('sin DEMO_FICTICIOS la red parte vacía: solo la compra conjunta abierta, sin proveedor fijo ni competencia', async () => {
  assert.equal(configDemo({}).ficticios, false);
  assert.equal(configDemo({ DEMO_COMPETENCIA: '1' }).competencia, false, 'los rivales ficticios necesitan DEMO_FICTICIOS');
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  await sembrarSiVacio(repo, new Date(), {}); // un segundo arranque no vuelve a sembrar
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const { negocios, licitaciones } = red.estadoDeLaRed();
  assert.deepEqual(negocios, []);
  assert.deepEqual(licitaciones.map(l => [l.id, l.estado, l.proveedorId]), [[LICITACION_SALA, 'abierta', undefined]]);
});

const TEL = { ana: '+56 9 1111 1111', beto: '+56 9 2222 2222', caro: '+56 9 3333 3333' };

/** Red vacía (sin ficticios) con el SII falso que anota cada sobre de facturas. */
async function redReal() {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  const base = crearSiiFalso();
  const sobres: string[][] = [];
  const sii: PuertoSii = { ...base, emitirFacturas: async d => { sobres.push(d.map(x => x.emisor.id)); return base.emitirFacturas(d); } };
  const red = await crearRed({ repo, sii, env: {} });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos, sobres };
}

test('un comprador que se registra como proveedor vende y sigue comprando; los demás lo ven en vivo', async () => {
  const { red, eventos } = await redReal();
  await red.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.ana, nombre: 'Almacén Ana', rut: '11111111-1', productoId: 'rollos', cantidad: 2 });
  const ana = await red.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1' });
  assert.equal(ana.rol, 'comprador', 'conserva su rol principal');
  assert.equal(ana.vende, true);
  assert.ok(eventos.some(e => e.tipo === 'negocio.registrado'));
  await red.ofertar(LICITACION_SALA, { proveedorId: ana.id, productoId: 'guantes', precioUnitario: 8000, plazoDias: 1 });
  await red.agregarAlCarrito(LICITACION_SALA, { negocioId: ana.id, productoId: 'bolsas', cantidad: 1 });
  assert.equal(red.licitacionAbierta()!.participantes.find(p => p.negocioId === ana.id)?.items.length, 2);
  const beto = await red.registrarProveedor({ telefono: TEL.beto, rut: '22222222-2', nombre: 'Distribuidora Beto' });
  assert.deepEqual([beto.rol, beto.nombre], ['proveedor', 'Distribuidora Beto']);
  assert.ok(!JSON.stringify(eventos).includes('2222 2222'), 'los eventos no llevan teléfonos');
});

test('un proveedor crea un producto: tramos automáticos desde su precio y su tramo compite con las ofertas', async () => {
  const { red, eventos } = await redReal();
  const ana = await red.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1' });
  const { producto } = await red.crearProducto(LICITACION_SALA, { proveedorId: ana.id, nombre: 'Café molido 1 kg', unidad: 'bolsa', precio: 12_000 });
  assert.equal(producto.id, 'cafe-molido-1-kg');
  assert.equal(producto.unidadPlural, 'bolsas');
  assert.deepEqual(producto.tramos.map(t => [t.desde, t.precioUnitario]), [[1, 12_000], [10, 11_400], [25, 10_800], [50, 10_200]]);
  assert.ok(eventos.some(e => e.tipo === 'licitacion.producto'));
  await assert.rejects(red.crearProducto(LICITACION_SALA, { proveedorId: ana.id, nombre: 'cafe molido 1 KG', unidad: 'bolsa', precio: 1 }), { codigo: 'datos_invalidos' });
  await red.agregarAlCarrito(LICITACION_SALA, { telefono: TEL.caro, nombre: 'Kiosco Caro', rut: '33333333-3', productoId: producto.id, cantidad: 10 });
  const precio = () => red.licitacionAbierta()!.productos.find(p => p.id === producto.id)!.precioActual;
  assert.equal(precio(), 11_400, 'el tramo de 10 del creador');
  const beto = await red.registrarProveedor({ telefono: TEL.beto, rut: '22222222-2' });
  await red.ofertar(LICITACION_SALA, { proveedorId: beto.id, productoId: producto.id, precioUnitario: 11_000, plazoDias: 1 });
  assert.equal(precio(), 11_000, 'la oferta de otro proveedor baja el precio');
});

test('al cerrar cada producto lo gana su mejor oferta, nadie se compra a sí mismo y cada proveedor factura en su sobre', async () => {
  const { red, eventos, sobres } = await redReal();
  const ana = await red.registrarProveedor({ telefono: TEL.ana, rut: '11111111-1' });
  const beto = await red.registrarProveedor({ telefono: TEL.beto, rut: '22222222-2' });
  await red.ofertar(LICITACION_SALA, { proveedorId: ana.id, productoId: 'rollos', precioUnitario: 25_000, plazoDias: 1 });
  await red.ofertar(LICITACION_SALA, { proveedorId: beto.id, productoId: 'rollos', precioUnitario: 26_000, plazoDias: 1 });
  await red.ofertar(LICITACION_SALA, { proveedorId: beto.id, productoId: 'guantes', precioUnitario: 8_000, plazoDias: 1 });
  // Ana vende rollos pero también compra rollos y etiquetas (etiquetas: nadie ofertó).
  await red.actualizarCarrito(LICITACION_SALA, { negocioId: ana.id, items: [{ productoId: 'rollos', cantidad: 3 }, { productoId: 'etiquetas', cantidad: 1 }] });
  await red.actualizarCarrito(LICITACION_SALA, { telefono: TEL.caro, nombre: 'Kiosco Caro', rut: '33333333-3', items: [{ productoId: 'rollos', cantidad: 2 }, { productoId: 'guantes', cantidad: 4 }] });
  const ordenes = await red.cerrarLicitacion(LICITACION_SALA);
  const caro = red.negocioPorTelefono(TEL.caro)!;
  const resumen = ordenes.map(o => [o.compradorId, o.proveedorId, o.items.map(i => `${i.productoId}:${i.precioUnitario}`).join()]);
  assert.deepEqual(resumen.sort(), [
    [ana.id, beto.id, 'rollos:26000'], // Ana no se compra a sí misma: sus rollos van a la segunda mejor
    [caro.id, ana.id, 'rollos:25000'],
    [caro.id, beto.id, 'guantes:8000'],
  ].sort());
  const cerrada = eventos.find(e => e.tipo === 'licitacion.cerrada')!.datos as { sinProveedor: unknown[] };
  assert.deepEqual(cerrada.sinProveedor, [{ productoId: 'etiquetas', cantidad: 1 }]);
  const l = red.estadoDeLaRed().licitaciones.find(x => x.id === LICITACION_SALA)!;
  assert.equal(l.productos.find(p => p.id === 'rollos')?.ganadora?.proveedorId, ana.id);

  const deBeto = await red.confirmarOrdenesDeLicitacion(LICITACION_SALA, beto.id);
  assert.equal(deBeto.length, 2);
  assert.deepEqual(sobres, [[beto.id, beto.id]], 'el sí de Beto factura solo lo suyo, en un sobre');
  assert.ok(red.estadoDeLaRed().ordenes.filter(o => o.proveedorId === ana.id).every(o => o.estado === 'enviada'));
  await red.confirmarOrdenesDeLicitacion(LICITACION_SALA, ana.id);
  assert.deepEqual(sobres, [[beto.id, beto.id], [ana.id]]);
  const facturadas = eventos.filter(e => e.tipo === 'licitacion.facturada').map(e => (e.datos as { proveedorId: string }).proveedorId);
  assert.deepEqual(facturadas, [beto.id, ana.id]);
});
