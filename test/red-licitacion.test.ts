import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearSii } from '../server/sii/index.ts';
import {
  crearAlmacenFoliosMemoria, crearRed, crearRepositorioMemoria, crearSiiFalso, crearSiiReal,
  COMPRADOR_DEMO, LICITACION_SALA, PROVEEDOR_DEMO, PROVEEDOR_SALA,
} from '../server/red/index.ts';
import type { DatosEmision, EventoRed, Licitacion, PuertoSii } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { consultaConFicha, RUT_EMPRESA } from './sii-apoyo.ts';

const ENV = { DEMO_FICTICIOS: '1', DEMO_TELEFONO_PROVEEDOR: '+56 9 0000 0099' };

async function redDePrueba(sii: PuertoSii = crearSiiFalso()) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), ENV);
  const red = await crearRed({ repo, sii, env: ENV, consultarContribuyente: consultaConFicha });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos, repo };
}

test('la compra conjunta parte abierta, con el proveedor de la sala, tramos y producto por defecto', async () => {
  const { red } = await redDePrueba();
  const l = red.licitacionAbierta()!;
  assert.equal(l.id, LICITACION_SALA);
  assert.equal(l.proveedorId, PROVEEDOR_SALA);
  assert.equal(l.producto, 'Caja de rollos térmicos 80 mm (50 un.)');
  assert.deepEqual([l.unidad, l.unidadPlural, l.precioSolo, l.totalUnidades, l.precioActual], ['caja', 'cajas', 32000, 0, 32000]);
  assert.deepEqual(l.siguienteTramo, { desde: 1, precioUnitario: 32000, faltan: 1 });
  assert.ok(!(PROVEEDOR_SALA in red.estadoPublico().notas), 'la empresa real no entra al ranking ficticio');
});

test('el precio baja por tramos a medida que la sala se suma y avisa con licitacion.precio_bajo', async () => {
  const { red, eventos } = await redDePrueba();
  const primero = await red.unirseALicitacion('L-1', { nombre: 'Ana', cantidad: 9 });
  assert.deepEqual([primero.precioActual, primero.bajoDePrecio], [32000, false]);
  assert.deepEqual(primero.licitacion.siguienteTramo, { desde: 10, precioUnitario: 29900, faltan: 1 });

  const segundo = await red.unirseALicitacion('L-1', { telefono: '+56 9 1111 2222', nombre: 'Beto', cantidad: 1 });
  assert.deepEqual([segundo.precioActual, segundo.bajoDePrecio, segundo.licitacion.totalUnidades], [29900, true, 10]);
  assert.deepEqual(eventos.map(e => e.tipo), ['licitacion.participante', 'licitacion.participante', 'licitacion.precio_bajo']);
  assert.deepEqual(eventos.at(-1)?.datos, { licitacionId: 'L-1', productoId: 'rollos', precioAnterior: 32000, precioNuevo: 29900, totalUnidades: 10 });

  await assert.rejects(red.unirseALicitacion('L-1', { nombre: 'Ana', cantidad: 0 }), { codigo: 'datos_invalidos' });
  await assert.rejects(red.unirseALicitacion('L-1', { nombre: 'Ana', cantidad: 21 }), { codigo: 'datos_invalidos' });
  await assert.rejects(red.unirseALicitacion('L-1', { nombre: '', cantidad: 1 }), { codigo: 'datos_invalidos' });
});

test('el mismo teléfono que vuelve a sumarse cambia su cantidad, no se duplica, y el proveedor no puede sumarse', async () => {
  const { red } = await redDePrueba();
  await red.unirseALicitacion('L-1', { telefono: '56911112222', nombre: 'Beto', cantidad: 3 });
  const r = await red.unirseALicitacion('L-1', { telefono: '+56 9 1111 2222', nombre: 'Beto', cantidad: 5 });
  assert.equal(r.licitacion.participantes.length, 1);
  assert.equal(r.licitacion.totalUnidades, 5);
  const negocio = red.negocioPorTelefono('56911112222');
  assert.equal(negocio?.rol, 'comprador');
  assert.equal(r.participante.negocioId, negocio?.id);
  assert.equal(red.telefonoDeNegocio(negocio!.id), '56911112222');
  await assert.rejects(red.unirseALicitacion('L-1', { telefono: '56900000099', nombre: 'Yo', cantidad: 1 }), { codigo: 'datos_invalidos' });
});

