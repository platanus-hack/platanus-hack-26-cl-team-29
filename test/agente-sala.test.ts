import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { conectarAgente } from '../server/agente/index.ts';
import type { TiemposSala } from '../server/agente/index.ts';
import { interpreteDeReglas } from '../server/agente/intencion.ts';
import type { Interprete } from '../server/agente/intencion.ts';
import { aplicarCambios, catalogoDe, interpretarCanastaConReglas } from '../server/agente/canasta.ts';
import { crearRedSalaFalsa } from '../server/agente/red-sala-falsa.ts';
import { enmascarar } from '../server/agente/envios.ts';
import type { Negocio } from '../server/agente/puerto.ts';
import type { MessageHandler, OutboundMessage } from '../server/whatsapp/index.ts';
import { crearAlmacenBorradoresMemoria } from '../server/agente/borradores.ts';
import type { AlmacenBorradores } from '../server/agente/borradores.ts';

// Datos ficticios: ni teléfonos ni negocios reales. La canasta es la de la demo.
const PROVEEDOR: Negocio = { id: 'prov', nombre: 'Proveedor Demo', comuna: 'Santiago', rol: 'proveedor', telefono: '56900000101' };
const REGISTRADO: Negocio = { id: 'reg', nombre: 'Almacén Registrado', comuna: 'Maipú', rol: 'comprador', telefono: '56900000202' };
const PRODUCTOS = [
  { id: 'rollos', nombre: 'Caja de rollos térmicos 80 mm (50 un.)', unidad: 'caja', unidadPlural: 'cajas', precioSolo: 32000,
    tramos: [{ desde: 1, precioUnitario: 32000 }, { desde: 10, precioUnitario: 29900 }, { desde: 25, precioUnitario: 27900 }, { desde: 50, precioUnitario: 25900 }] },
  { id: 'etiquetas', nombre: 'Rollo de etiquetas adhesivas 50x30 (1.000 un.)', unidad: 'rollo', unidadPlural: 'rollos', precioSolo: 6900,
    tramos: [{ desde: 1, precioUnitario: 6900 }, { desde: 10, precioUnitario: 6400 }, { desde: 25, precioUnitario: 5900 }] },
  { id: 'bolsas', nombre: 'Paquete de bolsas camiseta (1.000 un.)', unidad: 'paquete', unidadPlural: 'paquetes', precioSolo: 14900,
    tramos: [{ desde: 1, precioUnitario: 14900 }, { desde: 10, precioUnitario: 13900 }] },
  { id: 'guantes', nombre: 'Caja de guantes de nitrilo (100 un.)', unidad: 'caja', unidadPlural: 'cajas', precioSolo: 8900,
    tramos: [{ desde: 1, precioUnitario: 8900 }, { desde: 10, precioUnitario: 8200 }] },
];
const LICITACION = { id: 'L-sala', proveedorId: PROVEEDOR.id, productos: PRODUCTOS, cierraEn: new Date(Date.now() + 3_600_000).toISOString() };

function montar(tiempos: Partial<TiemposSala> = {}, licitacion: Partial<typeof LICITACION> = {}, opciones: { sinCanasta?: boolean; conPdf?: boolean; interprete?: Interprete; ruts?: Record<string, string | { razonSocial: string; direccion: string; comuna: string } | null>; conSend?: boolean; certificados?: { enlace(telefono: string): string }; almacenBorradores?: AlmacenBorradores } = {}) {
  const red = crearRedSalaFalsa([PROVEEDOR, REGISTRADO], { ...LICITACION, ...licitacion }, opciones);
  const enviados: { to: string; body: string; en: number }[] = [];
  const interactivos: OutboundMessage[] = [];
  const adjuntos: { to: string; link: string; filename: string }[] = [];
  const logs: string[] = [];
  const registrar = (...partes: unknown[]) => logs.push(partes.map(String).join(' '));
  let handler: MessageHandler = () => {};
  const whatsapp = {
    onMessage: (h: MessageHandler) => { handler = h; return () => {}; },
    sendText: async (to: string, body: string) => { enviados.push({ to, body, en: Date.now() }); return { ok: true as const, messageIds: [] }; },
    ...(opciones.conSend ? {
      send: async (to: string, mensaje: string | OutboundMessage) => {
        const msg = typeof mensaje === 'string' ? { body: mensaje } : mensaje;
        interactivos.push(msg);
        enviados.push({ to, body: msg.body, en: Date.now() });
        return { status: 'sent' as const, messageId: 'x' };
      },
    } : {}),
    sendDocument: async (to: string, d: { link: string; filename: string }) => {
      adjuntos.push({ to, link: d.link, filename: d.filename });
      return { ok: true as const, messageIds: [] };
    },
  };
  const agente = conectarAgente(whatsapp, red, {
    interprete: opciones.interprete ?? interpreteDeReglas,
    ...(opciones.certificados ? { certificados: opciones.certificados } : {}),
    ...(opciones.almacenBorradores ? { almacenBorradores: opciones.almacenBorradores } : {}),
    log: { info: registrar, warn: registrar, error: registrar },
    env: {},
    sala: { ventanaCascadaMs: 20, minimoDifusionMs: 150, vigilarCierreMs: 0, ...tiempos },
  });
  let n = 0;
  const escribir = async (from: string, text: string) => {
    await handler(
      { id: `m${n++}`, conversationId: from, from, contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } },
      {
        reply: async body => { enviados.push({ to: from, body, en: Date.now() }); return { ok: true, messageIds: [] }; },
        markRead: async () => ({ ok: true, messageIds: [] }),
      },
    );
  };
  const de = (to: string) => enviados.filter(e => e.to === to).map(e => e.body);
  const ultimo = (to: string) => de(to).at(-1) ?? '';
  const carrito = async (nombre: string) => (await red.licitacionAbierta())?.participantes.find(p => p.nombre === nombre)?.items;
  return { red, agente, escribir, enviados, adjuntos, de, ultimo, logs, carrito, interactivos };
}

