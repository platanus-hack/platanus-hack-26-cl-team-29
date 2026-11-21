import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { crearSii } from '../server/sii/index.ts';
import type { EntradaFactura } from '../server/sii/index.ts';
import {
  conCacheYFila, crearAlmacenFoliosMemoria, crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso, crearSiiReal,
  formatearRut, receptorDelComprador, validarRut, ErrorRed, RUT_DESCONOCIDO, RUT_INVALIDO,
} from '../server/red/index.ts';
import type { ConsultarContribuyente, DatosContribuyente, EventoRed, PuertoSii } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { generarCaf, RUT_EMPRESA } from './sii-apoyo.ts';

// RUT de prueba sin dueño conocido (dígito verificador correcto).
const RUT_A = '11111111-1';
const RUT_B = '22222222-2';

const ficha = (razonSocial: string, giro = 'Venta al por menor en almacenes'): DatosContribuyente =>
  ({ razonSocial, giro, direccion: 'Av. Siempre Viva 742', comuna: 'Ñuñoa', actividades: [{ codigo: '471100', glosa: giro }] });

/** Consulta de prueba que cuenta cuántas veces se llamó por RUT. */
function consultaContada(fichas: Record<string, DatosContribuyente | null>) {
  const llamadas: string[] = [];
  const consultar: ConsultarContribuyente = async rut => {
    llamadas.push(rut);
    return rut in fichas ? fichas[rut]! : null;
  };
  return { consultar, llamadas };
}

async function redDePrueba(consultar: ConsultarContribuyente, sii: PuertoSii = crearSiiFalso(), env: NodeJS.ProcessEnv = {}) {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), env);
  const red = await crearRed({ repo, sii, env, consultarContribuyente: conCacheYFila(consultar, { intervaloMs: 0 }) });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  return { red, eventos };
}

test('el RUT se acepta con o sin puntos y guion, y el dígito verificador se valida con módulo 11', () => {
  for (const texto of ['12.345.678-5', '12345678-5', '123456785', ' 12 345 678 5 ', '11.111.111-1']) {
    assert.ok(validarRut(texto), texto);
  }
  assert.equal(validarRut('12.345.678-5'), '12345678-5');
  assert.equal(validarRut('5.126.663-3'), '5126663-3');
  for (const texto of ['12.345.678-6', '1234', 'abc', '', '12.345.678-', '123456789012-3']) {
    assert.equal(validarRut(texto), null, texto);
  }
  assert.equal(formatearRut('12345678-5'), '12.345.678-5');
});

test('la consulta al SII va en fila de a una, con pausa entre pedidos, y cada RUT se consulta una sola vez', async () => {
  let ahora = 0;
  let enVuelo = 0, maximo = 0;
  const inicios: number[] = [];
  const llamadas: string[] = [];
  const consultar = conCacheYFila(async rut => {
    llamadas.push(rut);
    inicios.push(ahora);
    enVuelo++;
    maximo = Math.max(maximo, enVuelo);
    await new Promise(r => setTimeout(r, 2));
    enVuelo--;
    return rut === 'desconocido' ? null : ficha(`Negocio ${rut}`);
  }, { intervaloMs: 1000, reloj: () => ahora, esperar: async ms => { ahora += ms; } });

  // Una sala que se suma de golpe: tres veces el mismo RUT, más otros dos.
  const r = await Promise.all([RUT_A, RUT_A, RUT_B, RUT_A, 'desconocido'].map(consultar));
  assert.deepEqual(llamadas, [RUT_A, RUT_B, 'desconocido'], 'un RUT repetido no se vuelve a consultar');
  assert.equal(maximo, 1, 'nunca dos consultas a la vez');
  assert.deepEqual(inicios, [0, 1000, 2000], 'una por segundo');
  assert.equal(r[0]!.razonSocial, `Negocio ${RUT_A}`);
  assert.equal(r[4], null);
  await consultar(RUT_B);
  await consultar('desconocido');
  assert.equal(llamadas.length, 3, 'el resultado queda en cache, también el de un RUT que el SII no conoce');
});

test('un error al consultar no queda en cache: el mismo RUT se puede volver a intentar', async () => {
  let fallar = true;
  let llamadas = 0;
  const consultar = conCacheYFila(async () => {
    llamadas++;
    if (fallar) throw new Error('corte');
    return ficha('Almacén Prueba');
  }, { intervaloMs: 0 });
  await assert.rejects(consultar(RUT_A));
  fallar = false;
  assert.equal((await consultar(RUT_A))!.razonSocial, 'Almacén Prueba');
  assert.equal(llamadas, 2);
});

