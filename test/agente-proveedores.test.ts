// Proveedores por WhatsApp de punta a punta con la red real (en memoria, sin ficticios): se registran con su
// certificado, suman productos, ofertan, se avisan cuando los superan y cada ganador factura lo suyo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { conectarAgente, type OpcionesAgente } from '../server/agente/index.ts';
import type { ListaDeProductos } from '../server/agente/proveedor.ts';
import { sugerirProductos, type ProductoConocido } from '../shared/productos.ts';
import { interpretarConReglas, interpreteDeReglas } from '../server/agente/intencion.ts';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { iniciarCatalogos } from '../server/catalogo/index.ts';
import type { MessageHandler } from '../server/whatsapp/index.ts';

const ANA = '56911110001';
const BETO = '56911110002';
const CARO = '56911110003';

async function montar(env: NodeJS.ProcessEnv = {}, productos?: ListaDeProductos, biblioteca?: OpcionesAgente['biblioteca']) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const enviados: { to: string; body: string }[] = [];
  const conexiones: string[] = [];
  let handler: MessageHandler = () => {};
  const whatsapp = {
    onMessage: (h: MessageHandler) => { handler = h; return () => {}; },
    sendText: async (to: string, body: string) => { enviados.push({ to, body }); return { ok: true as const, messageIds: [] }; },
  };
  const silencio = () => {};
  const agente = conectarAgente(whatsapp, red, {
    interprete: interpreteDeReglas,
    certificados: { enlace: tel => `https://bando.test/certificado/${tel}` },
    conexionSii: {
      conectar: async (rutEmpresa, rutTitular) => { conexiones.push(`${rutEmpresa} con ${rutTitular}`); },
      estado: async () => ({ listo: true, enCurso: false, detalle: null }),
    },
    revisarSiiMs: 5,
    log: { info: silencio, warn: silencio, error: silencio },
    env,
    sala: { ventanaCascadaMs: 10, minimoDifusionMs: 0, vigilarCierreMs: 0 },
    ...(productos ? { productos } : {}),
    ...(biblioteca ? { biblioteca } : {}),
  });
  let n = 0;
  const escribir = async (from: string, text: string) => {
    await handler(
      { id: `m${n++}`, conversationId: from, from, contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } },
      { reply: async body => { enviados.push({ to: from, body }); return { ok: true, messageIds: [] }; }, markRead: async () => ({ ok: true, messageIds: [] }) },
    );
  };
  const de = (to: string) => enviados.filter(e => e.to === to).map(e => e.body);
  const ultimo = (to: string) => de(to).at(-1) ?? '';
  return { red, agente, escribir, de, ultimo, conexiones };
}

test('las reglas entienden ofertas, productos nuevos y quien quiere vender', () => {
  assert.deepEqual(interpretarConReglas('oferto $25.000 por rollos'), { tipo: 'ofertar', precio: 25_000, producto: 'rollos' });
  assert.deepEqual(interpretarConReglas('te lo dejo en 24.500'), { tipo: 'ofertar', precio: 24_500 });
  assert.deepEqual(interpretarConReglas('vendo café molido 1 kg a $12.000 la bolsa'), { tipo: 'crear_producto', nombre: 'Café molido 1 kg', unidad: 'bolsa', precio: 12_000 });
  assert.deepEqual(interpretarConReglas('vendo cajas de té a 4500'), { tipo: 'crear_producto', nombre: 'Té', unidad: 'caja', precio: 4_500 });
  assert.deepEqual(interpretarConReglas('quiero vender'), { tipo: 'ser_proveedor' });
  assert.deepEqual(interpretarConReglas('mis ofertas'), { tipo: 'ver_ofertas' });
  assert.equal(interpretarConReglas('quiero 3 cajas de rollos').tipo, 'pedir', 'comprar sigue igual');
});