test('bienvenida con la canasta numerada, y se suma con varios productos en uno o dos mensajes', async t => {
  const { agente, escribir, ultimo, carrito } = montar();
  t.after(() => agente.desconectar());

  await escribir('56911111001', 'Quiero sumarme');
  assert.equal(ultimo('56911111001'),
    'Hola. La sala compra en conjunto: mientras más negocios, más baja el precio. Puedes ser el primero.\n'
    + '1. Rollos, $32.000 por caja\n2. Etiquetas, $6.900 por rollo\n3. Bolsas, $14.900 por paquete\n4. Guantes, $8.900 por caja\n\n'
    + '¿Cómo se llama tu negocio y qué quieres? Ej: 4 cajas de rollos y 2 de etiquetas');
  await escribir('56911111001', 'Almacén Rosita, 4 cajas de rollos y 2 de etiquetas');
  assert.equal(ultimo('56911111001'),
    'Listo, Almacén Rosita entra con 4 cajas de rollos, 2 rollos de etiquetas.\nTotal $168.742 con IVA (neto $141.800).\nFaltan 6 cajas de rollos para bajar a $29.900.');
  assert.deepEqual(await carrito('Almacén Rosita'), [{ productoId: 'rollos', cantidad: 4 }, { productoId: 'etiquetas', cantidad: 2 }]);

  // Dos pasos: primero el nombre, después lo que quiere.
  await escribir('56911111002', 'hola');
  await escribir('56911111002', 'Panadería Sol');
  assert.equal(ultimo('56911111002'), 'Perfecto, Panadería Sol. ¿Qué quieres? Ej: 4 cajas de rollos y 2 de etiquetas');
  await escribir('56911111002', '6 de rollos');
  assert.equal(ultimo('56911111002'),
    'Listo, Panadería Sol entra con 6 cajas de rollos.\nTotal $213.486 con IVA (neto $179.400), ahorras $12.600.\nFaltan 15 cajas de rollos para bajar a $27.900.');

  // Al revés: primero lo que quiere y un número sin producto se pregunta.
  await escribir('56911111003', '3 paquetes');
  assert.match(ultimo('56911111003'), /Anotado: 3 paquetes de bolsas\. ¿Cómo se llama tu negocio\?$/);
  await escribir('56911111003', 'Minimarket Los Pinos');
  assert.match(ultimo('56911111003'), /^Listo, Minimarket Los Pinos entra con 3 paquetes de bolsas\./);
  await escribir('56911111004', 'Bazar Uno, 5');
  assert.match(ultimo('56911111004'), /¿5 de cuál\?\n1\. Rollos\n2\. Etiquetas/);
  await escribir('56911111004', 'guantes');
  assert.match(ultimo('56911111004'), /^Listo, Bazar Uno entra con 5 cajas de guantes\./);
});

test('agregar, quitar, cambiar, por número de la lista, "mi pedido" y salir con un sí', async t => {
  const { red, agente, escribir, ultimo, carrito } = montar();
  t.after(() => agente.desconectar());
  const yo = '56922222001';
  await escribir(yo, 'Minimarket Los Pinos, 4 cajas de rollos y 2 de etiquetas');

  await escribir(yo, 'agrega 3 bolsas');
  assert.match(ultimo(yo), /^Listo, Minimarket Los Pinos ahora va con 4 cajas de rollos, 2 rollos de etiquetas, 3 paquetes de bolsas\.\n/);
  await escribir(yo, 'agrega 2 bolsas más');
  assert.deepEqual((await carrito('Minimarket Los Pinos'))?.find(i => i.productoId === 'bolsas'), { productoId: 'bolsas', cantidad: 5 });
  await escribir(yo, 'quita las bolsas');
  await escribir(yo, 'cambia las etiquetas a 5');
  await escribir(yo, '2 del 4');
  assert.deepEqual(await carrito('Minimarket Los Pinos'),
    [{ productoId: 'rollos', cantidad: 4 }, { productoId: 'etiquetas', cantidad: 5 }, { productoId: 'guantes', cantidad: 2 }]);

  await escribir(yo, 'mi pedido');
  assert.equal(ultimo(yo), 'Tu pedido, Minimarket Los Pinos:\n'
    + '4 cajas de rollos a $32.000: $128.000\n5 rollos de etiquetas a $6.900: $34.500\n2 cajas de guantes a $8.900: $17.800\n'
    + 'Total $214.557 con IVA (neto $180.300). Faltan 5 rollos de etiquetas para bajar a $6.400.\n'
    + 'Para cambiarlo, escribe por ejemplo "agrega 2 de guantes" o "quita guantes".');

  await escribir(yo, 'solo rollos, 6');
  assert.deepEqual(await carrito('Minimarket Los Pinos'), [{ productoId: 'rollos', cantidad: 6 }]);

  // Salir pide un sí; un "no" lo deja como estaba.
  await escribir(yo, 'salir');
  assert.equal(ultimo(yo), 'Vas a salir de la compra y se borra tu pedido. ¿Te saco?\n1. Sí, sácame\n2. No');
  await escribir(yo, 'no');
  assert.equal(ultimo(yo), 'Perfecto, sigues en la compra con 6 cajas de rollos.');
  // Quitar lo último también es salir: pregunta igual.
  await escribir(yo, 'quita los rollos');
  assert.match(ultimo(yo), /^Así tu pedido queda vacío y sales de la compra\. ¿Te saco\?/);
  assert.equal((await red.licitacionAbierta())?.participantes.length, 1, 'sin sí no sale');
  await escribir(yo, 'sí');
  assert.equal(ultimo(yo), 'Listo, saliste de la compra conjunta. Si cambias de opinión, escribe lo que quieres.');
  assert.equal((await red.licitacionAbierta())?.participantes.length, 0);
  assert.deepEqual(red.llamadas.filter(l => l.startsWith('salirDeLicitacion')), ['salirDeLicitacion L-sala']);
});

