import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { crearAlmacenConexionMemoria, crearConexionSii, crearPortalConexion, crearSiiConmutable } from '../server/conexion-sii/index.ts';
import type { OpcionesConexion } from '../server/conexion-sii/index.ts';
import { esRechazoDeCaratula } from '../server/conexion-sii/sii-conmutable.ts';
import { crearAlmacenSesionesMemoria, crearCandadoMemoria, crearLimitador, crearPortalSii, leerFicha } from '../server/sii-portal/index.ts';
import { crearSiiFalso } from '../server/red/index.ts';
import type { CambioEstadoSii, PuertoSii, SiiReal } from '../server/red/index.ts';
import { CLAVE_PFX, generarPfx, RUT_EMPRESA } from './sii-apoyo.ts';
import { crearPortalFalso, crearRelojFalso } from './sii-portal-falso.ts';
import type { OpcionesFalso } from './sii-portal-falso.ts';

const silencioso = { info() {}, warn() {}, error() {} };
const pfxBase64 = generarPfx().toString('base64');
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

/** Conexión con el portal real (sesión, candado, flujos) sobre un SII falso a nivel HTTP. */
function montar(opciones: OpcionesFalso, usados = new Set<number>()) {
  const sii = crearPortalFalso(opciones);
  const reloj = crearRelojFalso();
  const portal = crearPortalSii({
    almacen: crearAlmacenSesionesMemoria(), candado: crearCandadoMemoria(), limitador: crearLimitador({ reloj, separacionMs: 0 }),
    http: sii.http, reloj, log: silencioso,
  });
  const consultados: number[] = [];
  const crearConsulta: OpcionesConexion['crearConsulta'] = () => async c => {
    consultados.push(c.folio);
    const codigo = usados.has(c.folio) ? 'DOK' : 'FAU';
    return { codigo, glosa: null, codigoError: null, glosaError: null, respuesta: `<ESTADO>${codigo}</ESTADO>` };
  };
  const conexion = crearConexionSii({
    almacen: crearAlmacenConexionMemoria(), env: { SII_LLAVE_CIFRADO: randomBytes(32).toString('base64') }, log: silencioso,
    portal: crearPortalConexion(portal), crearConsulta,
  });
  const rutas = () => sii.solicitudes.map(s => s.ruta.split('/').pop()!);
  return { sii, conexion, consultados, rutas };
}

const paso = (estado: Awaited<ReturnType<ReturnType<typeof montar>['conexion']['estado']>>, id: string) => estado.automatico!.pasos.find(p => p.id === id)!;

test('conectar con certificado y RUT: ficha, resolución y CAF reobteniendo primero, pidiendo solo lo que falta y sin anular', async () => {
  const { sii, conexion, rutas } = montar({
    rangos: { 33: [{ desde: 5139, hasta: 5162, fecha: hoy }], 52: [{ desde: 2744, hasta: 2793, fecha: hoy }] },
    maxAutor: 3,
  });
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX, RUT_EMPRESA);
  await conexion.esperarBusquedas();
  const e = await conexion.estado();
  assert.equal(sii.logins(), 1, 'una sola sesión para toda la conexión');
  assert.equal(e.empresa?.razonSocial, 'Comercial de Prueba SpA');
  assert.deepEqual(e.resolucion, { fecha: '2026-10-07', numero: 0, origen: 'sii', rechazada: false });
  assert.deepEqual(e.cafs.map(c => [c.tipo, c.desde, c.hasta]), [[33, 5139, 5162], [52, 2744, 2793], [61, 901, 903]]);
  assert.match(paso(e, 'caf_33').detalle!, /reobtuvieron 24 folios/);
  assert.match(paso(e, 'caf_61').detalle!, /pidieron 3 folios nuevos al SII/);
  const r = rutas();
  // Del 33 y 52 nunca se piden folios; del 61 se pide recién después de revisar el listado de reobtención, y dentro del tope (3).
  assert.equal(r.filter(x => x === 'of_genera_folio').length, 1);
  assert.ok(r.lastIndexOf('rf_reobtencion2_folios') < r.indexOf('of_solicita_folios'));
  assert.ok(sii.solicitudes.some(s => s.ruta.endsWith('of_confirma_folio') && /CANT_DOCTOS=3/.test(s.cuerpo)));
  assert.equal(r.filter(x => x.startsWith('af_anular')).length, 0, 'nunca se anulan folios');
  assert.equal(e.conectado, true);
});