test('toda la sala a la vez: los pedidos simultáneos se ponen en fila, ninguno se pierde', async () => {
  const { red } = await redDePrueba();
  await Promise.all(Array.from({ length: 30 }, (_, i) => red.unirseALicitacion('L-1', { telefono: `5699000${String(i).padStart(4, '0')}`, nombre: `P${i}`, cantidad: 1 })));
  assert.equal(red.licitacionAbierta()?.totalUnidades, 30);
  assert.equal(red.licitacionAbierta()?.precioActual, 27900);
});

test('al cerrar se crea una orden por participante al proveedor de la sala, incluido el público sin negocio', async () => {
  const { red, eventos } = await redDePrueba();
  await red.unirseALicitacion('L-1', { nombre: 'Ana', comuna: 'Ñuñoa', cantidad: 4 });
  await red.unirseALicitacion('L-1', { telefono: '56911112222', nombre: 'Beto', cantidad: 3 });
  await red.unirseALicitacion('L-1', { negocioId: COMPRADOR_DEMO, cantidad: 3 });

  const ordenes = await red.cerrarLicitacion('L-1');
  assert.equal(ordenes.length, 3);
  assert.ok(ordenes.every(o => o.proveedorId === PROVEEDOR_SALA && o.estado === 'enviada' && o.items[0].precioUnitario === 29900));
  const ana = red.estadoDeLaRed().negocios.find(n => n.id === ordenes[0].compradorId);
  assert.deepEqual([ana?.nombre, ana?.rol], ['Ana', 'comprador']);
  assert.equal(ordenes[2].compradorId, COMPRADOR_DEMO);
  assert.equal(eventos.at(-1)?.tipo, 'licitacion.cerrada');
  assert.equal(red.licitacionAbierta(), null);
  await assert.rejects(red.unirseALicitacion('L-1', { nombre: 'Tarde', cantidad: 1 }), { codigo: 'transicion_invalida' });

  // Cerrar dos veces (agente al llegar cierraEn y proveedor a la vez) no crea órdenes nuevas ni eventos.
  const antes = eventos.length;
  const [otra, mismas] = await Promise.all([red.cerrarLicitacion('L-1'), red.cerrarLicitacion('L-1')]);
  assert.deepEqual(otra.map(o => o.id), ordenes.map(o => o.id));
  assert.deepEqual(mismas.map(o => o.id), ordenes.map(o => o.id));
  assert.equal(red.estadoDeLaRed().ordenes.length, 3);
  assert.equal(eventos.length, antes);
});

test('el sí del proveedor confirma todo y emite todas las facturas en un solo envío', async () => {
  const lotes: DatosEmision[][] = [];
  const falso = crearSiiFalso();
  const { red, eventos } = await redDePrueba({ ...falso, emitirFacturas: d => { lotes.push([...d]); return falso.emitirFacturas(d); } });
  await assert.rejects(red.confirmarOrdenesDeLicitacion('L-1'), { codigo: 'transicion_invalida' });
  await red.unirseALicitacion('L-1', { nombre: 'Ana', cantidad: 6 });
  await red.unirseALicitacion('L-1', { nombre: 'Beto', cantidad: 4 });
  const ordenes = await red.cerrarLicitacion('L-1');
  eventos.length = 0;

  const facturas = await red.confirmarOrdenesDeLicitacion('L-1');
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].length, 2);
  assert.deepEqual(facturas.map(f => f.tipo), [33, 33]);
  assert.equal(facturas[1].folio, facturas[0].folio + 1);
  assert.deepEqual(facturas.map(f => f.monto), [6 * 29900, 4 * 29900]);
  assert.ok(red.estadoDeLaRed().ordenes.filter(o => ordenes.some(x => x.id === o.id)).every(o => o.estado === 'facturada'));
  assert.deepEqual(eventos.map(e => e.tipo), ['orden.confirmada', 'orden.confirmada', 'documento.emitido', 'documento.emitido', 'licitacion.facturada']);
  assert.deepEqual(eventos.at(-1)?.datos, { licitacionId: 'L-1', documentos: 2, total: 10 * 29900, ahorroTotal: 10 * (32000 - 29900) });

  // Volver a llamar no emite nada nuevo.
  assert.deepEqual((await red.confirmarOrdenesDeLicitacion('L-1')).map(f => f.id), facturas.map(f => f.id));
  assert.equal(lotes.length, 1);
});

