// Proveedores por WhatsApp de punta a punta con la red real (en memoria, sin ficticios): se registran con su
// certificado, suman productos, ofertan, se avisan cuando los superan y cada ganador factura lo suyo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { conectarAgente } from '../server/agente/index.ts';
import { interpretarConReglas, interpreteDeReglas } from '../server/agente/intencion.ts';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import type { MessageHandler } from '../server/whatsapp/index.ts';

const ANA = '56911110001';
const BETO = '56911110002';
const CARO = '56911110003';

async function montar(env: NodeJS.ProcessEnv = {}) {
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

test('por WhatsApp: sin compra abierta, "vendo ..." abre una compra en grupo nueva con ese producto', async t => {
  const { red, agente, escribir, ultimo } = await montar();
  t.after(() => agente.desconectar());
  await escribir(ANA, 'quiero vender');
  await agente.certificadoConectado(ANA, '11111111-1');
  await escribir(ANA, '1');
  await red.cerrarLicitacion(LICITACION_SALA);
  assert.equal(red.licitacionAbierta(), null);

  await escribir(ANA, 'vendo etiquetas adhesivas a $2.000 el rollo');
  assert.match(ultimo(ANA), /No hay una compra en grupo abierta\. ¿Abro una con "Etiquetas adhesivas" a \$2\.000 por rollo\?/);
  await escribir(ANA, 'si');
  assert.match(ultimo(ANA), /abriste una compra en grupo con "Etiquetas adhesivas"/);
  const abierta = red.licitacionAbierta()!;
  assert.notEqual(abierta.id, LICITACION_SALA);
  assert.deepEqual([abierta.productos.map(p => p.nombre), abierta.proveedorId], [['Etiquetas adhesivas'], red.negocioPorTelefono(ANA)!.id]);
  await assert.rejects(red.abrirCompra({ proveedorId: abierta.proveedorId!, nombre: 'Té verde', unidad: 'caja', precio: 5000 }), /Ya hay una compra en grupo abierta/);
});