test('un rango sin folios libres en el SII se recuerda y no se vuelve a revisar; uno vencido se salta; recién entonces se pide', async () => {
  const vencido = '2026-01-10';
  const usados = new Set(Array.from({ length: 11 }, (_, i) => 10 + i));
  const { conexion, rutas, consultados } = montar({ rangos: { 33: [{ desde: 10, hasta: 20, fecha: hoy }, { desde: 1, hasta: 5, fecha: vencido }] } }, usados);
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX, RUT_EMPRESA);
  await conexion.esperarBusquedas();
  assert.deepEqual(consultados.filter(f => f <= 20), [...usados], 'se pregunta el tramo completo: el uso no va en orden');
  assert.ok(!consultados.some(f => f < 10), 'el rango vencido no se consulta');
  assert.ok(!rutas().includes('rf_reobtencion3_folios'), 'no se abre ningún rango');
  assert.deepEqual((await conexion.estado()).cafs.filter(c => c.tipo === 33).map(c => [c.desde, c.hasta]), [[901, 910]], 'se pidieron solo los que faltan');

  // Otra reposición: el rango barrido no se vuelve a preguntar.
  const antes = consultados.length;
  await conexion.folios.reponer(33, { demanda: 20 });
  assert.ok(consultados.slice(antes).every(f => f > 20), 'nada del rango 10-20 otra vez');
  assert.equal(rutas().filter(x => x.startsWith('af_anular')).length, 0);
});

test('con el timbraje bloqueado se muestra el texto del SII y no se anula ni se insiste', async () => {
  const bloqueo = 'NO SE AUTORIZA TIMBRAJE ELECTRONICO. Usted tiene disponible una cantidad de folios suficiente para emitir documentos electronicos.';
  const { conexion, rutas } = montar({ bloqueo });
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX, RUT_EMPRESA);
  await conexion.esperarBusquedas();
  const e = await conexion.estado();
  for (const id of ['caf_33', 'caf_52', 'caf_61']) {
    assert.equal(paso(e, id).estado, 'error');
    assert.match(paso(e, id).mensajeSii ?? '', /NO SE AUTORIZA TIMBRAJE/);
  }
  assert.equal(rutas().filter(x => x === 'of_solicita_folios_dcto').length, 3, 'un intento por tipo, sin repetir');
  assert.equal(rutas().filter(x => x.startsWith('af_anular') || x === 'of_genera_folio').length, 0);
  // Enfriamiento: mientras dura, nadie vuelve a tocar el SII (ni la reposición ni el botón del panel).
  const antes = rutas().length;
  const f = await conexion.folios.reponer(33, { demanda: 3 });
  assert.equal(f.estado, 'en_espera');
  assert.match(f.mensajeSii ?? '', /NO SE AUTORIZA TIMBRAJE/);
  await assert.rejects(conexion.traerFolios(33), /pidió esperar.*NO SE AUTORIZA TIMBRAJE/);
  assert.equal(rutas().length, antes, 'ninguna solicitud nueva al SII');
});

test('con el límite de sesiones del SII la conexión se detiene en el primer paso, con un solo intento de login', async () => {
  const { sii, conexion } = montar({ login: 'limite' });
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX, RUT_EMPRESA);
  await conexion.esperarBusquedas();
  const e = await conexion.estado();
  assert.equal(sii.logins(), 1);
  assert.ok(e.automatico!.pasos.every(p => p.estado === 'error' && /720/.test(p.mensajeSii ?? '')));
});