test('con el SII real: folios consecutivos del CAF en un sobre y un reinicio de la demo no los reusa', async () => {
  const silencioso = { info() {}, warn() {}, error() {} };
  const base = crearSii({ env: { SII_RUT_EMISOR: RUT_EMPRESA }, log: silencioso });
  let subidas = 0;
  const sii = { ...base, emitirFacturas: (e: Parameters<typeof base.emitirFacturas>[0]) => { subidas++; return base.emitirFacturas(e); } };
  const folios = crearAlmacenFoliosMemoria();
  const { red } = await redDePrueba(crearSiiReal({ sii, folios, rangos: () => [{ desde: 10, hasta: 99 }], log: silencioso, seguirEnvios: false }));

  // Con el SII real cada comprador factura a su RUT verificado.
  const unir = (nombre: string, n: number) => red.actualizarCarrito('L-1', {
    telefono: `+56 9 0000 00${n}0`, nombre, rut: `${String(n).repeat(8)}-${n}`, items: [{ productoId: red.licitacionAbierta()!.productos[0]!.id, cantidad: 2 }],
  });
  for (const [i, nombre] of ['Ana', 'Beto', 'Carla'].entries()) await unir(nombre, i + 1);
  await red.cerrarLicitacion('L-1');
  const primeras = await red.confirmarOrdenesDeLicitacion('L-1');
  assert.equal(subidas, 1);
  assert.deepEqual(primeras.map(f => [f.folio, f.estadoSii]), [[10, 'recibido'], [11, 'recibido'], [12, 'recibido']]);
  assert.equal(new Set(primeras.map(f => f.trackId)).size, 1);

  await red.reiniciarDemo();
  await unir('Dani', 4);
  await red.cerrarLicitacion('L-1');
  assert.deepEqual((await red.confirmarOrdenesDeLicitacion('L-1')).map(f => f.folio), [13]);
  assert.equal((await folios.buscar(33, 10))?.estado, 'recibido', 'el reinicio no toca los folios');
});

test('licitación antigua sin proveedor fijo: el producto lo gana el menor precio ajustado por nota y compran todos', async () => {
  const { red, repo } = await redDePrueba();
  // Guardada antes de la canasta: sin `productos` ni `items` en los participantes.
  const antigua = {
    id: 'L-0', producto: 'Harina 25 kg', unidad: 'saco', unidadPlural: 'sacos', comuna: 'Ñuñoa', cierraEn: new Date().toISOString(),
    precioSolo: 21500, tramos: [{ desde: 1, precioUnitario: 21500 }], estado: 'abierta',
    participantes: [{ negocioId: COMPRADOR_DEMO, nombre: 'La Picá de Ñuñoa', cantidad: 3, en: new Date().toISOString() }],
    ofertas: [
      { proveedorId: 'n-molinos-del-sur', precioUnitario: 17100, plazoDias: 2, en: new Date().toISOString() },
      { proveedorId: PROVEEDOR_DEMO, precioUnitario: 17200, plazoDias: 1, en: new Date().toISOString() },
    ],
  } as unknown as Licitacion;
  await repo.guardar('licitaciones', antigua);
  const red2 = await crearRed({ repo, sii: crearSiiFalso(), env: ENV });
  await red2.unirseALicitacion('L-0', { nombre: 'Público', cantidad: 2 });
  const ordenes = await red2.cerrarLicitacion('L-0');
  assert.equal(ordenes.length, 2, 'una por participante; al público se le crea su negocio');
  assert.ok(ordenes.every(o => o.proveedorId === PROVEEDOR_DEMO && o.items[0].precioUnitario === 17200));
  assert.equal(red2.estadoDeLaRed().licitaciones.find(l => l.id === 'L-0')?.productos[0]?.ganadora?.proveedorId, PROVEEDOR_DEMO);
  assert.ok(red);
});

test('una oferta nueva del mismo proveedor reemplaza la anterior y un comprador no puede ofertar', async () => {
  const { red } = await redDePrueba();
  await red.ofertar('L-1', { proveedorId: 'n-harinas-andes', precioUnitario: 17000, plazoDias: 1 });
  const l = await red.ofertar('L-1', { proveedorId: 'n-harinas-andes', precioUnitario: 16900, plazoDias: 1 });
  assert.deepEqual(l.ofertas.map(o => o.precioUnitario), [16900]);
  await assert.rejects(red.ofertar('L-1', { proveedorId: COMPRADOR_DEMO, precioUnitario: 100, plazoDias: 1 }), { codigo: 'datos_invalidos' });
});