test('un comprador ya registrado (como queda quien se suma por WhatsApp) arma su carrito y sale con "sí"', async t => {
  const { red, agente, escribir, ultimo } = montar();
  t.after(() => agente.desconectar());
  await escribir(REGISTRADO.telefono, '4 cajas de rollos y 2 de etiquetas');
  assert.match(ultimo(REGISTRADO.telefono), /^Listo, Almacén Registrado entra con 4 cajas de rollos, 2 rollos de etiquetas\./);
  await escribir(REGISTRADO.telefono, 'vaciar');
  assert.match(ultimo(REGISTRADO.telefono), /¿Te saco\?/);
  await escribir(REGISTRADO.telefono, 'sí');
  assert.equal(ultimo(REGISTRADO.telefono), 'Listo, saliste de la compra conjunta. Si cambias de opinión, escribe lo que quieres.');
  assert.equal((await red.licitacionAbierta())?.participantes.length, 0);
  // Lo de siempre del comprador sigue igual.
  await escribir(REGISTRADO.telefono, 'pide 4 sacos de harina');
  assert.match(ultimo(REGISTRADO.telefono), /^Te propongo pedir 4 sacos de harina/);
});

test('sin tope real por comprador: 80 rollos entran; solo un número absurdo se pregunta', async t => {
  const { agente, escribir, ultimo, red } = montar();
  t.after(() => agente.desconectar());
  await escribir('56933333004', 'Almacén Norte, 80 rollos');
  assert.match(ultimo('56933333004'), /^Listo, Almacén Norte entra con 80 cajas de rollos/);
  await escribir('56933333004', 'agrega 200000 de rollos');
  assert.match(ultimo('56933333004'), /demasiado grande/);
  assert.equal((await red.licitacionAbierta())?.productos?.[0].totalUnidades, 80);
});

test('cascada por producto: bajas de la misma ventana salen en una sola difusión y nadie recibe dos en menos del mínimo', async t => {
  const { agente, escribir, enviados } = montar();
  t.after(() => agente.desconectar());
  const bajas = (to: string) => enviados.filter(e => e.to === to && e.body.startsWith('¡Baj'));

  await escribir('56944444001', 'Negocio Uno, 9 de rollos y nueve de etiquetas');
  await escribir('56944444002', 'Negocio Dos, 1 de rollos y 1 de etiquetas'); // los dos productos llegan a 10
  await esperar(60);
  assert.deepEqual(bajas('56944444001').map(e => e.body),
    ['¡Bajaron los precios! La caja de rollos a $29.900, el rollo de etiquetas a $6.400. Ya son 2 negocios.']);

  await escribir('56944444003', 'Negocio Tres, 15 de rollos'); // 25: baja solo rollos
  await esperar(60);
  assert.deepEqual(bajas('56944444003').map(e => e.body), ['¡Bajó la caja de rollos a $27.900! Ya son 3 negocios.']);
  assert.equal(bajas('56944444001').length, 1, 'quien recibió una hace poco espera');
  await esperar(200);
  const [primera, segunda] = bajas('56944444001');
  assert.equal(segunda.body, '¡Bajó la caja de rollos a $27.900! Ya son 3 negocios.');
  assert.ok(segunda.en - primera.en >= 145, `separación ${segunda.en - primera.en} ms`);
});

test('cascada con proveedores que compiten por un producto: dice quién ofertó y quién respondió', async t => {
  const { red, agente, escribir, enviados } = montar();
  t.after(() => agente.desconectar());
  await escribir('56955555001', 'Negocio Uno, 10 de etiquetas');
  await esperar(200);
  const oferta = (proveedorNombre: string, precioUnitario: number, mejor = true) => red.emitir('licitacion.oferta', {
    licitacionId: 'L-sala', productoId: 'etiquetas', oferta: { proveedorId: 'p', productoId: 'etiquetas', proveedorNombre, precioUnitario, plazoDias: 2, en: '' }, mejor,
  });
  oferta('Papelera Central', 6300);
  oferta('Rollos Express', 6350, false); // no mejoró: no se cuenta
  oferta('Insumos del Sur', 6200);
  red.emitir('licitacion.precio_bajo', { licitacionId: 'L-sala', productoId: 'etiquetas', precioAnterior: 6400, precioNuevo: 6200, totalUnidades: 10 });
  await esperar(250);
  assert.equal(enviados.filter(e => e.to === '56955555001').at(-1)?.body,
    'Papelera Central ofertó $6.300. Insumos del Sur respondió $6.200. El rollo de etiquetas ya va en $6.200.');
});