test('el comprador queda con su RUT y sus datos del SII; un RUT ya registrado no se vuelve a consultar', async () => {
  const { consultar, llamadas } = consultaContada({ [RUT_A]: ficha('Comercial Prueba Limitada') });
  const { red } = await redDePrueba(consultar);

  const ana = await red.registrarComprador({ nombre: 'Almacén Ana', rut: '11.111.111-1' });
  assert.equal(ana.rut, RUT_A);
  assert.equal(ana.contribuyente?.razonSocial, 'Comercial Prueba Limitada');
  await red.registrarComprador({ nombre: 'Otra sucursal', rut: '111111111' });
  assert.deepEqual(llamadas, [RUT_A], 'una sola consulta por RUT');

  // Una red nueva sobre los mismos negocios (reinicio del servidor) usa lo guardado.
  assert.equal((await red.consultarRut(RUT_A)).razonSocial, 'Comercial Prueba Limitada');
  assert.deepEqual(llamadas, [RUT_A]);
});

test('sin RUT válido o desconocido en el SII no se registra, con un mensaje claro', async () => {
  const { consultar } = consultaContada({});
  const { red } = await redDePrueba(consultar);
  await assert.rejects(red.registrarComprador({ nombre: 'X', rut: '12.345.678-9' }), (e: ErrorRed) => e.codigo === 'datos_invalidos' && e.message === RUT_INVALIDO);
  await assert.rejects(red.registrarComprador({ nombre: 'X', rut: RUT_B }), (e: ErrorRed) => e.codigo === 'datos_invalidos' && e.message === RUT_DESCONOCIDO);
  const caido = await redDePrueba(async () => { throw new Error('sesión caída'); });
  await assert.rejects(caido.red.consultarRut(RUT_B), (e: ErrorRed) => e.codigo === 'sii_no_disponible');
});

test('por WhatsApp, un teléfono ya registrado recibe su RUT al sumarse', async () => {
  const { consultar } = consultaContada({ [RUT_B]: ficha('Panadería Prueba SpA') });
  const { red } = await redDePrueba(consultar);
  await red.registrarComprador({ nombre: 'Beto', telefono: '+56 9 3333 4444' });
  await red.actualizarCarrito('L-1', { telefono: '+56 9 3333 4444', rut: RUT_B, items: [{ productoId: 'rollos', cantidad: 1 }] });
  assert.equal(red.negocioPorTelefono('56933334444')?.rut, RUT_B);
});

