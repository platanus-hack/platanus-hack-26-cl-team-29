import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  buscarPrimerLibre, cifrar, crearAlmacenConexionMemoria, crearConexionSii, crearRutasConexionSii, crearSiiConmutable, descifrar, leerFicha,
} from '../server/conexion-sii/index.ts';
import type { OpcionesConexion, PortalConexion } from '../server/conexion-sii/index.ts';
import { crearRed, crearRepositorioMemoria, crearRutasRed, crearSiiFalso } from '../server/red/index.ts';
import type { PuertoSii, SiiReal } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';
import { CLAVE_PFX, generarCaf, generarPfx, RUT_EMPRESA, RUT_FIRMANTE } from './sii-apoyo.ts';

const LLAVE = randomBytes(32).toString('base64');
const silencioso = { info() {}, warn() {}, error() {} };
const pfxBase64 = generarPfx().toString('base64');
const empresa = {
  rutEmisor: RUT_EMPRESA, razonSocial: 'Comercial de Prueba SpA', giro: 'Venta al por mayor', acteco: '461000',
  direccion: 'Calle Falsa 123', comuna: 'Santiago', fchResol: '2026-01-15', nroResol: 0,
};

/** QueryEstDte falso: los folios de `usados` ya están en el SII (DNK), el resto no (FAU). */
const consultaFalsa = (usados: Set<number>, consultados: number[] = []): OpcionesConexion['crearConsulta'] => () => async c => {
  consultados.push(c.folio);
  const codigo = usados.has(c.folio) ? 'DNK' : 'FAU';
  return { codigo, glosa: null, codigoError: null, glosaError: null, respuesta: `<ESTADO>${codigo}</ESTADO>` };
};

const sinPortal: PortalConexion = new Proxy({} as PortalConexion, { get: () => async () => { throw new Error('sin portal en los tests'); } });

function conexionDePrueba(opciones: Partial<OpcionesConexion> = {}) {
  return crearConexionSii({
    almacen: crearAlmacenConexionMemoria(),
    env: { SII_LLAVE_CIFRADO: LLAVE },
    log: silencioso,
    portal: sinPortal,
    crearConsulta: consultaFalsa(new Set()),
    ...opciones,
  });
}

test('el cifrado va y vuelve, y con otra llave no se descifra', () => {
  const llave = randomBytes(32);
  const sobre = cifrar(llave, 'secreto');
  assert.notEqual(cifrar(llave, 'secreto'), sobre, 'IV aleatorio');
  assert.equal(descifrar(llave, sobre), 'secreto');
  assert.throws(() => descifrar(randomBytes(32), sobre), /llave/);
});

test('sin SII_LLAVE_CIFRADO no se guarda el certificado', async () => {
  const conexion = conexionDePrueba({ env: {} });
  await assert.rejects(conexion.subirCertificado(pfxBase64, CLAVE_PFX), (e: Error & { status?: number }) => e.status === 503 && /SII_LLAVE_CIFRADO/.test(e.message));
  assert.equal((await conexion.estado()).puedeGuardar, false);
});

test('el certificado se abre, se rechaza con clave mala o vencido, y solo se expone el RUT del titular', async () => {
  const conexion = conexionDePrueba();
  await assert.rejects(conexion.subirCertificado(pfxBase64, 'otra-clave'), /No pudimos abrir/);
  const vencido = generarPfx(RUT_FIRMANTE, new Date(Date.now() - 86_400_000)).toString('base64');
  await assert.rejects(conexion.subirCertificado(vencido, CLAVE_PFX), /venció/);
  const estado = await conexion.subirCertificado(pfxBase64, CLAVE_PFX);
  assert.equal(estado.titular, RUT_FIRMANTE);
  assert.ok(estado.venceEl);
  assert.equal(estado.conectado, false);
});

test('el CAF de otra empresa o de otro tipo se rechaza', async () => {
  const conexion = conexionDePrueba();
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX);
  await conexion.esperarBusquedas();
  await conexion.guardarEmpresa({ ...empresa, rutEmisor: '11111111-1' });
  await assert.rejects(conexion.subirCaf(generarCaf(33).bytes.toString('base64')), /es de la empresa 22222222-2/);
  await conexion.guardarEmpresa(empresa);
  await assert.rejects(conexion.subirCaf(generarCaf(34).bytes.toString('base64')), /tipo 34/);
  const vencido = generarCaf(33, { fa: '2020-01-01' }).bytes.toString('base64');
  await assert.rejects(conexion.subirCaf(vencido), /venció/);
});

