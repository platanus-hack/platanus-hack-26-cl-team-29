import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { conectarAgente } from '../server/agente/index.ts';
import type { TiemposSala } from '../server/agente/index.ts';
import { interpreteDeReglas, interpretarSalaConReglas } from '../server/agente/intencion.ts';
import { crearRedSalaFalsa } from '../server/agente/red-sala-falsa.ts';
import { enmascarar } from '../server/agente/envios.ts';
import type { Negocio } from '../server/agente/puerto.ts';
import type { MessageHandler } from '../server/whatsapp/index.ts';

// Datos ficticios: ni teléfonos ni negocios reales.
const PROVEEDOR: Negocio = { id: 'prov', nombre: 'Proveedor Demo', comuna: 'Santiago', rol: 'proveedor', telefono: '56900000101' };
const LICITACION = {
  id: 'L-sala', producto: 'Caja de rollos térmicos 80 mm (50 un.)', unidad: 'caja', unidadPlural: 'cajas', proveedorId: PROVEEDOR.id,
  precioSolo: 32000,
  tramos: [{ desde: 1, precioUnitario: 32000 }, { desde: 10, precioUnitario: 29900 }, { desde: 25, precioUnitario: 27900 }, { desde: 50, precioUnitario: 25900 }],
  cierraEn: new Date(Date.now() + 3_600_000).toISOString(),
};

