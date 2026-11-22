import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conectarAgente } from '../server/agente/index.ts';
import { interpreteDeReglas } from '../server/agente/intencion.ts';
import { crearAlmacenContactosMemoria, iniciarAvisos, SIN_AVISOS } from '../server/avisos/index.ts';
import type { Contacto } from '../server/avisos/index.ts';
import { audienciaDelAviso } from '../server/avisos/audiencia.ts';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, LICITACION_SALA } from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { digitoVerificador } from '../shared/rut.ts';
import { mensajeAlBotConCodigo } from '../shared/avisos.ts';
import type { MessageHandler } from '../server/whatsapp/index.ts';
import { consultaConFicha } from './sii-apoyo.ts';

// Datos ficticios: teléfonos de prueba y RUT generados, ningún negocio real.
const rut = (cuerpo: string) => `${cuerpo}-${digitoVerificador(cuerpo)}`;
const UNO = { telefono: '56911110001', nombre: 'Almacén Uno', rut: rut('30111001') };
const DOS = { telefono: '56911110002', nombre: 'Botillería Dos', rut: rut('30111002') };
const TRES = { telefono: '56911110003', nombre: 'Minimarket Tres', rut: rut('30111003') };
const ENV = { DEMO_TELEFONO_PROVEEDOR: '+56 9 0000 0099' };

async function montar() {
  let ahora = Date.parse('2026-11-21T15:00:00Z');
  const reloj = () => new Date(ahora);
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, reloj(), ENV);
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: ENV, reloj, consultarContribuyente: consultaConFicha });
  const enviados: { to: string; body: string }[] = [];
  const publicos: EventoRed[] = [];
  let handler: MessageHandler = () => {};
  const whatsapp = {
    onMessage: (h: MessageHandler) => { handler = h; return () => {}; },
    sendText: async (to: string, body: string) => { enviados.push({ to, body }); return { ok: true as const, messageIds: [] }; },
  };
  const silencio = { info: () => {}, warn: () => {}, error: () => {} };
  const avisos = await iniciarAvisos({
    red, whatsapp, almacen: crearAlmacenContactosMemoria(), env: { DEMO_WHATSAPP_NUMERO: '56900000999', PUBLIC_URL: 'https://bando.test' }, emitir: e => publicos.push(e), envios: { minimoDifusionMs: 0 }, log: silencio, reloj,
  });
  const agente = conectarAgente(whatsapp, red, {
    interprete: interpreteDeReglas, env: {}, log: silencio, avisos, sala: { vigilarCierreMs: 0, minimoDifusionMs: 0, ventanaCascadaMs: 5 },
  });
  let n = 0;
  const escribir = async (from: string, text: string) => {
    await handler(
      { id: `m${n++}`, conversationId: from, from, contactName: null, sentAt: new Date(), text, content: { kind: 'text', text } },
      { reply: async body => { enviados.push({ to: from, body }); return { ok: true, messageIds: [] }; }, markRead: async () => ({ ok: true, messageIds: [] }) },
    );
  };
  const avisosA = (to: string) => enviados.filter(e => e.to === to && e.body.startsWith('Hay una compra conjunta abierta')).map(e => e.body);
  /** Nueva compra conjunta: la demo se reinicia una hora después (otro cierre, otra compra). */
  const abrirOtra = async () => {
    ahora += 3_600_000;
    await red.reiniciarDemo();
    await avisos.alDia();
  };
  const fin = () => { agente.desconectar(); avisos.detener(); };
  return { red, avisos, escribir, enviados, avisosA, abrirOtra, publicos, fin, ultimo: (to: string) => enviados.filter(e => e.to === to).at(-1)?.body ?? '' };
}