test('si la app del SII pide la verificación en dos pasos, la resolución queda para escribirla a mano y lo demás sigue', async () => {
  const { conexion } = montar({ app: 'dos_pasos', rangos: { 33: [{ desde: 1, hasta: 9, fecha: hoy }] } });
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX, RUT_EMPRESA);
  await conexion.esperarBusquedas();
  const e = await conexion.estado();
  assert.equal(paso(e, 'resolucion').estado, 'error');
  assert.match(paso(e, 'resolucion').detalle!, /dos pasos.*Escríbela/);
  assert.match(paso(e, 'resolucion').mensajeSii!, /verificacion en dos pasos/);
  assert.equal(paso(e, 'empresa').estado, 'listo');
  assert.equal(paso(e, 'caf_33').estado, 'listo');
  assert.equal(e.conectado, false, 'sin resolución no se emite');
});

test('un RCT (error en carátula) deja la conexión sin emitir hasta corregir la resolución', async () => {
  const { conexion } = montar({ rangos: { 33: [{ desde: 1, hasta: 9, fecha: hoy }] } });
  const oyentes: ((c: CambioEstadoSii) => void)[] = [];
  const real = { ...crearSiiFalso(), emitirFactura: async () => ({ folio: 1, trackId: 'T1', estadoSii: 'recibido' }), alCambiarEstado: (o: (c: CambioEstadoSii) => void) => { oyentes.push(o); } } as unknown as SiiReal;
  const sii = crearSiiConmutable({ falso: crearSiiFalso(), conexionDe: async () => conexion, crearReal: () => real });
  await conexion.subirCertificado(pfxBase64, CLAVE_PFX, RUT_EMPRESA);
  await conexion.esperarBusquedas();
  assert.equal((await conexion.estado()).conectado, true);
  await sii.emitirFactura({} as Parameters<PuertoSii['emitirFactura']>[0]);
  assert.ok(esRechazoDeCaratula('<SII:RESP_HDR><ESTADO>RCT</ESTADO></SII:RESP_HDR>'));
  oyentes[0]!({ tipo: 33, folio: 1, estadoSii: 'rechazado', detalle: '<ESTADO>RCT</ESTADO><GLOSA>Rechazado por Error en Caratula</GLOSA>' });
  await new Promise(r => setTimeout(r, 10));
  const e = await conexion.estado();
  assert.equal(e.resolucion?.rechazada, true);
  assert.equal(e.conectado, false);
});

test('la ficha se lee con la forma real de la página: tablas anidadas y una fila sin <tr>', () => {
  const celda = (t: string) => `<td width="300" align="left"><font class="texto">\n${t}\n</font></td>`;
  const html = `<table><tr><td width="630"><table border="1">
    <tr>${celda('DATOS DEL CONTRIBUYENTE RUT')}${celda('22222222-2')}</tr><tr>
    ${celda('NOMBRE O RAZ&Oacute;N SOCIAL')}${celda('COMERCIAL DE PRUEBA SPA')}</tr><tr>
    ${celda('DIRECCI&Oacute;N DE LA EMPRESA')}${celda('CALLE FALSA 123 , Bloque G, Comuna MACUL')}</tr>
    ${celda('DIRECCI&Oacute;N REGIONAL DEL CONTRIBUYENTE')}${celda('NUNOA')}</tr><tr>
    </table></td></tr></table><TR><td>C&oacute;digo</td><td>Descripci&oacute;n</td><td>Afecto</td></tr>
    <tr><td>    620100  </td><td>  ACTIVIDADES DE PROGRAMACION INFORMATICA </td><td>SI</td></tr>`;
  const f = leerFicha(html);
  assert.deepEqual([f.razonSocial, f.direccion, f.comuna, f.acteco], ['COMERCIAL DE PRUEBA SPA', 'CALLE FALSA 123 , Bloque G', 'MACUL', 620100]);
});
