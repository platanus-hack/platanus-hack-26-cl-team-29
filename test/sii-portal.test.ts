import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  consultarFicha, consultarResolucion, crearAlmacenSesionesMemoria, crearCandadoMemoria, crearLimitador, crearPortalSii, credencialDe,
  ESPERA_LIMITE_MS, esErrorPortal, leerRangos, listarReobtenibles,
} from '../server/sii-portal/index.ts';
import type { AlmacenSesiones, Http } from '../server/sii-portal/index.ts';
import { CLAVE_PFX, generarPfx, RUT_EMPRESA } from './sii-apoyo.ts';
import { crearPortalFalso, crearRelojFalso } from './sii-portal-falso.ts';

const silencioso = { info() {}, warn() {}, error() {} };
const certificado = { pfx: generarPfx(), clave: CLAVE_PFX };

function portalDePrueba(http: Http, opciones: { almacen?: AlmacenSesiones; reloj?: ReturnType<typeof crearRelojFalso> } = {}) {
  const reloj = opciones.reloj ?? crearRelojFalso();
  return crearPortalSii({
    almacen: opciones.almacen ?? crearAlmacenSesionesMemoria(),
    candado: crearCandadoMemoria(),
    limitador: crearLimitador({ reloj, separacionMs: 0 }),
    http, reloj, log: silencioso,
  });
}

test('varias llamadas concurrentes con el mismo certificado hacen un solo login y no cruzan solicitudes', async () => {
  const sii = crearPortalFalso();
  const portal = portalDePrueba(sii.http);
  const fechas = await Promise.all(Array.from({ length: 5 }, () =>
    portal.conSesion(certificado, 'resolucion', s => consultarResolucion(s, RUT_EMPRESA))));
  assert.equal(sii.logins(), 1);
  assert.deepEqual(new Set(fechas.map(f => f.fecha)), new Set(['2026-10-07']));
  assert.equal(sii.concurrentes(), 0, 'las solicitudes de una sesión van en serie');
});

test('la sesión guardada sobrevive a un reinicio: otra instancia con el mismo almacén no vuelve a entrar', async () => {
  const sii = crearPortalFalso();
  const almacen = crearAlmacenSesionesMemoria();
  await portalDePrueba(sii.http, { almacen }).conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  const despues = portalDePrueba(sii.http, { almacen });
  const ficha = await despues.conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  assert.equal(ficha.razonSocial, 'Comercial de Prueba SpA');
  assert.equal(ficha.comuna, 'SANTIAGO');
  assert.equal(sii.logins(), 1);
});

test('una sesión guardada de otro titular no se usa: se descarta y se entra con el certificado propio', async () => {
  const sii = crearPortalFalso();
  const almacen = crearAlmacenSesionesMemoria();
  const { huella } = credencialDe(certificado);
  await almacen.guardarSesion({ huella, rutTitular: '99999999-9', cookies: 'NETSCAPE_LIVEWIRE.sesion=ajena', creadaEn: 0, usadaEn: 0 });
  await portalDePrueba(sii.http, { almacen }).conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  assert.equal(sii.logins(), 1);
  assert.notEqual((await almacen.leerSesion(huella))?.cookies.includes('ajena'), true);
  // Otro certificado tiene su propia sesión.
  await portalDePrueba(sii.http, { almacen }).conSesion({ pfx: generarPfx('33333333-3'), clave: CLAVE_PFX }, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  assert.equal(sii.logins(), 2);
});

test('el límite de sesiones (720) no se reintenta: se espera sin conectar, también desde otra instancia', async () => {
  const sii = crearPortalFalso({ login: 'limite' });
  const almacen = crearAlmacenSesionesMemoria();
  const reloj = crearRelojFalso();
  const portal = portalDePrueba(sii.http, { almacen, reloj });
  await assert.rejects(portal.conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA)),
    e => esErrorPortal(e, 'LIMITE_SESIONES') && /720/.test(e.mensajeSii ?? '') && e.esperarHasta! >= reloj.ahora() + 35 * 60_000);
  assert.equal(sii.logins(), 1);
  const antes = sii.solicitudes.length;
  const otra = portalDePrueba(sii.http, { almacen, reloj });
  await assert.rejects(otra.conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA)), e => esErrorPortal(e, 'LIMITE_SESIONES'));
  assert.equal(sii.solicitudes.length, antes, 'mientras dura la espera no se habla con el SII');
  // Pasada la espera, se vuelve a intentar una vez.
  reloj.avanzar(ESPERA_LIMITE_MS + 1);
  sii.opciones.login = 'ok';
  await otra.conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  assert.equal(sii.logins(), 2);
});