test('al abrir una compra, avisa una vez a quien ya compró antes, nunca a quien no se registró solo o no tiene teléfono', async t => {
  const { red, avisos, avisosA, abrirOtra, publicos, fin } = await montar();
  t.after(fin);
  // Uno compró rollos en la compra anterior; Dos se registró con su RUT pero no compró; Web entró sin teléfono.
  await red.actualizarCarrito(LICITACION_SALA, { ...UNO, items: [{ productoId: 'rollos', cantidad: 2 }] });
  await red.registrarComprador({ ...DOS, comuna: 'Arica' });
  await red.registrarComprador({ nombre: 'Café Web', rut: rut('30111004') });
  await avisos.alDia();

  await abrirOtra();
  const [aviso, ...otros] = avisosA(UNO.telefono);
  assert.equal(otros.length, 0);
  assert.match(aviso, /^Hay una compra conjunta abierta cerca de ti: Caja de rollos .* a \$32\.000 y bajando, sé el primero en sumarte\. Responde SÍ para sumarte\./);
  assert.match(aviso, /BASTA/, 'el primer aviso dice cómo no recibir más');
  // Dos no calza con nada mientras Uno sí; los negocios sembrados (sin registro propio) y el desconocido, nunca.
  assert.deepEqual(avisosA(DOS.telefono), []);
  assert.deepEqual(avisosA('56900000011'), []);
  assert.deepEqual(avisosA('+56 9 0000 0012'), []);

  // Un aviso por negocio y por compra, aunque se vuelva a pedir.
  await avisos.avisarCompraAbierta();
  assert.equal(avisosA(UNO.telefono).length, 1);
  const evento = publicos.find(e => e.tipo === 'avisos.enviados');
  assert.deepEqual(evento?.datos, { licitacionId: LICITACION_SALA, negocios: 1 }, 'el evento público lleva solo el conteo');
});

test('BASTA se respeta para siempre y el aviso siguiente ya no repite cómo darse de baja', async t => {
  const { red, avisos, escribir, avisosA, abrirOtra, ultimo, fin } = await montar();
  t.after(fin);
  await red.actualizarCarrito(LICITACION_SALA, { ...UNO, items: [{ productoId: 'rollos', cantidad: 2 }] });
  await red.actualizarCarrito(LICITACION_SALA, { ...TRES, items: [{ productoId: 'guantes', cantidad: 1 }] });
  await avisos.alDia();
  await abrirOtra();
  assert.equal(avisosA(UNO.telefono).length, 1);

  await escribir(UNO.telefono, 'BASTA');
  assert.equal(ultimo(UNO.telefono), SIN_AVISOS);
  await abrirOtra();
  await abrirOtra();
  assert.equal(avisosA(UNO.telefono).length, 1, 'después de BASTA no llega ningún aviso más');
  const deTres = avisosA(TRES.telefono);
  assert.equal(deTres.length, 3, 'quien no dijo BASTA recibe uno por compra');
  assert.doesNotMatch(deTres[1], /BASTA/);
});

test('responder SÍ al aviso lo suma con el flujo de siempre de la sala', async t => {
  const { red, avisos, escribir, abrirOtra, ultimo, fin } = await montar();
  t.after(fin);
  await red.actualizarCarrito(LICITACION_SALA, { ...UNO, items: [{ productoId: 'rollos', cantidad: 2 }] });
  await avisos.alDia();
  await abrirOtra();

  await escribir(UNO.telefono, 'Sí!');
  assert.match(ultimo(UNO.telefono), /registrarte/, 'parte el registro de la sala (la demo nueva no conoce su RUT)');
  await escribir(UNO.telefono, '2');
  await escribir(UNO.telefono, UNO.rut);
  await escribir(UNO.telefono, '1');
  await escribir(UNO.telefono, 'Almacén Uno, 3 cajas de rollos');
  const dentro = red.licitacionAbierta()!.participantes.find(p => p.nombre === UNO.nombre);
  assert.deepEqual(dentro?.items, [{ productoId: 'rollos', cantidad: 3 }]);
});

test('un SÍ al aviso de quien ya tiene su RUT en la red pasa directo a elegir productos', async t => {
  const { red, avisos, escribir, abrirOtra, ultimo, fin } = await montar();
  t.after(fin);
  await red.actualizarCarrito(LICITACION_SALA, { ...UNO, items: [{ productoId: 'rollos', cantidad: 2 }] });
  await avisos.alDia();
  await abrirOtra();
  await red.registrarComprador(UNO); // volvió a entrar con su RUT antes de responder

  await escribir(UNO.telefono, 'si');
  assert.match(ultimo(UNO.telefono), /Perfecto, Almacén Uno\. ¿Qué quieres\?/, 'sin el aviso, un "si" suelto no tendría nada que confirmar');
  await escribir(UNO.telefono, '3 cajas de rollos');
  assert.ok(red.licitacionAbierta()!.participantes.some(p => p.nombre === UNO.nombre));
});