test('cierre: factura solo con el sí del proveedor, una vez, y cada comprador recibe su folio con cada línea y el PDF', async t => {
  const { red, agente, escribir, ultimo, de, adjuntos } = montar({}, {}, { conPdf: true });
  t.after(() => agente.desconectar());
  await escribir('56966666001', 'Almacén Rosita, 4 cajas de rollos y 2 de etiquetas');
  await escribir('56966666002', 'Panadería Sol, 8 de rollos');

  await red.cerrarLicitacion(LICITACION.id); // el dominio cierra al llegar cierraEn
  await esperar(10);
  assert.equal(ultimo(PROVEEDOR.telefono),
    'Cerró la compra conjunta: 2 negocios, 12 cajas de rollos, 2 rollos de etiquetas. Total $443.394 con IVA (neto $372.600). ¿Las facturo todas en el SII?\n'
    + '1. Sí, factura todo\n2. Todavía no');
  assert.ok(!red.llamadas.some(l => l.startsWith('confirmarOrdenesDeLicitacion')), 'sin sí no se factura');

  await escribir(PROVEEDOR.telefono, 'Todavía no');
  assert.equal(ultimo(PROVEEDOR.telefono), 'Listo, no hice nada.');
  await escribir(PROVEEDOR.telefono, 'Sí, factura todo');
  assert.match(ultimo(PROVEEDOR.telefono), /^Cerró la compra conjunta/, 'tras un "todavía no" se vuelve a preguntar');
  await Promise.all([escribir(PROVEEDOR.telefono, '1'), escribir(PROVEEDOR.telefono, 'sí')]);
  assert.deepEqual(red.llamadas.filter(l => l.startsWith('confirmarOrdenesDeLicitacion')), ['confirmarOrdenesDeLicitacion L-sala']);
  assert.ok(de(PROVEEDOR.telefono).includes('Listo, emití 2 facturas en el SII en un solo envío. Cada negocio recibe su folio por aquí.'));

  await esperar(10);
  assert.ok(de('56966666001').includes('Tu factura folio 5190 fue emitida en el SII: 4 cajas de rollos, 2 rollos de etiquetas. '
    + 'Total $158.746 con IVA (neto $133.400). Ahorraste $8.400.\nDescárgala: https://demo.invalid/pdf/doc-5190'));
  assert.ok(de('56966666002').includes('Tu factura folio 5191 fue emitida en el SII: 8 cajas de rollos. '
    + 'Total $284.648 con IVA (neto $239.200). Ahorraste $16.800.\nDescárgala: https://demo.invalid/pdf/doc-5191'));
  assert.deepEqual(adjuntos.find(a => a.to === '56966666001'),
    { to: '56966666001', link: 'https://demo.invalid/pdf/doc-5190', filename: 'factura-5190.pdf' });
  // Tras el folio, la pregunta de recepción: con ella puede reclamar un faltante por WhatsApp.
  assert.ok(de('56966666001').some(t => t.includes('¿recibiste todo?')), 'pregunta de recepción al comprador');
  assert.equal(de('56966666001').filter(t => t.includes('¿recibiste todo?')).length, 1, 'una sola vez');
  await escribir('56966666001', 'faltaron 2 cajas');
  assert.match(ultimo('56966666001'), /^Voy a reclamar la factura en el SII por falta parcial: faltaron 2/);

  // Veredicto del SII dentro del plazo: un aviso corto, una sola vez.
  red.emitir('documento.actualizado', { documento: { ...red.documentos[0], estadoSii: 'aceptado' } });
  red.emitir('documento.actualizado', { documento: { ...red.documentos[0], estadoSii: 'aceptado' } });
  await esperar(10);
  assert.deepEqual(de('56966666001').filter(b => b.startsWith('El SII')), ['El SII aceptó tu factura folio 5190.']);
});

test('si el dominio no cierra al llegar cierraEn, el agente lo cierra', async t => {
  const { red, agente, escribir, ultimo, adjuntos } = montar({ vigilarCierreMs: 10 }, { cierraEn: new Date(Date.now() + 80).toISOString() });
  t.after(() => agente.desconectar());
  await escribir('56977777001', 'Almacén Rosita, 4 cajas de rollos');
  await esperar(150);
  assert.deepEqual(red.llamadas.filter(l => l.startsWith('cerrarLicitacion')), ['cerrarLicitacion L-sala']);
  assert.match(ultimo(PROVEEDOR.telefono), /^Cerró la compra conjunta: 1 negocio, 4 cajas de rollos\./);
  await escribir('56977777001', 'hola');
  assert.equal(ultimo('56977777001'), 'La compra conjunta ya cerró. Te escribo por aquí con tu folio apenas salga tu factura.');
  assert.equal(adjuntos.length, 0);
});

test('red sin canasta (un solo producto): el flujo de siempre sigue funcionando', async t => {
  const { agente, escribir, ultimo } = montar({}, {}, { sinCanasta: true });
  t.after(() => agente.desconectar());
  await escribir('56988888001', 'hola');
  assert.match(ultimo('56988888001'), /\n1\. Rollos, \$32\.000 por caja\n\n¿Cómo se llama tu negocio y qué quieres\? Ej: 4 cajas$/);
  await escribir('56988888001', 'Almacén Rosita, 4');
  assert.equal(ultimo('56988888001'),
    'Listo, Almacén Rosita entra con 4 cajas de rollos.\nTotal $152.320 con IVA (neto $128.000).\nFaltan 6 cajas de rollos para bajar a $29.900.');
  await escribir('56988888001', 'mejor 6');
  assert.match(ultimo('56988888001'), /^Listo, Almacén Rosita ahora va con 6 cajas de rollos\./);
});

test('los logs nunca llevan un teléfono completo', async t => {
  const { agente, escribir, logs } = montar();
  t.after(() => agente.desconectar());
  await escribir('56955555123', 'Almacén Rosita, 4 cajas de rollos');
  await escribir('56955555456', 'Panadería Sol, 8 de rollos y 2 de etiquetas');
  await escribir('56955555456', 'salir');
  await escribir('56955555456', 'sí');
  await esperar(60);
  assert.ok(logs.length > 0);
  assert.ok(logs.every(l => !/\d{6,}/.test(l)), logs.join('\n'));
  assert.ok(logs.some(l => l.includes('***123')));
  assert.ok(logs.some(l => l.includes('***456 salió')));
  assert.equal(enmascarar('+56 9 5555 5123'), '***123');
});