test('por WhatsApp: proveedores con certificado, productos, ofertas, aviso al superado y cada ganador factura lo suyo', async t => {
  const { red, agente, escribir, de, ultimo, conexiones } = await montar();
  t.after(() => agente.desconectar());

  // Ana elige "Vender": sin certificado no avanza.
  await escribir(ANA, 'hola');
  assert.match(ultimo(ANA), /Vender: ofreces tus productos/);
  await escribir(ANA, '3');
  assert.match(ultimo(ANA), /necesitas tu certificado digital[\s\S]*https:\/\/bando\.test\/certificado\//);
  await escribir(ANA, '11.111.111-1');
  assert.match(ultimo(ANA), /^Te espero con tu certificado digital/, 'el RUT escrito no reemplaza al certificado');
  await agente.certificadoConectado(ANA, '11111111-1');
  assert.match(ultimo(ANA), /^Certificado conectado ✓ ¿Con qué RUT facturas\?[\s\S]*11\.111\.111-1/);
  await escribir(ANA, '1');
  assert.match(ultimo(ANA), /ya vende en Bando ✓ Estoy conectando tu SII/);
  assert.deepEqual(conexiones, ['11111111-1 con 11111111-1']);
  await esperar(30);
  assert.ok(de(ANA).some(x => /Tu SII quedó conectado ✓/.test(x)), 'avisa cuando su SII queda listo');
  assert.equal(red.negocioPorTelefono(ANA)?.vende, true);

  // Ana suma un producto nuevo; con un sí queda en la compra.
  await escribir(ANA, 'vendo café molido 1 kg a $12.000 la bolsa');
  assert.match(ultimo(ANA), /¿Sumo "Café molido 1 kg" a la compra conjunta a \$12\.000 por bolsa\?/);
  await escribir(ANA, 'si');
  assert.match(ultimo(ANA), /"Café molido 1 kg" ya está en la compra conjunta/);
  assert.ok(red.licitacionAbierta()!.productos.some(p => p.id === 'cafe-molido-1-kg'));
  await escribir(ANA, 'oferto $25.000 por rollos');
  await escribir(ANA, 'si');
  assert.match(ultimo(ANA), /ofertaste \$25\.000 por caja[\s\S]*Vas ganando/);

  // Beto ya compraba (escribe "quiero vender") y factura con otra empresa.
  await escribir(BETO, 'quiero vender');
  await agente.certificadoConectado(BETO, '22222222-2');
  await escribir(BETO, '2');
  assert.match(ultimo(BETO), /Escribe el RUT de la empresa/);
  await escribir(BETO, '33.333.333-3');
  assert.match(ultimo(BETO), /ya vende en Bando ✓/);
  assert.deepEqual(conexiones.at(-1), '33333333-3 con 22222222-2');

  // Beto oferta por el café sin decir cuál producto: se le pregunta. Al ganar, Ana recibe el aviso.
  await escribir(BETO, 'te lo dejo en 11.000');
  assert.match(ultimo(BETO), /¿Por cuál producto\?/);
  await escribir(BETO, 'oferto 11000 por cafe');
  await escribir(BETO, 'si');
  assert.match(ultimo(BETO), /Vas ganando/);
  await esperar(10);
  assert.match(ultimo(ANA), /ofertó \$11\.000 por bolsa de café y ya no vas ganando/);
  await escribir(BETO, 'mis ofertas');
  assert.match(ultimo(BETO), /Café molido 1 kg: \$11\.000 por bolsa · vas ganando ✓/);

  // Ana también compra café (no se lo compra a sí misma) y Caro compra rollos y café.
  await red.agregarAlCarrito(LICITACION_SALA, { negocioId: red.negocioPorTelefono(ANA)!.id, productoId: 'cafe-molido-1-kg', cantidad: 2 });
  await red.actualizarCarrito(LICITACION_SALA, { telefono: CARO, nombre: 'Kiosco Caro', rut: '44444444-4', items: [{ productoId: 'rollos', cantidad: 2 }, { productoId: 'cafe-molido-1-kg', cantidad: 3 }] });
  await red.cerrarLicitacion(LICITACION_SALA);
  await esperar(10);
  assert.match(ultimo(ANA), /Cerró la compra conjunta: 1 negocio, 2 cajas de rollos[\s\S]*¿Las facturo todas en el SII\?/);
  assert.match(ultimo(BETO), /Cerró la compra conjunta: 2 negocios, 5 bolsas de café[\s\S]*¿Las facturo todas en el SII\?/);
  await escribir(BETO, 'si');
  assert.match(ultimo(BETO), /emití 2 facturas/);
  const deAna = red.estadoDeLaRed().ordenes.filter(o => o.proveedorId === red.negocioPorTelefono(ANA)!.id);
  assert.ok(deAna.every(o => o.estado === 'enviada'), 'el sí de Beto no factura lo de Ana');
  await escribir(ANA, 'si');
  assert.match(ultimo(ANA), /emití 1 factura/);
});

test('con DEMO_PROVEEDOR_SIN_CERTIFICADO=1 se puede vender sin certificado escribiendo el RUT, sin conectar el SII', async t => {
  const { red, agente, escribir, ultimo, conexiones } = await montar({ DEMO_PROVEEDOR_SIN_CERTIFICADO: '1' });
  t.after(() => agente.desconectar());
  await escribir(ANA, 'quiero vender');
  assert.match(ultimo(ANA), /Prueba sin certificado: escribe el RUT de tu negocio/);
  await escribir(ANA, '11.111.111-1');
  assert.match(ultimo(ANA), /ya vende en Bando ✓[\s\S]*tus facturas saldrán simuladas/);
  assert.deepEqual(conexiones, [], 'sin certificado no se conecta el SII');
  assert.equal(red.negocioPorTelefono(ANA)?.vende, true);
  await escribir(ANA, 'oferto $25.000 por rollos');
  await escribir(ANA, 'si');
  assert.match(ultimo(ANA), /ofertaste \$25\.000/);
});

test('por WhatsApp: sin compra abierta, "vendo ..." agrega el producto a su lista con tramos sugeridos', async t => {
  const catalogos = await iniciarCatalogos({ emitir: () => {} });
  const { red, agente, escribir, ultimo } = await montar({}, catalogos);
  t.after(() => agente.desconectar());
  await escribir(ANA, 'quiero vender');
  await agente.certificadoConectado(ANA, '11111111-1');
  await escribir(ANA, '1');
  await red.cerrarLicitacion(LICITACION_SALA);

  await escribir(ANA, 'vendo etiquetas adhesivas a $2.000 el rollo');
  assert.match(ultimo(ANA), /¿Agrego "Etiquetas adhesivas" a tus productos a \$2\.000 por rollo\?/);
  await escribir(ANA, 'si');
  assert.match(ultimo(ANA), /"Etiquetas adhesivas" quedó en tus productos/);
  const lista = catalogos.de(red.negocioPorTelefono(ANA)!.id)!.productos.filter(p => p.manual);
  assert.deepEqual(lista.map(p => [p.nombre, p.unidad, p.tramos[0].precioUnitario]), [['Etiquetas adhesivas', 'rollo', 2000]]);
});

test('por WhatsApp: un comprador abre una compra en grupo de algo nuevo', async t => {
  const { red, agente, escribir, ultimo } = await montar();
  t.after(() => agente.desconectar());
  await red.registrarComprador({ nombre: 'Caro', comuna: 'Ñuñoa', telefono: CARO, rut: '12.345.678-5' });
  await escribir(CARO, 'quiero comprar 10 servilletas de papel');
  assert.match(ultimo(CARO), /¿Abro una compra en grupo de "Servilletas de papel" con tus 10\?/);
  await escribir(CARO, 'si');
  assert.match(ultimo(CARO), /abriste una compra en grupo de "Servilletas de papel" con tus 10/);
  const abierta = red.estadoDeLaRed().licitaciones.find(l => l.estado === 'abierta' && l.producto === 'Servilletas de papel')!;
  assert.deepEqual([abierta.proveedorId, abierta.totalUnidades], [undefined, 10]);

  // Ya está en la de servilletas: la sala ajusta su cantidad, sin "$0" ni "mejor precio" (no hay ofertas todavía).
  await escribir(CARO, 'quiero comprar 5 servilletas de papel');
  assert.match(ultimo(CARO), /va con 5 unidades de servilletas[\s\S]*Esperando ofertas de proveedores/);
  assert.doesNotMatch(ultimo(CARO), /\$0|mejor precio\./);
});

test('por WhatsApp: "cocacola" sugiere los productos parecidos de la biblioteca o crear uno nuevo', async t => {
  const conocidos: ProductoConocido[] = [{ nombre: 'Coca-Cola 3 lts', unidad: 'botella' }, { nombre: 'Coca Cola lata 330 ml', unidad: 'unidad' }];
  // Un proveedor vende la de 3 lts a $3.000, y a $2.500 desde 10: con 12 sale a $2.500.
  const cotizar = (nombre: string, _u: string, cantidad: number) => (nombre === 'Coca-Cola 3 lts' ? { proveedores: 1, precio: cantidad >= 10 ? 2500 : 3000 } : undefined);
  const { red, agente, escribir, ultimo } = await montar({}, undefined, { buscar: q => sugerirProductos(q, conocidos), cotizar });
  t.after(() => agente.desconectar());
  await red.registrarComprador({ nombre: 'Caro', comuna: 'Ñuñoa', telefono: CARO, rut: '12.345.678-5' });

  await escribir(CARO, 'quiero comprar 12 cocacola');
  assert.match(ultimo(CARO), /parecidos a "cocacola"\. ¿Cuál es\?\n1\. Coca-Cola 3 lts \(por botella\)\n2\. Coca Cola lata 330 ml \(por unidad\)$/);
  await escribir(CARO, '1');
  assert.match(ultimo(CARO), /"Coca-Cola 3 lts": 1 proveedor lo vende en Bando\. Con tus 12, hoy sale a \$2\.500 por botella\. ¿Abro una compra en grupo\?/);
  assert.doesNotMatch(ultimo(CARO), /Ningún proveedor/);
  await escribir(CARO, 'si');
  const abierta = red.estadoDeLaRed().licitaciones.find(l => l.estado === 'abierta' && l.producto === 'Coca-Cola 3 lts')!;
  assert.deepEqual([abierta.unidad, abierta.totalUnidades], ['botella', 12]);

  await escribir(CARO, 'quiero comprar 5 cocacola zero');
  assert.match(ultimo(CARO), /Ningún proveedor vende "cocacola zero" en Bando todavía/, 'se compra solo lo que algún proveedor vende');
});

test('por WhatsApp: "agregar 10 coca colas a mi pedido" no se suma a la compra de bolsas; se ofrece la compra que tiene coca colas', async t => {
  const conocidos: ProductoConocido[] = [{ nombre: 'Coca-Cola lata 330 ml', unidad: 'unidad' }];
  const { red, agente, escribir, ultimo } = await montar({}, undefined, { buscar: q => sugerirProductos(q, conocidos) });
  t.after(() => agente.desconectar());
  const caro = (await red.registrarComprador({ nombre: 'Caro', comuna: 'Ñuñoa', telefono: CARO, rut: '12.345.678-5' })).id;
  const beto = (await red.registrarComprador({ nombre: 'Beto', comuna: 'Ñuñoa', telefono: BETO, rut: '11.111.111-1' })).id;
  // Caro está en una compra de bolsas (la más reciente) y Beto abrió una de Coca-Cola.
  const cocas = await red.abrirSolicitud({ compradorId: beto, producto: 'Coca-Cola lata 330 ml', unidad: 'unidad', cantidad: 6 });
  const bolsas = await red.abrirSolicitud({ compradorId: caro, producto: 'Bolsas camiseta', unidad: 'paquete', cantidad: 10 });

  await escribir(CARO, 'quiero agregar 10 coca colas a mi pedido');
  assert.doesNotMatch(ultimo(CARO), /paquetes de bolsas|\$0/);
  assert.match(ultimo(CARO), /¿Cuál es\?\n1\. Coca-Cola lata 330 ml/);
  await escribir(CARO, '1');
  assert.match(ultimo(CARO), /Hay una compra en grupo abierta de "Coca-Cola lata 330 ml".*¿Te sumo con 10 unidades\?/s);
  await escribir(CARO, 'si');
  const deCaro = (id: string) => red.estadoDeLaRed().licitaciones.find(l => l.id === id)!.participantes.find(p => p.negocioId === caro)?.items;
  assert.deepEqual(deCaro(cocas.id)?.map(i => i.cantidad), [10]);
  assert.deepEqual(deCaro(bolsas.id)?.map(i => i.cantidad), [10], 'las bolsas siguen igual');
});

test('por WhatsApp: "vendo ..." va a la lista del proveedor aunque haya una compra abierta, y "lata" es una unidad', async t => {
  const catalogos = await iniciarCatalogos({ emitir: () => {} });
  const { red, agente, escribir, ultimo } = await montar({}, catalogos);
  t.after(() => agente.desconectar());
  await escribir(ANA, 'quiero vender');
  await agente.certificadoConectado(ANA, '11111111-1');
  await escribir(ANA, '1');
  assert.ok(red.licitacionAbierta(), 'la compra de la sala sigue abierta');
  await escribir(ANA, 'vendo cerveza heineken 330 ml a $1.000 la lata');
  assert.match(ultimo(ANA), /¿Agrego "Cerveza heineken 330 ml" a tus productos a \$1\.000 por lata\?/);
  await escribir(ANA, 'si');
  assert.ok(!red.licitacionAbierta()!.productos.some(p => /heineken/i.test(p.nombre)), 'no entra a la compra de la sala');
  assert.deepEqual(catalogos.listas()[0]?.productos.map(p => [p.nombre, p.unidad]), [['Cerveza heineken 330 ml', 'lata']]);
});

test('por WhatsApp: quien abrió una compra en grupo la cierra antes con "cerrar la compra", si ya hay oferta', async t => {
  const { red, agente, escribir, ultimo } = await montar();
  t.after(() => agente.desconectar());
  const caro = await red.registrarComprador({ nombre: 'Caro', comuna: 'Ñuñoa', telefono: CARO, rut: '12.345.678-5' });
  await red.registrarComprador({ nombre: 'Beto', comuna: 'Ñuñoa', telefono: BETO, rut: '11.111.111-1' });
  await red.cerrarLicitacion(red.estadoDeLaRed().licitaciones.find(l => l.estado === 'abierta')!.id);
  const l = await red.abrirSolicitud({ compradorId: caro.id, producto: 'Servilletas de papel', unidad: 'paquete', cantidad: 10 });

  await escribir(BETO, 'cerrar la compra');
  assert.match(ultimo(BETO), /Solo quien inicia una compra en grupo la puede cerrar antes/);

  await escribir(CARO, 'cerrar la compra');
  assert.match(ultimo(CARO), /Todavía no puedes cerrar "Servilletas de papel": ningún proveedor ha ofertado aún/);

  const ana = await red.registrarProveedor({ telefono: ANA, rut: '76.086.428-5' });
  await red.ofertar(l.id, { proveedorId: ana.id, productoId: l.productos[0]!.id, precioUnitario: 900, plazoDias: 1 });
  await escribir(CARO, 'cierra la compra en grupo ya');
  assert.match(ultimo(CARO), /¿Cierro ahora la compra en grupo de "Servilletas de papel"\? Van 1 negocio con 10 en total, a \$900 por paquete/);
  await escribir(CARO, 'si');
  assert.match(ultimo(CARO), /Listo, cerraste la compra en grupo de "Servilletas de papel"\. El proveedor recibió 1 pedido/);
  assert.equal(red.estadoDeLaRed().licitaciones.find(x => x.id === l.id)!.estado, 'cerrada');
});