test('la audiencia prioriza lo que compró antes, luego haber participado, la comuna y el rubro; sin calce, todos', () => {
  const base = (id: string, extra: Partial<Contacto> = {}): Contacto =>
    ({ id, nombre: id, telefono: `5690000${id.length}`, registrado: true, productos: [], rondas: [], avisadas: [], ...extra });
  const compra = { ronda: 'L-1@x', comuna: 'Ñuñoa', productos: ['rollos', 'guantes'], dentro: new Set(['dentro']) };
  const contactos = [
    base('comuna', { comuna: 'nunoa' }),
    base('rubro', { rubro: 'cafe' }),
    base('participo', { rondas: ['L-1@antes'], productos: ['bolsas'] }),
    base('compro', { productos: ['guantes'], rondas: ['L-1@antes'], rubro: 'cafe' }),
    base('nada'),
    base('basta', { productos: ['rollos'], sinAvisos: '2026-11-21' }),
    base('sin-telefono', { productos: ['rollos'], telefono: undefined }),
    base('no-registrado', { productos: ['rollos'], registrado: false }),
    base('ya-avisado', { productos: ['rollos'], avisadas: ['L-1@x'] }),
    base('dentro', { productos: ['rollos'] }),
  ];
  const lista = audienciaDelAviso(contactos, compra);
  assert.deepEqual(lista.map(d => [d.contacto.id, d.motivo]), [['compro', 'compro_antes'], ['participo', 'participo'], ['comuna', 'comuna'], ['rubro', 'rubro']]);
  const sinCalce = audienciaDelAviso([base('a'), base('b'), base('basta', { sinAvisos: 'x' })], compra);
  assert.deepEqual(sinCalce.map(d => [d.contacto.id, d.motivo]), [['a', 'todos'], ['b', 'todos']]);
});

/** El código de la invitación que el bot le mandó a un teléfono. */
function codigoEnviadoA(enviados: { to: string; body: string }[], telefono: string): string {
  const invitacion = enviados.find(e => e.to === telefono && e.body.startsWith('Trae a tu vecino'));
  const codigo = /ref=([A-Z]+)/.exec(invitacion?.body ?? '')?.[1];
  assert.ok(codigo, 'el bot ofrece la invitación al sumarse');
  return codigo;
}

test('trae a tu vecino: el invitado se suma por WhatsApp, a quien invitó le llega el aviso y la pantalla ve solo nombres', async t => {
  const { red, escribir, enviados, publicos, avisos, ultimo, fin } = await montar();
  t.after(fin);
  await red.actualizarCarrito(LICITACION_SALA, { ...UNO, items: [{ productoId: 'rollos', cantidad: 2 }] });
  await avisos.alDia();
  assert.ok(!enviados.some(e => e.to === UNO.telefono && e.body.startsWith('Trae a tu vecino')), 'sumarse no manda la invitación: sin spam');
  await escribir(UNO.telefono, 'invitar');
  const codigo = codigoEnviadoA(enviados, UNO.telefono);
  assert.match(codigo, /^[A-HJ-NP-Z]{8}$/, 'código al azar, sin dígitos del teléfono ni del RUT');
  const oferta = enviados.find(e => e.to === UNO.telefono && e.body.startsWith('Trae a tu vecino'))!.body;
  assert.match(oferta, new RegExp(`https://bando\\.test/unirse\\?ref=${codigo}`));
  assert.match(oferta, /https:\/\/wa\.me\/56900000999\?text=/);

  // El vecino llega con el mensaje ya escrito del enlace wa.me y se suma con el flujo de siempre.
  await escribir(DOS.telefono, mensajeAlBotConCodigo(codigo));
  assert.match(ultimo(DOS.telefono), /registrarte/);
  await escribir(DOS.telefono, '2');
  await escribir(DOS.telefono, DOS.rut);
  await escribir(DOS.telefono, '1');
  await escribir(DOS.telefono, 'Botillería Dos, 3 cajas de rollos');
  await avisos.alDia();

  const aviso = enviados.filter(e => e.to === UNO.telefono && e.body.includes('se sumó con tu invitación'));
  assert.equal(aviso.length, 1);
  assert.match(aviso[0].body, /^Botillería Dos se sumó con tu invitación: el precio de Caja de rollos .* va en \$32\.000\.$/);
  const evento = publicos.find(e => e.tipo === 'invitacion.sumada');
  assert.ok(evento);
  const { invitadoId, invitaId, ...resto } = evento.datos as Record<string, unknown>;
  assert.deepEqual(resto, { licitacionId: LICITACION_SALA, invita: UNO.nombre, invitado: DOS.nombre });
  assert.ok(invitadoId && invitaId);
  const publico = JSON.stringify(evento);
  for (const privado of [UNO.telefono, DOS.telefono, '11110001', UNO.rut, DOS.rut, '30111001', codigo]) assert.ok(!publico.includes(privado), `sin ${privado}`);
  assert.deepEqual(avisos.invitaciones().map(i => [i.invita, i.invitado]), [[UNO.nombre, DOS.nombre]]);

  // Cambiar el carrito no vuelve a contar la invitación.
  await red.actualizarCarrito(LICITACION_SALA, { telefono: DOS.telefono, items: [{ productoId: 'rollos', cantidad: 5 }] });
  await avisos.alDia();
  assert.equal(enviados.filter(e => e.to === UNO.telefono && e.body.includes('se sumó con tu invitación')).length, 1);
});