test('el primer folio libre es el inicio de la primera racha de 3 FAU, y nunca baja', async () => {
  const consultados: number[] = [];
  const conexion = conexionDePrueba({ crearConsulta: consultaFalsa(new Set([1, 2, 3, 4, 6]), consultados) });
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX);
  await conexion.esperarBusquedas();
  await conexion.guardarEmpresa(empresa);
  await conexion.subirCaf(generarCaf(33, { desde: 1, hasta: 20 }).bytes.toString('base64'));
  await conexion.esperarBusquedas();
  const estado = await conexion.estado();
  assert.deepEqual(consultados, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(estado.cafs[0]?.primerLibre, 7);
  assert.equal(estado.cafs[0]?.libres, 14);
  assert.equal(estado.conectado, true);
  const config = await conexion.configuracion();
  assert.deepEqual(config?.rangos[33], [{ desde: 7, hasta: 20 }], 'la red nunca toma un folio antes del primer libre');
  assert.equal(config?.sii.emisor.rut, RUT_EMPRESA);
  assert.equal(config?.sii.emisor.giro, empresa.giro);
  assert.deepEqual(config?.rangos[52], []);
  await assert.rejects(conexion.fijarFolio(33, 5), /nunca se vuelve/);
  assert.equal((await conexion.fijarFolio(33, 12)).cafs[0]?.primerLibre, 12);
});

test('un tipo guarda varios CAF: cada uno con su primer libre, y una conexión guardada con un solo CAF por tipo se sigue leyendo', async () => {
  const almacen = crearAlmacenConexionMemoria();
  const conexion = conexionDePrueba({ almacen });
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX);
  await conexion.esperarBusquedas();
  await conexion.guardarEmpresa(empresa);
  await conexion.subirCaf(generarCaf(33, { desde: 1, hasta: 5 }).bytes.toString('base64'));
  await conexion.subirCaf(generarCaf(33, { desde: 40, hasta: 44 }).bytes.toString('base64'));
  await conexion.esperarBusquedas();
  const config = await conexion.configuracion();
  assert.deepEqual(config?.rangos[33], [{ desde: 1, hasta: 5 }, { desde: 40, hasta: 44 }]);
  assert.equal(config?.sii.cafs[33]?.length, 2, 'cada rango con su CAF para timbrar');
  assert.equal((await conexion.estado()).folios.find(f => f.tipo === 33)?.libres, 10);

  // Forma anterior: `cafs[33]` era un objeto, no una lista.
  const guardada = (await almacen.leer())!;
  await almacen.guardar({ ...guardada, cafs: { 33: guardada.cafs[33]![1] } as unknown as typeof guardada.cafs });
  assert.deepEqual((await conexion.configuracion())?.rangos[33], [{ desde: 40, hasta: 44 }]);
});

test('la búsqueda acepta una racha al final del rango y se detiene ante una respuesta desconocida', async () => {
  const usado = { codigo: 'DOK', detalle: '' }, libre = { codigo: 'FAU', detalle: '' };
  assert.equal(await buscarPrimerLibre({ desde: 1, hasta: 3, consultar: async f => (f < 3 ? usado : libre) }), 3);
  assert.equal(await buscarPrimerLibre({ desde: 1, hasta: 2, consultar: async () => usado }), null);
  await assert.rejects(buscarPrimerLibre({ desde: 1, hasta: 5, consultar: async () => ({ codigo: 'EMP', detalle: 'Empresa no autorizada' }) }), /EMP.*Empresa no autorizada/);
});