test('el parser de reglas entiende el carrito en lenguaje natural', () => {
  const productos = PRODUCTOS.map(p => ({ ...p, totalUnidades: 0, precioActual: p.precioSolo, siguienteTramo: null }));
  const cat = catalogoDe({ ...LICITACION, productos, participantes: [] } as never, 20);
  const leer = (texto: string) => interpretarCanastaConReglas(texto, cat);
  const fijar = (productoId: string, cantidad: number) => ({ productoId, cantidad, modo: 'fijar' });
  assert.deepEqual(leer('4 cajas de rollos y 2 de etiquetas').cambios, [fijar('rollos', 4), fijar('etiquetas', 2)]);
  assert.deepEqual(leer('Almacén Rosita, 4 cajas de rollos y 2 de etiquetas').nombre, 'Almacén Rosita');
  assert.deepEqual(leer('somos Panadería Sol y queremos tres de papel'), { nombre: 'Panadería Sol', cambios: [fijar('rollos', 3)], claro: true });
  assert.deepEqual(leer('mi negocio se llama La Picá, 2 cajas de rollos').nombre, 'La Picá');
  assert.deepEqual(leer('2 rollos de etiquetas').cambios, [fijar('etiquetas', 2)], 'la unidad de un producto no confunde');
  assert.deepEqual(leer('rollo térmico 3').cambios, [fijar('rollos', 3)]);
  assert.deepEqual(leer('agrega 3 bolsas').cambios, [{ productoId: 'bolsas', cantidad: 3, modo: 'sumar' }]);
  assert.deepEqual(leer('agrega guantes').cambios, [{ productoId: 'guantes', cantidad: 1, modo: 'sumar' }]);
  assert.deepEqual(leer('quita los guantes y las bolsas').cambios,
    [{ productoId: 'guantes', cantidad: 0, modo: 'quitar' }, { productoId: 'bolsas', cantidad: 0, modo: 'quitar' }]);
  assert.deepEqual(leer('cambia las etiquetas a 5').cambios, [fijar('etiquetas', 5)]);
  assert.deepEqual(leer('solo rollos, 6'), { cambios: [fijar('rollos', 6)], soloEstos: true, claro: true });
  assert.deepEqual(leer('2 del 3').cambios, [fijar('bolsas', 2)]);
  assert.deepEqual(leer('3 paquetes').cambios, [fijar('bolsas', 3)]);
  assert.deepEqual(leer('mejor 6'), { cambios: [], suelta: { cantidad: 6, modo: 'fijar' }, claro: true });
  assert.deepEqual(leer('rollos'), { cambios: [], sinCantidad: { productoId: 'rollos', modo: 'fijar' }, claro: true });
  assert.deepEqual(leer('80 rollos'), { cambios: [], fueraDeRango: true, claro: true });
  for (const [texto, accion] of [['mi pedido', 'ver'], ['salir', 'salir'], ['me salgo', 'salir'], ['vaciar', 'salir'],
    ['productos', 'lista'], ['sí', 'si'], ['no', 'no']] as const) assert.equal(leer(texto).accion, accion, texto);
  assert.deepEqual(leer('Quiero sumarme'), { cambios: [], claro: true });
  assert.deepEqual(leer('Bazar Uno, 5'), { nombre: 'Bazar Uno', cambios: [], suelta: { cantidad: 5, modo: 'fijar' }, claro: true });
  assert.deepEqual(leer('una caja de guantes').cambios, [fijar('guantes', 1)]);
  assert.equal(leer('¿cuánto cuesta?').claro, false);
  assert.equal(leer('hola quería saber si todavía se puede entrar a esto').claro, false);
  assert.deepEqual(aplicarCambios([{ productoId: 'rollos', cantidad: 4 }, { productoId: 'guantes', cantidad: 2 }],
    [{ productoId: 'rollos', cantidad: 3, modo: 'sumar' }, { productoId: 'guantes', cantidad: 0, modo: 'quitar' }]),
  [{ productoId: 'rollos', cantidad: 7 }]);
});

test('60 personas a la vez: todas quedan sumadas y los envíos masivos no pasan de 5 en vuelo', async t => {
  const red = crearRedSalaFalsa([PROVEEDOR], {
    ...LICITACION, productos: [{ ...PRODUCTOS[0], tramos: [{ desde: 1, precioUnitario: 32000 }, { desde: 100, precioUnitario: 24500 }] }, PRODUCTOS[1]],
  });
  let enVuelo = 0;
  let maximo = 0;
  const difusiones: string[] = [];
  let handler: MessageHandler = () => {};
  const whatsapp = {
    onMessage: (h: MessageHandler) => { handler = h; return () => {}; },
    sendText: async (to: string, body: string) => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await esperar(5);
      enVuelo--;
      difusiones.push(to);
      return { ok: true as const, messageIds: [] };
    },
  };
  const silencio = () => {};
  const agente = conectarAgente(whatsapp, red, {
    interprete: interpreteDeReglas, env: {}, log: { info: silencio, warn: silencio, error: silencio },
    sala: { ventanaCascadaMs: 10, minimoDifusionMs: 1000, vigilarCierreMs: 0 },
  });
  t.after(() => agente.desconectar());
  const respuestas: string[] = [];
  await Promise.all(Array.from({ length: 60 }, (_, i) => {
    const from = `5696600${String(i).padStart(4, '0')}`;
    const text = `Tienda ${'abcdefghij'[i % 10]}${'klmnopqrst'[Math.floor(i / 10)]}, 2 cajas de rollos y 1 de etiquetas`;
    return handler(
      { id: `c${i}`, conversationId: from, from, contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } },
      { reply: async body => { respuestas.push(body); return { ok: true, messageIds: [] }; }, markRead: async () => ({ ok: true, messageIds: [] }) },
    );
  }));
  assert.equal(respuestas.filter(r => r.startsWith('Listo,')).length, 60);
  assert.equal((await red.licitacionAbierta())?.productos?.[0].totalUnidades, 120);
  await esperar(200);
  assert.ok(new Set(difusiones).size >= 50, 'la baja al llegar a 100 llega a todos los que estaban sumados');
  assert.ok(maximo <= 5, `máximo en vuelo ${maximo}`);
});