test('sesión vencida: un solo login nuevo y el trabajo de lectura se repite una vez', async () => {
  const sii = crearPortalFalso();
  const almacen = crearAlmacenSesionesMemoria();
  const portal = portalDePrueba(sii.http, { almacen });
  await portal.conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  sii.vencerSesiones();
  const r = await portal.conSesion(certificado, 'resolucion', s => consultarResolucion(s, RUT_EMPRESA));
  assert.equal(r.numero, 0);
  assert.equal(sii.logins(), 2);
});

test('sesión vencida en un trabajo que escribe: no se repite solo', async () => {
  const sii = crearPortalFalso();
  const portal = portalDePrueba(sii.http);
  await portal.conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  sii.vencerSesiones();
  let veces = 0;
  await assert.rejects(portal.conSesion(certificado, 'escribe', s => { veces++; return consultarResolucion(s, RUT_EMPRESA); }, { escritura: true }),
    e => esErrorPortal(e, 'SESION_VENCIDA'));
  assert.equal(veces, 1);
  assert.equal(sii.logins(), 1);
});

test('solo se reintenta lo que no llegó al SII; un login que alcanzó a salir no se repite', async () => {
  const sii = crearPortalFalso();
  let fallas = 1;
  const conCorte: Http = async (p, c) => {
    if (fallas > 0 && p.url.includes('herculesr')) {
      fallas--;
      throw Object.assign(new Error('ECONNREFUSED'), { name: 'ErrorTransporte', causa: 'ECONNREFUSED', llego: false });
    }
    return sii.http(p, c);
  };
  // El ErrorTransporte real se construye en http.ts; aquí basta la forma con `llego`.
  const { ErrorTransporte } = await import('../server/sii-portal/http.ts');
  const transporte: Http = async (p, c) => {
    try { return await conCorte(p, c); } catch (e) { throw new ErrorTransporte('corte', 'ECONNREFUSED', (e as { llego: boolean }).llego); }
  };
  await portalDePrueba(transporte).conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA));
  assert.equal(sii.logins(), 1, 'el intento que no llegó no cuenta');

  const sii2 = crearPortalFalso();
  const corteTrasEnviar: Http = async (p, c) => {
    if (p.url.includes('herculesr')) { await sii2.http(p, c); throw new ErrorTransporte('tiempo de respuesta agotado', 'timeout', true); }
    return sii2.http(p, c);
  };
  await assert.rejects(portalDePrueba(corteTrasEnviar).conSesion(certificado, 'ficha', s => consultarFicha(s, RUT_EMPRESA)), e => esErrorPortal(e, 'TRANSPORTE'));
  assert.equal(sii2.logins(), 1, 'un login que pudo crear la sesión no se repite');
});

test('el listado de reobtención se lee por filas y entrega los más recientes primero', async () => {
  const sii = crearPortalFalso({ rangos: { 33: [{ desde: 5139, hasta: 5162, fecha: '2026-11-09' }, { desde: 4955, hasta: 5002, fecha: '2026-10-01' }] } });
  const rangos = await portalDePrueba(sii.http).conSesion(certificado, 'listar', s => listarReobtenibles(s, RUT_EMPRESA, 33));
  assert.deepEqual(rangos.map(r => [r.desde, r.hasta, r.fecha]), [[5139, 5162, '2026-11-09'], [4955, 5002, '2026-10-01']]);
  assert.deepEqual(leerRangos('<p>No registra timbrajes para el documento FACTURA ELECTRONICA</p>').filas, []);
});
