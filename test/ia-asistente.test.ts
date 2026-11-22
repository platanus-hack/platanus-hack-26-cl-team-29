import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { crearAsistente, crearConsultasRed, type ClienteClaude, type Consultas } from '../server/ia/index.ts';
import { conectarAgente } from '../server/agente/index.ts';
import { crearRedFalsa } from '../server/agente/red-falsa.ts';
import type { EntradaConversacion, Intencion } from '../server/agente/intencion.ts';
import { interpreteDeReglas } from '../server/agente/intencion.ts';
import type { Negocio } from '../server/agente/puerto.ts';
import type { MessageHandler } from '../server/whatsapp/index.ts';
import { iniciarRed } from '../server/red/index.ts';

type Bloque = Anthropic.Beta.Messages.BetaContentBlock;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const silencio = { warn() {} };
// La consulta sobre la red real recorre la demo con sus negocios ficticios.
process.env.DEMO_FICTICIOS = '1';

const texto = (t: string) => ({ type: 'text', text: t, citations: null }) as Bloque;
const herramienta = (name: string, input: object, id = `t-${name}`) => ({ type: 'tool_use', id, name, input }) as Bloque;

/** Claude falso: responde lo guionado, en orden, y guarda cada pedido que le hicieron. */
function claudeFalso(guion: Bloque[][]) {
  const llamadas: Params[] = [];
  const cliente: ClienteClaude = {
    async create(params) {
      llamadas.push(structuredClone(params));
      const content = guion.shift();
      if (!content) throw new Error('el guion se acabó');
      const stop_reason = content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
      return { content, stop_reason } as Anthropic.Beta.Messages.BetaMessage;
    },
  };
  return { cliente, llamadas };
}

const consultasFalsas: Consultas = {
  misPedidos: () => [{ id: 'o1', estado: 'facturada', documentos: [{ tipo: 'factura', folio: 5185 }] }],
  proveedores: producto => [{ nombre: 'Molinos del Sur', nota: 4.2, producto, precioNeto: 17100 }],
  catalogo: () => [],
  compraConjunta: () => ({ abierta: false }),
};

const entrada = (texto: string, pendiente: string | null = null): EntradaConversacion => ({
  negocio: { id: 'pica', nombre: 'La Picá', comuna: 'Maipú', rol: 'comprador' },
  texto,
  historial: [{ de: 'persona', texto: 'hola' }, { de: 'bando', texto: '¡Hola! ¿En qué te ayudo?' }],
  pendiente,
});

test('una pregunta consulta la red y responde con lo que trajo la consulta', async () => {
  const { cliente, llamadas } = claudeFalso([
    [herramienta('proveedores', { producto: 'harina' })],
    [texto('Molinos del Sur la tiene a $17.100 neto, nota 4,2.')],
  ]);
  const { conversar } = crearAsistente({ cliente, modelo: 'm', consultas: consultasFalsas, log: silencio });

  const r = await conversar(entrada('¿a cuánto está la harina?'));
  assert.deepEqual(r, { tipo: 'respuesta', texto: 'Molinos del Sur la tiene a $17.100 neto, nota 4,2.' });

  const devuelto = JSON.stringify(llamadas[1]!.messages.at(-1));
  assert.match(devuelto, /tool_result/);
  assert.match(devuelto, /17100/, 'el resultado de la consulta volvió al modelo');
});

test('pedir algo termina en una propuesta, que el agente confirma después', async () => {
  const { cliente } = claudeFalso([[herramienta('proponer_pedido', { producto: 'sacos de harina', cantidad: 4 })]]);
  const { conversar } = crearAsistente({ cliente, modelo: 'm', consultas: consultasFalsas, log: silencio });

  assert.deepEqual(await conversar(entrada('dale, pídeme 4 sacos')), { tipo: 'pedir', producto: 'sacos de harina', cantidad: 4 });
});

test('el modelo ve el historial y lo pendiente, y un sí se vuelve confirmar', async () => {
  const { cliente, llamadas } = claudeFalso([[herramienta('confirmar', {})]]);
  const { conversar } = crearAsistente({ cliente, modelo: 'm', consultas: consultasFalsas, log: silencio });

  assert.deepEqual(await conversar(entrada('ya po', '¿Confirmo 4 sacos a Molinos del Sur?')), { tipo: 'si' });
  const contexto = JSON.stringify(llamadas[0]!.messages[0]);
  assert.match(contexto, /Confirmo 4 sacos a Molinos del Sur/);
  assert.match(contexto, /En qué te ayudo/);
});

test('si Claude falla, contestan las reglas y el chat sigue', async () => {
  const cliente: ClienteClaude = { create: async () => { throw new Error('sin red'); } };
  const { conversar } = crearAsistente({ cliente, modelo: 'm', consultas: consultasFalsas, log: silencio });

  assert.deepEqual(await conversar(entrada('pide 4 sacos de harina')), { tipo: 'pedir', producto: 'sacos de harina', cantidad: 4 });
});