function montar(tiempos: Partial<TiemposSala> = {}, licitacion: Partial<typeof LICITACION> = {}) {
  const red = crearRedSalaFalsa([PROVEEDOR], { ...LICITACION, ...licitacion });
  const enviados: { to: string; body: string; en: number }[] = [];
  const logs: string[] = [];
  const registrar = (...partes: unknown[]) => logs.push(partes.map(String).join(' '));
  let handler: MessageHandler = () => {};
  const whatsapp = {
    onMessage: (h: MessageHandler) => { handler = h; return () => {}; },
    sendText: async (to: string, body: string) => { enviados.push({ to, body, en: Date.now() }); return { ok: true as const, messageIds: [] }; },
  };
  const agente = conectarAgente(whatsapp, red, {
    interprete: interpreteDeReglas,
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
  return { red, agente, escribir, enviados, de, ultimo, logs };
}

test('el público se suma en un mensaje o en dos, y el mismo teléfono cambia su cantidad', async t => {
  const { red, agente, escribir, ultimo } = montar();
  t.after(() => agente.desconectar());

  await escribir('56911111001', 'Quiero sumarme');
  assert.equal(ultimo('56911111001'),
    'Hola. La sala está comprando Caja de rollos térmicos 80 mm (50 un.) en conjunto. Hoy va en $32.000 por caja y puedes ser el primero en sumarte.\n\n'
    + '¿Cómo se llama tu negocio y cuántas cajas quieres?');
  await escribir('56911111001', 'Almacén Rosita, 4');
  assert.equal(ultimo('56911111001'), 'Listo, Almacén Rosita entra con 4 cajas. Hoy va en $32.000. Faltan 6 cajas para bajar a $29.900: invita a otro.');

  // Dos pasos: primero el nombre, después la cantidad.
  await escribir('56911111002', 'hola');
  await escribir('56911111002', 'Panadería Sol');
  assert.equal(ultimo('56911111002'), 'Perfecto, Panadería Sol. ¿Cuántas cajas quieres?');
  await escribir('56911111002', '8 cajas');
  assert.equal(ultimo('56911111002'),
    'Listo, Panadería Sol entra con 8 cajas. Hoy va en $29.900 (solo pagarías $32.000). Faltan 13 cajas para bajar a $27.900: invita a otro.');

  // Todo en el primer mensaje, al revés.
  await escribir('56911111003', '2 cajas, Minimarket Los Pinos');
  assert.match(ultimo('56911111003'), /^Listo, Minimarket Los Pinos entra con 2 cajas\./);

  // El mismo teléfono otra vez: actualiza, no duplica.
  await escribir('56911111001', 'mejor 6');
  assert.match(ultimo('56911111001'), /^Listo, Almacén Rosita ahora va con 6 cajas\. Hoy va en \$29\.900/);
  const l = await red.licitacionAbierta();
  assert.equal(l?.participantes.length, 3);
  assert.equal(l?.totalUnidades, 16);
});

test('cantidad fuera de rango y subunidades: pregunta en vez de inventar', async t => {
  const { agente, escribir, ultimo, red } = montar();
  t.after(() => agente.desconectar());
  await escribir('56911111004', 'Almacén Norte, 80 rollos');
  assert.match(ultimo('56911111004'), /\n\nAquí se compra por caja\. ¿Cuántas cajas quieres\?$/);
  await escribir('56911111004', '30');
  assert.equal(ultimo('56911111004'), 'Cada negocio puede sumar entre 1 y 20 cajas. ¿Cuántas quieres?');
  await escribir('56911111004', '3');
  assert.match(ultimo('56911111004'), /^Listo, Almacén Norte entra con 3 cajas/);
  assert.equal((await red.licitacionAbierta())?.totalUnidades, 3);
});

test('cascada: bajas seguidas salen como una sola difusión y nadie recibe dos en menos del mínimo', async t => {
  const { agente, escribir, enviados } = montar();
  t.after(() => agente.desconectar());
  const bajas = (to: string) => enviados.filter(e => e.to === to && e.body.startsWith('¡Bajó'));

  await escribir('56922222001', 'Negocio Uno, 9');
  await escribir('56922222002', 'Negocio Dos, 1'); // 10: baja a 29.900
  await escribir('56922222003', 'Negocio Tres, 15'); // 25: baja a 27.900, en la misma ventana
  await esperar(60);
  assert.deepEqual(bajas('56922222001').map(e => e.body), ['¡Bajó a $27.900 por caja! Ya son 3 negocios.']);
  assert.equal(bajas('56922222003').length, 1);

  await escribir('56922222004', 'Negocio Cuatro, 20');
  await escribir('56922222005', 'Negocio Cinco, 5'); // 50: baja a 25.900
  await esperar(60);
  assert.equal(bajas('56922222005').length, 1, 'quien no recibió difusión la recibe de inmediato');
  assert.equal(bajas('56922222001').length, 1, 'quien recibió una hace poco espera');
  await esperar(200);
  const [primera, segunda] = bajas('56922222001');
  assert.equal(segunda.body, '¡Bajó a $25.900 por caja! Ya son 5 negocios.');
  assert.ok(segunda.en - primera.en >= 145, `separación ${segunda.en - primera.en} ms`);
});

test('cierre: factura solo con el sí del proveedor, una vez, y cada comprador recibe su folio', async t => {
  const { red, agente, escribir, ultimo, de } = montar();
  t.after(() => agente.desconectar());
  await escribir('56933333001', 'Almacén Rosita, 4');
  await escribir('56933333002', 'Panadería Sol, 8');

  await red.cerrarLicitacion(LICITACION.id); // el dominio cierra al llegar cierraEn
  await esperar(10);
  assert.equal(ultimo(PROVEEDOR.telefono),
    'Cerró la compra conjunta: 2 negocios, 12 cajas a $29.900. Total $358.800. ¿Las facturo todas en el SII?\n1. Sí, factura todo\n2. Todavía no');
  assert.ok(!red.llamadas.some(l => l.startsWith('confirmarOrdenesDeLicitacion')), 'sin sí no se factura');

  await escribir(PROVEEDOR.telefono, 'Todavía no');
  assert.equal(ultimo(PROVEEDOR.telefono), 'Listo, no hice nada.');
  await escribir(PROVEEDOR.telefono, 'Sí, factura todo');
  assert.match(ultimo(PROVEEDOR.telefono), /^Cerró la compra conjunta/, 'tras un "todavía no" se vuelve a preguntar');
  assert.ok(!red.llamadas.some(l => l.startsWith('confirmarOrdenesDeLicitacion')));

  await Promise.all([escribir(PROVEEDOR.telefono, '1'), escribir(PROVEEDOR.telefono, 'sí')]);
  assert.deepEqual(red.llamadas.filter(l => l.startsWith('confirmarOrdenesDeLicitacion')), ['confirmarOrdenesDeLicitacion L-sala']);
  assert.ok(de(PROVEEDOR.telefono).includes('Listo, emití 2 facturas en el SII en un solo envío. Cada negocio recibe su folio por aquí.'));

  await esperar(10);
  assert.equal(ultimo('56933333001'), 'Tu factura folio 1042 fue emitida en el SII: 4 cajas a $29.900, total $119.600. Ahorraste $8.400.');
  assert.equal(ultimo('56933333002'), 'Tu factura folio 1043 fue emitida en el SII: 8 cajas a $29.900, total $239.200. Ahorraste $16.800.');

  // Veredicto del SII dentro del plazo: un aviso corto, una sola vez.
  red.emitir('documento.actualizado', { documento: { ...red.documentos[0], estadoSii: 'aceptado' } });
  red.emitir('documento.actualizado', { documento: { ...red.documentos[0], estadoSii: 'aceptado' } });
  await esperar(10);
  assert.deepEqual(de('56933333001').filter(b => b.startsWith('El SII')), ['El SII aceptó tu factura folio 1042.']);
});

test('si el dominio no cierra al llegar cierraEn, el agente lo cierra', async t => {
  const { red, agente, escribir, ultimo } = montar({ vigilarCierreMs: 10 }, { cierraEn: new Date(Date.now() + 80).toISOString() });
  t.after(() => agente.desconectar());
  await escribir('56944444001', 'Almacén Rosita, 4');
  await esperar(150);
  assert.deepEqual(red.llamadas.filter(l => l.startsWith('cerrarLicitacion')), ['cerrarLicitacion L-sala']);
  assert.match(ultimo(PROVEEDOR.telefono), /^Cerró la compra conjunta: 1 negocio, 4 cajas/);
  await escribir('56944444001', 'hola');
  assert.equal(ultimo('56944444001'), 'La compra conjunta ya cerró. Te escribo por aquí con tu folio apenas salga tu factura.');
});

test('los logs nunca llevan un teléfono completo', async t => {
  const { agente, escribir, logs } = montar();
  t.after(() => agente.desconectar());
  await escribir('56955555123', 'Almacén Rosita, 4');
  await escribir('56955555456', 'Panadería Sol, 8');
  await esperar(60);
  assert.ok(logs.length > 0);
  assert.ok(logs.every(l => !/\d{6,}/.test(l)), logs.join('\n'));
  assert.ok(logs.some(l => l.includes('***123')));
  assert.equal(enmascarar('+56 9 5555 5123'), '***123');
});

test('el parser de reglas entiende las respuestas del público', () => {
  const u = { singular: 'caja', plural: 'cajas', maximo: 20 };
  assert.deepEqual(interpretarSalaConReglas('Almacén Rosita, 4', u), { nombre: 'Almacén Rosita', cantidad: 4, claro: true });
  assert.deepEqual(interpretarSalaConReglas('4 cajas, Panadería Sol', u), { nombre: 'Panadería Sol', cantidad: 4, claro: true });
  assert.deepEqual(interpretarSalaConReglas('somos Panadería Sol y queremos tres', u), { nombre: 'Panadería Sol', cantidad: 3, claro: true });
  assert.deepEqual(interpretarSalaConReglas('mi negocio se llama La Picá, 2 cajas de rollos', u), { nombre: 'La Picá', cantidad: 2, claro: true });
  assert.deepEqual(interpretarSalaConReglas('3 rollos', u), { cantidad: 3, claro: true });
  assert.deepEqual(interpretarSalaConReglas('80 rollos', u), { dudaUnidad: true, claro: true });
  assert.deepEqual(interpretarSalaConReglas('Quiero sumarme', u), { claro: true });
  assert.equal(interpretarSalaConReglas('¿cuánto cuesta?', u).claro, false);
  assert.equal(interpretarSalaConReglas('hola quería saber si todavía se puede entrar a esto', u).claro, false);
});

test('60 personas a la vez: todas quedan sumadas y los envíos masivos no pasan de 5 en vuelo', async t => {
  const red = crearRedSalaFalsa([PROVEEDOR], { ...LICITACION, tramos: [{ desde: 1, precioUnitario: 32000 }, { desde: 100, precioUnitario: 24500 }] });
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
    const text = `Tienda ${'abcdefghij'[i % 10]}${'klmnopqrst'[Math.floor(i / 10)]}, 2`;
    return handler(
      { id: `c${i}`, conversationId: from, from, contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } },
      { reply: async body => { respuestas.push(body); return { ok: true, messageIds: [] }; }, markRead: async () => ({ ok: true, messageIds: [] }) },
    );
  }));
  assert.equal(respuestas.filter(r => r.startsWith('Listo,')).length, 60);
  assert.equal((await red.licitacionAbierta())?.totalUnidades, 120);
  await esperar(200);
  assert.ok(new Set(difusiones).size >= 50, 'la baja al llegar a 100 llega a todos los que estaban sumados');
  assert.ok(maximo <= 5, `máximo en vuelo ${maximo}`);
});