test('la ficha del portal se separa en sus campos', () => {
  const html = `<table><tr><td>DATOS DEL CONTRIBUYENTE RUT</td><td>22222222-2</td></tr>
    <tr><td>NOMBRE O RAZ&Oacute;N SOCIAL</td><td>COMERCIAL DE PRUEBA SPA</td></tr>
    <tr><td>DIRECCI&Oacute;N DE LA EMPRESA</td><td>CALLE FALSA 123, Ciudad SANTIAGO, Comuna PROVIDENCIA</td></tr></table>
    <table><tr><td>CODIGO</td><td>ACTIVIDAD</td><td>AFECTO A IVA</td></tr><tr><td>461000</td><td>VENTA AL POR MAYOR</td><td>SI</td></tr></table>`;
  const f = leerFicha(html);
  assert.deepEqual({ ...f, actividades: f.actividades.length }, {
    rut: '22222222-2', razonSocial: 'COMERCIAL DE PRUEBA SPA', giro: 'VENTA AL POR MAYOR', acteco: 461000,
    direccion: 'CALLE FALSA 123', comuna: 'PROVIDENCIA', ciudad: 'SANTIAGO', actividades: 1,
  });
  assert.throws(() => leerFicha('<html>Transaccion Rechazada</html>'), (e: Error & { mensajeSii?: string }) => /Transaccion Rechazada/.test(e.mensajeSii ?? ''));
});

test('con la conexión completa la red emite con el SII de la app; sin ella, con el falso', async () => {
  const conexion = conexionDePrueba();
  const usados: string[] = [];
  const marcar = (nombre: string): PuertoSii => ({
    ...crearSiiFalso(),
    emitirFactura: async () => { usados.push(nombre); return { folio: 1, trackId: '', estadoSii: nombre }; },
  });
  const sii = crearSiiConmutable({
    falso: marcar('falso'), conexion, crearReal: config => ({ ...marcar(`real ${config.sii.emisor.rut}`), consultarDocumento: async () => { throw new Error(); } }) as SiiReal,
  });
  const datos = {} as Parameters<PuertoSii['emitirFactura']>[0];
  await sii.emitirFactura(datos);
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX);
  await conexion.esperarBusquedas();
  await conexion.guardarEmpresa(empresa);
  await conexion.subirCaf(generarCaf(33).bytes.toString('base64'));
  await conexion.esperarBusquedas();
  await sii.emitirFactura(datos);
  await conexion.desconectar();
  await sii.emitirFactura(datos);
  assert.deepEqual(usados, ['falso', `real ${RUT_EMPRESA}`, 'falso']);
});

test('las rutas exigen la sesión del proveedor y nunca devuelven el certificado, su clave ni el CAF', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo, new Date(), {});
  const red = await crearRed({ repo, sii: crearSiiFalso(), env: {} });
  const conexion = conexionDePrueba();
  const app = express().use(express.json())
    .use('/api/red', crearRutasRed(red, { PROVEEDOR_CODIGO: 'codigo-de-prueba' }, { conexionSii: crearRutasConexionSii(conexion) }));
  const server = app.listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}/api/red`;
  const respuestas: string[] = [];
  const pedir = async (metodo: string, ruta: string, body?: unknown, token?: string) => {
    const r = await fetch(url + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const texto = await r.text();
    respuestas.push(texto);
    return { status: r.status, cuerpo: JSON.parse(texto) };
  };
  const caf = generarCaf(33).bytes.toString('base64');
  try {
    assert.equal((await pedir('GET', '/proveedor/sii')).status, 401);
    const { cuerpo: { token } } = await pedir('POST', '/proveedor/sesion', { codigo: 'codigo-de-prueba' });
    assert.equal((await pedir('POST', '/proveedor/sii/certificado', { pfxBase64, clave: 'mala' }, token)).status, 400);
    assert.equal((await pedir('POST', '/proveedor/sii/certificado', { pfxBase64, clave: CLAVE_PFX }, token)).status, 200);
    assert.equal((await pedir('PUT', '/proveedor/sii/empresa', empresa, token)).status, 200);
    const subida = await pedir('POST', '/proveedor/sii/caf', { xmlBase64: caf }, token);
    assert.equal(subida.status, 200, JSON.stringify(subida.cuerpo));
    await conexion.esperarBusquedas();
    const estado = await pedir('GET', '/proveedor/sii', undefined, token);
    assert.equal(estado.cuerpo.conectado, true);
    assert.equal(estado.cuerpo.cafs[0].primerLibre, 1);
    await pedir('GET', '/estado');
    const todo = respuestas.join('\n');
    for (const secreto of [pfxBase64.slice(0, 60), CLAVE_PFX, caf.slice(0, 60), 'RSASK']) assert.ok(!todo.includes(secreto), `se filtró ${secreto.slice(0, 10)}`);
    assert.equal((await pedir('DELETE', '/proveedor/sii', undefined, token)).cuerpo.conectado, false);
  } finally {
    server.close();
  }
});