/** Un proveedor de la red con "Durazno" en su lista, a $3.000 el kilo (y $2.850 desde 10). */
const listasConDurazno = (proveedorId: string) => ({
  listas: () => [{ proveedorId, productos: [{ nombre: 'Durazno', unidad: 'kilo', tramos: [{ desde: 1, precioUnitario: 3000 }, { desde: 10, precioUnitario: 2850 }] }] }] as never,
});

test('las consultas sobre la red real nunca incluyen teléfonos', async () => {
  const red = await iniciarRed(null);
  const { negocios } = red.estadoDeLaRed();
  const consultas = crearConsultasRed(red, listasConDurazno(negocios.find(n => n.rol === 'proveedor')!.id));
  const comprador = negocios.find(n => n.rol === 'comprador')!;
  const salida = JSON.stringify([
    consultas.misPedidos(comprador.id), consultas.proveedores('harina'), consultas.catalogo(), consultas.compraConjunta(comprador.id),
  ]);

  assert.doesNotMatch(salida, /telefono/i);
  for (const n of negocios) if (n.telefono) assert.ok(!salida.includes(n.telefono.replace(/\D/g, '').slice(-8)), `aparece el teléfono de ${n.nombre}`);
  assert.match(salida, /precioNeto/);
});

test('el catálogo y los proveedores que ve la IA salen de las listas de los proveedores, no de un catálogo fijo', async () => {
  const red = await iniciarRed(null);
  const proveedor = red.estadoDeLaRed().negocios.find(n => n.rol === 'proveedor')!;
  const consultas = crearConsultasRed(red, listasConDurazno(proveedor.id));
  assert.deepEqual(consultas.catalogo(), [{ producto: 'Durazno', unidad: 'kilo', precioNetoDesde: 3000, proveedores: 1 }]);
  const conDuraznos = consultas.proveedores('duraznos') as { nombre: string; producto: string; precioNetoBase: number }[];
  assert.deepEqual(conDuraznos.map(x => [x.nombre, x.producto, x.precioNetoBase]), [[proveedor.nombre, 'Durazno', 3000]]);
  assert.deepEqual(consultas.proveedores("harina"), { aviso: "Ningún proveedor tiene \"harina\" en su lista todavía" });
});

test('el agente manda tal cual la respuesta de la IA, sin ejecutar nada', async () => {
  const pica: Negocio = { id: 'pica', nombre: 'La Picá', comuna: 'Maipú', rol: 'comprador', telefono: 'tel-pica' };
  const molinos: Negocio = { id: 'molinos', nombre: 'Molinos del Sur', comuna: 'Maipú', rol: 'proveedor', telefono: 'tel-molinos' };
  const red = crearRedFalsa([pica, molinos]);
  const enviados: string[] = [];
  let handler: MessageHandler = () => {};
  const recibido: EntradaConversacion[] = [];
  conectarAgente(
    { onMessage: h => { handler = h; return () => {}; }, sendText: async () => ({ ok: true, messageIds: [] }) },
    red,
    {
      interprete: {
        interpretar: async () => ({ tipo: 'otro' }),
        conversar: async e => { recibido.push(e); return { tipo: 'respuesta', texto: 'Molinos tiene la mejor nota.' }; },
      },
    },
  );

  await handler(
    { id: 'w1', conversationId: 'c', from: 'tel-pica', contactName: null, sentAt: new Date(), text: '¿quién me conviene?', content: { kind: 'text', text: '¿quién me conviene?' } },
    { reply: async body => { enviados.push(body); return { ok: true, messageIds: [] }; }, markRead: async () => ({ ok: true, messageIds: [] }) },
  );

  assert.deepEqual(enviados, ['Molinos tiene la mejor nota.']);
  assert.equal(recibido[0]!.negocio.nombre, 'La Picá');
  assert.ok(!JSON.stringify(recibido[0]).includes('tel-pica'), 'el teléfono no llega a la IA');
  assert.equal((await red.estadoDeLaRed()).ordenes.length, 0);
});

/** Agente con dos proveedores y un intérprete que siempre devuelve `intencion`. */
function agenteQuePide(intencion: Intencion) {
  const pica: Negocio = { id: 'pica', nombre: 'La Picá', comuna: 'Maipú', rol: 'comprador', telefono: 'tel-pica' };
  const molinos: Negocio = { id: 'molinos', nombre: 'Molinos del Sur', comuna: 'Maipú', rol: 'proveedor', telefono: 'tel-molinos' };
  const norte: Negocio = { id: 'norte', nombre: 'Harinas del Norte', comuna: 'Arica', rol: 'proveedor', telefono: 'tel-norte' };
  const red = crearRedFalsa([pica, molinos, norte], { notas: { molinos: 4.4, norte: 4.9 } });
  const enviados: string[] = [];
  let handler: MessageHandler = () => {};
  conectarAgente(
    { onMessage: h => { handler = h; return () => {}; }, sendText: async () => ({ ok: true, messageIds: [] }) },
    red,
    { interprete: { interpretar: async () => intencion, conversar: async () => intencion } },
  );
  const escribir = (text: string) => handler(
    { id: `w-${text}`, conversationId: 'c', from: 'tel-pica', contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } },
    { reply: async body => { enviados.push(body); return { ok: true, messageIds: [] }; }, markRead: async () => ({ ok: true, messageIds: [] }) },
  );
  return { escribir, enviados, red };
}