test('"quiero 3 cajas más" de un participante suma a su canasta, no arma un pedido de catálogo', async t => {
  // Como lo leyó Claude en producción: un pedido de "cajas" (los productos de la canasta no están en el catálogo).
  const comoClaude: Interprete = {
    ...interpreteDeReglas,
    interpretar: async (texto, pregunta) => /cajas más/.test(texto)
      ? { tipo: 'pedir', producto: 'cajas', cantidad: 3 }
      : interpreteDeReglas.interpretar(texto, pregunta),
  };
  const { agente, escribir, ultimo, carrito } = montar({}, {}, { interprete: comoClaude });
  t.after(() => agente.desconectar());
  // Registrado en la red, como queda en producción quien se suma por WhatsApp.
  const yo = REGISTRADO.telefono;
  await escribir(yo, 'me sumo con 10 cajas de rollos');
  await escribir(yo, 'quiero 3 cajas más');

  assert.doesNotMatch(ultimo(yo), /Te propongo pedir/);
  assert.deepEqual(await carrito(REGISTRADO.nombre), [{ productoId: 'rollos', cantidad: 13 }]);
});

test('un pedido de algo que no es de la canasta sigue yendo al catálogo', async t => {
  const { agente, escribir, ultimo } = montar();
  t.after(() => agente.desconectar());
  await escribir(REGISTRADO.telefono, 'pide 4 sacos de harina');
  assert.match(ultimo(REGISTRADO.telefono), /Te propongo pedir 4 sacos de harina/);
});

test('un participante que pregunta otra cosa recibe la respuesta de la IA; sus acciones siguen yendo a la sala', async t => {
  const conIa: Interprete = {
    ...interpreteDeReglas,
    conversar: async e => /cuántas cajas le compré/i.test(e.texto)
      ? { tipo: 'respuesta', texto: 'Llevas 10 cajas de rollos en la compra conjunta.' }
      : interpreteDeReglas.interpretar(e.texto, e.pendiente),
  };
  const { agente, escribir, ultimo } = montar({}, {}, { interprete: conIa });
  t.after(() => agente.desconectar());
  const yo = REGISTRADO.telefono;
  await escribir(yo, 'me sumo con 10 cajas de rollos');

  await escribir(yo, '¿Cuántas cajas le compré a Devlas?');
  assert.equal(ultimo(yo), 'Llevas 10 cajas de rollos en la compra conjunta.');
  await escribir(yo, 'mi pedido');
  assert.match(ultimo(yo), /^Tu pedido, Almacén Registrado:/);
});

test('"Quiero comprar guantes" no deja al negocio llamado "comprar"', () => {
  const cat = catalogoDe({ ...LICITACION, productos: PRODUCTOS } as never, 20);
  for (const t of ['Quiero comprar guantes de nitrilo', 'pide 4 cajas de guantes', 'dame 3 cajas de rollos']) {
    assert.equal(interpretarCanastaConReglas(t, cat).nombre, undefined, t);
  }
  assert.equal(interpretarCanastaConReglas('Almacén Javier, 4 cajas de guantes', cat).nombre, 'Almacén Javier');
});

test('El mensaje del QR ("Hola Bando, quiero sumarme...") no deja al negocio llamado "Bando"', () => {
  const cat = catalogoDe({ ...LICITACION, productos: PRODUCTOS } as never, 20);
  for (const t of ['Hola Bando, quiero sumarme a la compra L-1', 'Quiero sumarme a la compra L-1', 'hola bando!']) {
    assert.equal(interpretarCanastaConReglas(t, cat).nombre, undefined, t);
  }
});

test('si la red pide RUT, primero el registro (RUT válido y dirección) y recién después el pedido', async t => {
  const { agente, escribir, ultimo, carrito, red } = montar({}, {}, { ruts: {
    '11111111-1': 'Comercial Prueba Limitada',
    '22222222-2': { razonSocial: 'Panadería Prueba SpA', direccion: 'Los Aromos 55', comuna: 'Maipú' },
  } });
  t.after(() => agente.desconectar());
  const ana = '56911111701';

  await escribir(ana, 'Almacén Ana, 2 cajas de rollos');
  assert.match(ultimo(ana), /Para sumarte necesito los datos de tu factura\. ¿Cómo quieres registrarte\?/);
  assert.doesNotMatch(ultimo(ana), /Rollos, \$/, 'antes del registro no se muestran productos');
  assert.equal(await carrito('Almacén Ana'), undefined, 'sin registro no se suma');

  await escribir(ana, '11.111.111-2');
  assert.equal(ultimo(ana), 'Ese RUT no es válido. Revisa los números y el dígito verificador, por ejemplo 12.345.678-5.\n\n¿Cuál es el RUT de tu negocio?');
  await escribir(ana, '33.333.333-3');
  assert.match(ultimo(ana), /^No encontramos ese RUT en el SII/);

  // RUT válido sin dirección en el SII: la escribe; al terminar, se atiende el pedido del primer mensaje.
  await escribir(ana, '111111111');
  assert.match(ultimo(ana), /^Tu factura saldrá a nombre de Comercial Prueba Limitada\.\n\n¿Cuál es la dirección de tu negocio para la factura\?/);
  await escribir(ana, 'no sé');
  assert.match(ultimo(ana), /^No entendí la dirección/);
  await escribir(ana, 'Av. Grecia 1234, Ñuñoa');
  assert.equal(ultimo(ana), 'Listo, quedaste registrado ✓ Tu factura sale a nombre de Comercial Prueba Limitada, Av. Grecia 1234, Ñuñoa.\n\n'
    + 'Listo, Almacén Ana entra con 2 cajas de rollos.\nTotal $76.160 con IVA (neto $64.000).\nFaltan 8 cajas de rollos para bajar a $29.900.');
  assert.deepEqual(await carrito('Almacén Ana'), [{ productoId: 'rollos', cantidad: 2 }]);
  assert.equal(red.rutPorTelefono.get(ana), '11111111-1');
  assert.deepEqual(red.direccionPorTelefono.get(ana), { direccion: 'Av. Grecia 1234', comuna: 'Ñuñoa' });

  // Todo en un mensaje, con dirección en el SII: se confirma con un botón y los números del RUT no son cantidades.
  const beto = '56911111702';
  await escribir(beto, 'Panadería Beto, 3 de bolsas, mi rut es 22.222.222-2');
  assert.equal(ultimo(beto), 'Tu factura saldrá a nombre de Panadería Prueba SpA.\n\n¿Tu factura va a Los Aromos 55, Maipú?\n1. Sí, es esa\n2. Es otra');
  await escribir(beto, '1');
  assert.match(ultimo(beto), /^Listo, quedaste registrado ✓[\s\S]*Listo, Panadería Beto entra con 3 paquetes de bolsas\./);
  assert.deepEqual(await carrito('Panadería Beto'), [{ productoId: 'bolsas', cantidad: 3 }]);
  assert.deepEqual(red.direccionPorTelefono.get(beto), { direccion: 'Los Aromos 55', comuna: 'Maipú' });

  // Ya sumada, cambia su carrito sin volver a registrarse.
  await escribir(ana, 'agrega 1 de guantes');
  assert.match(ultimo(ana), /^Listo, Almacén Ana ahora va con/);
});