test('ni la foto pública ni los eventos ni las respuestas de la web llevan el RUT o los datos del SII', async () => {
  const { consultar } = consultaContada({ [RUT_A]: ficha('Comercial Prueba Limitada') });
  const { red, eventos } = await redDePrueba(consultar);
  const app = express().use(express.json()).use('/api/red', crearRutasRed(red, {}));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const pedir = async (method: string, ruta: string, body?: unknown, token?: string) => {
    const r = await fetch(url + ruta, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };
  const privado = (x: unknown) => {
    const texto = JSON.stringify(x);
    assert.ok(!texto.includes('11111111') && !texto.includes('11.111.111'), `apareció el RUT: ${texto.slice(0, 200)}`);
    assert.ok(!texto.includes('Comercial Prueba') && !texto.includes('"rut"') && !texto.includes('contribuyente'), 'aparecieron datos del SII');
  };
  try {
    assert.equal((await pedir('POST', '/sesion', { nombre: 'Almacén Ana' })).status, 400, 'sin RUT no entra');
    assert.equal((await pedir('POST', '/sesion', { nombre: 'Almacén Ana', rut: '11.111.111-2' })).cuerpo.mensaje, RUT_INVALIDO);
    const entrada = await pedir('POST', '/sesion', { nombre: 'Almacén Ana', rut: '11.111.111-1' });
    assert.equal(entrada.status, 201);
    privado(entrada.cuerpo);
    const { token } = entrada.cuerpo;
    const puesto = await pedir('PUT', '/yo/carrito', { licitacionId: 'L-1', items: [{ productoId: 'rollos', cantidad: 2 }] }, token);
    assert.equal(puesto.status, 200);
    privado(puesto.cuerpo);
    assert.equal((await pedir('POST', '/licitaciones/L-1/unirse', { nombre: 'Público', cantidad: 1 })).status, 400, 'la página del QR también pide RUT');

    // Su dueño sí ve a quién sale su factura.
    const yo = (await pedir('GET', '/yo', undefined, token)).cuerpo;
    assert.deepEqual(yo.facturaA, { rut: '11.111.111-1', razonSocial: 'Comercial Prueba Limitada', giro: 'Venta al por menor en almacenes', comuna: 'Ñuñoa' });
    privado({ ...yo, facturaA: null });

    await red.cerrarLicitacion('L-1');
    await red.confirmarOrdenesDeLicitacion('L-1');
    privado(red.estadoPublico());
    privado((await pedir('GET', '/estado')).cuerpo);
    assert.ok(eventos.length > 0);
    for (const e of eventos) privado(e);
    assert.equal(red.estadoDeLaRed().negocios.find(n => n.nombre === 'Almacén Ana')?.rut, RUT_A, 'la foto interna sí lo guarda');
  } finally {
    server.close();
  }
});

test('el receptor de la factura limpia y corta los datos del SII como exige el XSD (giro a 40)', () => {
  const giroLargo = 'VENTA AL POR MENOR DE ALIMENTOS,   BEBIDAS Y TABACO EN COMERCIOS ESPECIALIZADOS';
  const r = receptorDelComprador({
    id: 'n', nombre: 'Ana', comuna: '', rol: 'comprador', telefono: '', rut: RUT_A,
    contribuyente: { ...ficha('Comercial “Prueba” Limitada\u{1F600}', giroLargo), comuna: 'Pedro Aguirre Cerda Sector Poniente' },
  })!;
  assert.equal(r.rut, RUT_A);
  assert.equal(r.giro, 'VENTA AL POR MENOR DE ALIMENTOS, BEBIDAS');
  assert.ok(r.giro.length <= 40);
  assert.equal(r.razonSocial, 'Comercial "Prueba" Limitada');
  assert.ok(r.comuna.length <= 20);
  // Sin RUT o con datos simulados, quien emite usa su receptor de respaldo.
  assert.equal(receptorDelComprador({ id: 'n', nombre: 'Ana', comuna: '', rol: 'comprador', telefono: '' }), null);
  assert.equal(receptorDelComprador({ id: 'n', nombre: 'Ana', comuna: '', rol: 'comprador', telefono: '', rut: RUT_A, contribuyente: { ...ficha('X'), simulado: true } }), null);
});

test('en la compra conjunta cada factura 33 sale al RUT y a los datos del SII de su comprador', async () => {
  const env = {
    SII_RUT_EMISOR: RUT_EMPRESA, SII_CAF_33_BASE64: generarCaf(33, { desde: 40, hasta: 99 }).bytes.toString('base64'),
    SII_RUT_RECEPTOR: '55555555-5', SII_RECEPTOR_RAZON_SOCIAL: 'Receptor de Respaldo', SII_RECEPTOR_GIRO: 'Comercio',
    SII_RECEPTOR_DIRECCION: 'Calle 1', SII_RECEPTOR_COMUNA: 'Santiago',
  };
  const silencioso = { info() {}, warn() {}, error() {} };
  const base = crearSii({ env: { SII_RUT_EMISOR: RUT_EMPRESA }, log: silencioso });
  const sobres: EntradaFactura[][] = [];
  const sii = { ...base, emitirFacturas: (e: readonly EntradaFactura[]) => { sobres.push([...e]); return base.emitirFacturas(e); } };
  const giroLargo = 'Venta al por menor de pan, productos de panadería y pastelería';
  const { consultar } = consultaContada({ [RUT_A]: ficha('Comercial Prueba Limitada'), [RUT_B]: ficha('Panadería Prueba SpA', giroLargo) });
  const { red } = await redDePrueba(consultar, crearSiiReal({ sii, folios: crearAlmacenFoliosMemoria(), env, log: silencioso, seguirEnvios: false }), env);

  await red.actualizarCarrito('L-1', { telefono: '+56 9 1111 2222', nombre: 'Ana', rut: '11.111.111-1', items: [{ productoId: 'rollos', cantidad: 2 }] });
  await red.actualizarCarrito('L-1', { telefono: '+56 9 3333 4444', nombre: 'Beto', rut: '22222222-2', items: [{ productoId: 'bolsas', cantidad: 1 }] });
  // Un comprador de antes, sin RUT: su factura va al receptor de respaldo.
  await red.actualizarCarrito('L-1', { telefono: '+56 9 5555 6666', nombre: 'Caro', items: [{ productoId: 'guantes', cantidad: 1 }] });
  await red.cerrarLicitacion('L-1');
  const facturas = await red.confirmarOrdenesDeLicitacion('L-1');

  assert.equal(sobres.length, 1);
  assert.deepEqual(sobres[0]!.map(e => [e.receptor.rut, e.receptor.razonSocial, e.receptor.comuna]), [
    [RUT_A, 'Comercial Prueba Limitada', 'Ñuñoa'], [RUT_B, 'Panadería Prueba SpA', 'Ñuñoa'], ['55555555-5', 'Receptor de Respaldo', 'Santiago'],
  ]);
  assert.equal(sobres[0]![1]!.receptor.giro, giroLargo.slice(0, 40).trim());
  assert.deepEqual(facturas.map(f => f.estadoSii), ['recibido', 'recibido', 'recibido'], 'el XML con el giro cortado pasa la validación');
});