test('si la persona elige proveedor, el pedido se le propone a ese y no al mejor evaluado', async () => {
  const { escribir, enviados } = agenteQuePide({ tipo: 'pedir', producto: 'sacos de harina', cantidad: 4, proveedor: 'harinas del norte' });
  await escribir('pídele 4 sacos a Harinas del Norte');
  assert.match(enviados[0]!, /Harinas del Norte/);
  assert.doesNotMatch(enviados[0]!, /Molinos/);
});

test('un proveedor que no existe no se reemplaza por otro: se avisa y se listan los que hay', async () => {
  const { escribir, enviados, red } = agenteQuePide({ tipo: 'pedir', producto: 'sacos de harina', cantidad: 4, proveedor: 'Don Pepe' });
  await escribir('pídele a Don Pepe');
  assert.match(enviados[0]!, /No encontré a "Don Pepe".*Molinos del Sur.*Harinas del Norte/s);
  assert.equal((await red.estadoDeLaRed()).ordenes.length, 0);
});

test('Claude pasa el proveedor elegido en la propuesta', async () => {
  const { cliente } = claudeFalso([[herramienta('proponer_pedido', { producto: 'levaduras', cantidad: 3, proveedor: 'Molinos del Sur' })]]);
  const { conversar } = crearAsistente({ cliente, modelo: 'm', consultas: consultasFalsas, log: silencio });
  assert.deepEqual(await conversar(entrada('pídele 3 a Molinos')), { tipo: 'pedir', producto: 'levaduras', cantidad: 3, proveedor: 'Molinos del Sur' });
});

test('las opciones de una confirmación salen como botones, y apretar uno confirma sin llamar a la IA', async () => {
  const pica: Negocio = { id: 'pica', nombre: 'La Picá', comuna: 'Maipú', rol: 'comprador', telefono: 'tel-pica' };
  const molinos: Negocio = { id: 'molinos', nombre: 'Molinos del Sur', comuna: 'Maipú', rol: 'proveedor', telefono: 'tel-molinos' };
  const red = crearRedFalsa([pica, molinos]);
  const conBotones: { to: string; body: string; buttons: readonly { id: string; title: string }[] }[] = [];
  const textos: string[] = [];
  let llamadasIa = 0;
  let handler: MessageHandler = () => {};
  conectarAgente(
    {
      onMessage: h => { handler = h; return () => {}; },
      sendText: async (_to, body) => { textos.push(body); return { ok: true, messageIds: [] }; },
      send: async (to, mensaje) => {
        const msg = typeof mensaje === 'string' ? { body: mensaje } : mensaje;
        conBotones.push({ to, body: msg.body, buttons: msg.buttons ?? [] });
        return { status: 'sent', messageId: 'x' };
      },
    },
    red,
    { interprete: { interpretar: (texto, pregunta) => interpreteDeReglas.interpretar(texto, pregunta), conversar: async () => { llamadasIa++; return { tipo: 'pedir', producto: 'sacos de harina', cantidad: 4 }; } } },
  );
  const ctx = { reply: async (body: string) => { textos.push(body); return { ok: true as const, messageIds: [] }; }, markRead: async () => ({ ok: true as const, messageIds: [] }) };
  await handler({ id: 'w1', conversationId: 'c', from: 'tel-pica', contactName: null, sentAt: new Date(), text: 'pide 4 sacos', content: { kind: 'text', text: 'pide 4 sacos' } }, ctx);

  assert.equal(conBotones.length, 1);
  assert.doesNotMatch(conBotones[0]!.body, /1\. /, 'las opciones no quedan como texto');
  assert.deepEqual(conBotones[0]!.buttons, [{ id: '1', title: 'Sí, envíala' }, { id: '2', title: 'No' }]);

  const antes = llamadasIa;
  await handler({ id: 'w2', conversationId: 'c', from: 'tel-pica', contactName: null, sentAt: new Date(), text: 'Sí, envíala', content: { kind: 'reply', id: '1', title: 'Sí, envíala' } }, ctx);
  assert.equal(llamadasIa, antes, 'el botón no pasa por la IA');
  assert.equal((await red.estadoDeLaRed()).ordenes.length, 1);
});