test('la lista de productos de la bienvenida sale como lista desplegable de WhatsApp', async t => {
  const { agente, escribir, interactivos } = montar({}, {}, { conSend: true });
  t.after(() => agente.desconectar());
  await escribir('56922222077', 'hola, quiero sumarme');
  const lista = interactivos.find(i => i.list)?.list;
  assert.ok(lista, 'salió una lista');
  assert.deepEqual(lista!.rows.map(r => r.title), ['Rollos', 'Etiquetas', 'Bolsas', 'Guantes']);
});

test('registro: elegir certificado digital (el RUT sale de él) o RUT y dirección, antes de ver productos', async t => {
  const certificados = { enlace: (telefono: string) => `https://bando.test/certificado/tok-${telefono}` };
  const ruts = { '11111111-1': { razonSocial: 'Comercial Prueba Limitada', direccion: 'Los Aromos 55', comuna: 'Maipú' } };
  const { agente, escribir, ultimo, carrito } = montar({}, {}, { ruts, certificados });
  t.after(() => agente.desconectar());

  // Camino certificado: link, y al conectarlo el registro sigue con el RUT del titular.
  const ana = '56911111801';
  await escribir(ana, 'Hola quiero sumarme');
  assert.match(ultimo(ana), /¿Cómo quieres registrarte\?[\s\S]*\n1\. Certificado digital\n2\. RUT y dirección$/);
  await escribir(ana, '1');
  assert.match(ultimo(ana), /https:\/\/bando\.test\/certificado\/tok-56911111801/);
  await agente.certificadoConectado(ana, '11111111-1');
  assert.match(ultimo(ana), /^Tu factura saldrá a nombre de Comercial Prueba Limitada\.\n\n¿Tu factura va a Los Aromos 55, Maipú\?/);
  await escribir(ana, 'sí');
  assert.match(ultimo(ana), /^Listo, quedaste registrado ✓[\s\S]*¿Cómo se llama tu negocio/, 'recién ahora los productos');

  // Camino RUT y dirección.
  const beto = '56911111802';
  await escribir(beto, 'Almacén Beto, 2 cajas de rollos');
  await escribir(beto, '2');
  assert.match(ultimo(beto), /¿Cuál es el RUT de tu negocio\?/);
  await escribir(beto, '11.111.111-1');
  await escribir(beto, '2');
  assert.match(ultimo(beto), /^¿Cuál es la dirección de tu negocio para la factura\?/);
  await escribir(beto, 'Pasaje Uno 45, Macul');
  assert.deepEqual(await carrito('Almacén Beto'), [{ productoId: 'rollos', cantidad: 2 }]);
});

test('cantidades como las escribe la gente: "las 4 q faltan" suma, "10 en total" fija, un número que bajaría se pregunta', async t => {
  const { agente, escribir, ultimo, carrito } = montar();
  t.after(() => agente.desconectar());
  const yo = REGISTRADO.telefono;
  const guantes = async () => (await carrito(REGISTRADO.nombre))?.find(i => i.productoId === 'guantes')?.cantidad;

  await escribir(yo, 'me sumo con 6 cajas de guantes');
  await escribir(yo, 'Ya dle comprolas 4 q faltan');           // captura real: bajaba a 4
  assert.equal(await guantes(), 10);

  await escribir(yo, 'Nopo quiero las 4 en totals pa q sea mas barato'); // "más barato" no es "más cajas"
  assert.equal(await guantes(), 4);
  await escribir(yo, 'pon 4 más');
  assert.equal(await guantes(), 8);

  await escribir(yo, '5');                                      // bajaría de 8 a 5 sin decirlo: se pregunta
  assert.match(ultimo(yo), /¿Quedas en 5 o sumo 5 \(13 en total\)\?\n1\. Quedar en 5\n2\. Sumar \(13\)$/);
  assert.equal(await guantes(), 8, 'no cambia hasta que responda');
  await escribir(yo, '2');
  assert.equal(await guantes(), 13);
  await escribir(yo, '3');
  await escribir(yo, '1');
  assert.equal(await guantes(), 3);
  await escribir(yo, 'mejor 2');                                // explícito: baja sin preguntar
  assert.equal(await guantes(), 2);
});

test('si el SII no confirma un RUT válido, el registro sigue con la dirección que escribe', async t => {
  const { agente, escribir, ultimo, carrito, red } = montar({}, {}, { ruts: { '77865227-7': null } });
  t.after(() => agente.desconectar());
  const yo = '56911111901';
  await escribir(yo, 'Almacén Javier, 2 cajas de rollos');
  await escribir(yo, '77.865.227-7');
  assert.match(ultimo(yo), /^No pudimos confirmar tu RUT con el SII ahora\.[\s\S]*¿Cuál es la dirección de tu negocio para la factura\?/);
  await escribir(yo, 'Av. Escuela Agrícola 1710, Macul');
  assert.match(ultimo(yo), /^Listo, quedaste registrado ✓ Tu factura sale a tu RUT, Av\. Escuela Agrícola 1710, Macul\.[\s\S]*Listo, Almacén Javier entra con 2 cajas de rollos\./);
  assert.deepEqual(await carrito('Almacén Javier'), [{ productoId: 'rollos', cantidad: 2 }]);
  assert.equal(red.rutPorTelefono.get(yo), '77865227-7');
});