test('trae a tu vecino por la web (?ref=), "invitar" por WhatsApp y su propio código no cuenta', async t => {
  const { red, escribir, enviados, publicos, avisos, ultimo, fin } = await montar();
  t.after(fin);
  await red.actualizarCarrito(LICITACION_SALA, { ...UNO, items: [{ productoId: 'guantes', cantidad: 1 }] });
  await avisos.alDia();
  await escribir(UNO.telefono, 'invitar');
  const codigo = codigoEnviadoA(enviados, UNO.telefono);
  await escribir(UNO.telefono, 'invitar');
  assert.match(ultimo(UNO.telefono), new RegExp(`^Trae a tu vecino[\\s\\S]*ref=${codigo}`), 'el mismo código de siempre');
  assert.equal(await avisos.invitadoWeb((await red.registrarComprador(UNO))!, codigo), false, 'su propio código no lo invita');

  const web = await red.registrarComprador({ nombre: 'Café Web', rut: rut('30111004') });
  assert.equal(await avisos.invitadoWeb(web, codigo.toLowerCase()), true);
  assert.equal(publicos.filter(e => e.tipo === 'invitacion.sumada').length, 0, 'todavía no se suma');
  await red.actualizarCarrito(LICITACION_SALA, { negocioId: web.id, items: [{ productoId: 'guantes', cantidad: 2 }] });
  await avisos.alDia();
  const evento = publicos.find(e => e.tipo === 'invitacion.sumada');
  assert.equal((evento?.datos as { invitado?: string }).invitado, 'Café Web');
  assert.match(enviados.filter(e => e.to === UNO.telefono).at(-1)!.body, /^Café Web se sumó con tu invitación/);
  const suya = await avisos.invitacionWeb(web);
  assert.ok(suya && suya.codigo !== codigo && suya.ruta === `/unirse?ref=${suya.codigo}`);
});

test('quien abre una compra en grupo no recibe el aviso de su propia compra', async t => {
  const { red, avisos, avisosA, fin } = await montar();
  t.after(fin);
  // Uno ya compró rollos (lo haría candidato al aviso) y abre una compra de rollos.
  await red.actualizarCarrito(LICITACION_SALA, { ...UNO, items: [{ productoId: 'rollos', cantidad: 2 }] });
  await avisos.alDia();
  await red.cerrarLicitacion(LICITACION_SALA);
  const uno = red.negocioPorTelefono(UNO.telefono)!;
  await red.abrirSolicitud!({ compradorId: uno.id, producto: 'Caja de rollos térmicos', unidad: 'caja', cantidad: 5 });
  await avisos.alDia();
  assert.deepEqual(avisosA(UNO.telefono), []);
});