test('registro: corrige el RUT en vez de leerlo como dirección, y acepta dirección en el mismo mensaje, "sin número" y la comuna aparte', async t => {
  const { agente, escribir, ultimo, red } = montar({}, {}, { ruts: {
    '11111111-1': { razonSocial: 'Persona Equivocada', direccion: 'Calle Uno 1', comuna: 'Macul' },
    '22222222-2': 'Negocio Correcto SpA',
    '33333333-3': 'Parcela El Tambo',
  } });
  t.after(() => agente.desconectar());

  // Dio un RUT, vio que no era el suyo y escribió el correcto: se consulta de nuevo.
  const ana = '56911111801';
  await escribir(ana, 'hola');
  await escribir(ana, '2');
  await escribir(ana, '11.111.111-1');
  assert.match(ultimo(ana), /Persona Equivocada[\s\S]*¿Tu factura va a Calle Uno 1, Macul\?/);
  await escribir(ana, '22.222.222-2');
  assert.match(ultimo(ana), /^Tu factura saldrá a nombre de Negocio Correcto SpA\./);
  await escribir(ana, 'ese era el rut, consulta de nuevo');
  assert.match(ultimo(ana), /¿Cuál es el RUT de tu negocio\?/);
  await escribir(ana, '22222222-2');
  await escribir(ana, 'Av. Grecia 1234, Ñuñoa');
  assert.match(ultimo(ana), /^Listo, quedaste registrado ✓ Tu factura sale a nombre de Negocio Correcto SpA, Av\. Grecia 1234, Ñuñoa\./);
  assert.equal(red.rutPorTelefono.get(ana), undefined, 'el RUT queda al sumarse a la compra');

  // RUT y dirección rural en el mismo mensaje.
  const beto = '56911111802';
  await escribir(beto, 'hola');
  await escribir(beto, '2');
  await escribir(beto, '33333333-3 y direccion el tambo sin numero, san vicente de tagua tagua');
  assert.match(ultimo(beto), /^Listo, quedaste registrado ✓ Tu factura sale a nombre de Parcela El Tambo, el tambo sin numero, san vicente de tagua tagua\./);

  // Calle y número sin comuna: se pide solo la comuna.
  const caro = '56911111803';
  await escribir(caro, 'hola');
  await escribir(caro, '2');
  await escribir(caro, '33333333-3');
  await escribir(caro, 'Parcela 83 el tambo');
  assert.equal(ultimo(caro), '¿En qué comuna? Ej: Ñuñoa');
  await escribir(caro, 'San Vicente');
  assert.match(ultimo(caro), /^Listo, quedaste registrado ✓ .*Parcela 83 el tambo, San Vicente\./);
});

test('el registro a medias sobrevive a un reinicio del servidor', async t => {
  const almacenBorradores = crearAlmacenBorradoresMemoria();
  const antes = montar({}, {}, { ruts: { '22222222-2': 'Negocio Correcto SpA' }, almacenBorradores });
  const tel = '56911111804';
  await antes.escribir(tel, 'hola');
  await antes.escribir(tel, '2');
  await antes.escribir(tel, '22222222-2');
  assert.match(antes.ultimo(tel), /¿Cuál es la dirección de tu negocio/);
  antes.agente.desconectar();

  const despues = montar({}, {}, { ruts: { '22222222-2': 'Negocio Correcto SpA' }, almacenBorradores });
  t.after(() => despues.agente.desconectar());
  await despues.escribir(tel, 'Av. Grecia 1234, Ñuñoa');
  assert.match(despues.ultimo(tel), /^Listo, quedaste registrado ✓ Tu factura sale a nombre de Negocio Correcto SpA/);
});

test('baja por una oferta con tramos: dice quién ofertó sin su precio base, y "la unidad"', async () => {
  const { bajoPrecio } = await import('../server/agente/mensajes.ts');
  const p = { id: 'coca', nombre: 'CocaCola 330ml', unidad: 'unidad', unidadPlural: 'unidades', precioActual: 850, precioSolo: 1000 } as never;
  assert.equal(bajoPrecio([{ producto: p, precio: 850, ofertas: [{ proveedorNombre: 'Cecilia bistro', precioUnitario: 950 }] }], 1),
    'Cecilia bistro ofertó. La unidad de cocacola ya va en $850.');
});

test('quien nombra una compra abierta ("quiero sumarme a la compra L-7", el texto del QR) entra a esa, no a la sala', async t => {
  const { red, agente, escribir, ultimo } = montar({}, { id: 'L-7' });
  t.after(() => agente.desconectar());
  const l7 = red.licitacionAbierta.bind(red);
  // La sala es otra compra (aquí, ninguna abierta): solo quien nombra L-7 llega a ella.
  Object.assign(red, { licitacionAbierta: () => null, licitacionPorId: (id: string) => (id === 'L-7' ? l7() : null) });

  await escribir('56911111009', 'Quiero sumarme');
  assert.equal(ultimo('56911111009'), 'En este momento no hay una compra conjunta abierta.', 'sin nombrarla, va a la sala');
  await escribir('56911111008', 'Quiero sumarme a la compra L-7');
  assert.match(ultimo('56911111008'), /La sala compra en conjunto/, 'nombrándola, entra a L-7');
  await escribir('56911111008', 'Almacén Rosita, 4 cajas de rollos');
  assert.match(ultimo('56911111008'), /Almacén Rosita entra con 4 cajas de rollos/, 'y sigue en L-7 sin repetir el número');
});
