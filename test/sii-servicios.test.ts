import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Autenticador } from '../server/sii/autenticacion.ts';
import { subirSobre } from '../server/sii/envio.ts';
import { estadoEnvio } from '../server/sii/estado.ts';
import { crearSii } from '../server/sii/index.ts';
import { listarEventos, registrarAccion, resultadoDe } from '../server/sii/reclamo.ts';
import { ColaSii, type Http, type SolicitudHttp, URLS } from '../server/sii/soap.ts';
import {
  CLAVE_PFX,
  certificadoDePrueba,
  generarCaf,
  generarPfx,
  RUT_EMPRESA,
  respuestaSemilla,
  respuestaSoap,
  respuestaToken,
} from './sii-apoyo.ts';

/** HTTP falso: responde según la URL, en orden, y anota cada solicitud. */
function httpFalso(respuestas: Partial<Record<string, (string | Error | { status: number; cuerpo: string })[]>>) {
  const llamadas: SolicitudHttp[] = [];
  let tokens = 0;
  const http: Http = async solicitud => {
    llamadas.push(solicitud);
    if (solicitud.url === URLS.semilla) return { status: 200, cuerpo: respuestaSemilla };
    if (solicitud.url === URLS.token) return { status: 200, cuerpo: respuestaToken(`TOK${++tokens}`) };
    const siguiente = respuestas[solicitud.url]?.shift();
    if (siguiente instanceof Error) throw siguiente;
    if (siguiente === undefined) throw new Error(`sin respuesta para ${solicitud.url}`);
    return typeof siguiente === 'string' ? { status: 200, cuerpo: siguiente } : siguiente;
  };
  const a = (url: string) => llamadas.filter(l => l.url === url);
  return { http, llamadas: a };
}

const estadoUp = (estado: string, extra = '') =>
  respuestaSoap(`<SII:RESP_HDR><TRACKID>123</TRACKID><ESTADO>${estado}</ESTADO><GLOSA>glosa ${estado}</GLOSA></SII:RESP_HDR>${extra}`);

test('el token se reutiliza y, si el SII responde ESTADO 001, se renueva y se reintenta una sola vez', async () => {
  const cuerpoEpr =
    '<SII:RESP_BODY><TIPO_DOCTO>33</TIPO_DOCTO><INFORMADOS>1</INFORMADOS><ACEPTADOS>1</ACEPTADOS>' +
    '<RECHAZADOS>0</RECHAZADOS><REPAROS>0</REPAROS></SII:RESP_BODY>';
  const { http, llamadas } = httpFalso({ [URLS.estadoEnvio]: [estadoUp('EPR', cuerpoEpr), estadoUp('001'), estadoUp('EPR', cuerpoEpr)] });
  const auth = new Autenticador(http, certificadoDePrueba());

  const primero = await estadoEnvio(http, auth, RUT_EMPRESA, '123');
  assert.equal(primero.codigo, 'EPR');
  assert.deepEqual(primero.porTipo, [{ tipo: 33, informados: 1, aceptados: 1, rechazados: 0, reparos: 0 }]);

  const segundo = await estadoEnvio(http, auth, RUT_EMPRESA, '123');
  assert.equal(segundo.codigo, 'EPR');
  assert.equal(llamadas(URLS.token).length, 2, 'un token inicial y uno por el 001');
  assert.match(String(llamadas(URLS.estadoEnvio)[2]?.cuerpo), /<Token>TOK2<\/Token>/);
  // La semilla firmada viaja escapada dentro de pszXml.
  assert.match(String(llamadas(URLS.token)[0]?.cuerpo), /<pszXml>&lt;\?xml version="1.0" encoding="UTF-8"\?&gt;\n&lt;getToken&gt;/);
});

test('la subida es multipart en Latin-1 y un corte de red vuelve como incierto, sin reintentar', async () => {
  const sobreXml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n<EnvioDTE>Ñ</EnvioDTE>';
  const recibido = httpFalso({ [URLS.subida]: ['<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>0900000001</TRACKID></RECEPCIONDTE>'] });
  const ok = await subirSobre(recibido.http, new Autenticador(recibido.http, certificadoDePrueba()), {
    sobreXml, rutEmisor: RUT_EMPRESA, rutEnvia: '11111111-1',
  });
  assert.deepEqual({ ...ok, respuesta: undefined }, { estado: 'recibido', trackId: '0900000001', respuesta: undefined });
  const subida = recibido.llamadas(URLS.subida)[0]!;
  const cuerpo = Buffer.from(subida.cuerpo as Uint8Array);
  assert.equal(subida.cabeceras.Cookie, 'TOKEN=TOK1');
  assert.equal(subida.cabeceras['User-Agent'], 'Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)');
  assert.ok(cuerpo.includes(Buffer.from([0xd1])), 'Ñ como un solo byte');
  for (const campo of ['name="rutSender"\r\n\r\n11111111', 'name="dvCompany"\r\n\r\n2', 'filename="EnvioDTE.xml"\r\nContent-Type: text/xml']) {
    assert.ok(cuerpo.toString('latin1').includes(campo), campo);
  }

  const cortado = httpFalso({ [URLS.subida]: [new Error('read ECONNRESET'), '<STATUS>0</STATUS>'] });
  const incierto = await subirSobre(cortado.http, new Autenticador(cortado.http, certificadoDePrueba()), {
    sobreXml, rutEmisor: RUT_EMPRESA, rutEnvia: '11111111-1',
  });
  assert.equal(incierto.estado, 'incierto');
  assert.equal(cortado.llamadas(URLS.subida).length, 1);

  const rechazado = httpFalso({ [URLS.subida]: ['<RECEPCIONDTE><STATUS>6</STATUS></RECEPCIONDTE>'] });
  const r = await subirSobre(rechazado.http, new Autenticador(rechazado.http, certificadoDePrueba()), {
    sobreXml, rutEmisor: RUT_EMPRESA, rutEnvia: '11111111-1',
  });
  assert.equal(r.estado === 'rechazado' && r.status, '6');
});

test('crearSii en certificación arma, timbra, firma y sube la factura en un sobre', async () => {
  const { http, llamadas } = httpFalso({ [URLS.subida]: ['<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>42</TRACKID></RECEPCIONDTE>'] });
  const sii = crearSii({
    http,
    log: { info() {}, warn() {}, error() {} },
    env: {
      SII_PFX_BASE64: generarPfx().toString('base64'), SII_PFX_CLAVE: CLAVE_PFX, SII_RUT_EMISOR: RUT_EMPRESA,
      SII_FCH_RESOL: '2026-01-01', SII_CAF_33_BASE64: generarCaf(33).bytes.toString('base64'),
      SII_EMISOR_RAZON_SOCIAL: 'Compañía de Prueba', SII_EMISOR_GIRO: 'Insumos', SII_EMISOR_ACTECO: '465000',
      SII_EMISOR_DIRECCION: 'Calle 1', SII_EMISOR_COMUNA: 'Santiago',
    },
  });
  const r = await sii.emitirFactura({
    folio: 3, receptor: { rut: '11111111-1', razonSocial: 'Cliente', giro: 'Comercio', direccion: 'Calle 2', comuna: 'Santiago' },
    items: [{ nombre: 'Tornillos', cantidad: 2, precioUnitario: 500 }], ordenCompra: { folio: 'OC-9', fecha: '2026-11-20' },
  });
  assert.equal(sii.modo, 'certificacion');
  assert.deepEqual(r.envio.estado === 'recibido' && r.envio.trackId, '42');
  const archivo = Buffer.from(llamadas(URLS.subida)[0]!.cuerpo as Uint8Array).toString('latin1');
  assert.ok(archivo.includes(r.sobreXml), 'el archivo subido es el sobre devuelto');
  assert.match(r.sobreXml, /<RznSoc>Compañía de Prueba<\/RznSoc>/);
  await assert.rejects(sii.emitirGuia({ folio: 1, receptor: { rut: '11111111-1', razonSocial: 'C', giro: 'G', direccion: 'D', comuna: 'S' }, items: [{ nombre: 'x', cantidad: 1, precioUnitario: 1 }], motivoTraslado: 1 }), /SII_CAF_52_BASE64/);
});

test('emitirFacturas sube N facturas en un solo sobre, con un SubTotDTE y una sola subida', async () => {
  const { http, llamadas } = httpFalso({ [URLS.subida]: ['<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>77</TRACKID></RECEPCIONDTE>'] });
  const sii = crearSii({
    http,
    log: { info() {}, warn() {}, error() {} },
    env: {
      SII_PFX_BASE64: generarPfx().toString('base64'), SII_PFX_CLAVE: CLAVE_PFX, SII_RUT_EMISOR: RUT_EMPRESA,
      SII_FCH_RESOL: '2026-01-01', SII_CAF_33_BASE64: generarCaf(33).bytes.toString('base64'),
      SII_EMISOR_RAZON_SOCIAL: 'Empresa de Prueba', SII_EMISOR_GIRO: 'Insumos', SII_EMISOR_ACTECO: '465000',
      SII_EMISOR_DIRECCION: 'Calle 1', SII_EMISOR_COMUNA: 'Santiago',
    },
  });
  const receptor = { rut: '11111111-1', razonSocial: 'Cliente', giro: 'Comercio', direccion: 'Calle 2', comuna: 'Santiago' };
  const r = await sii.emitirFacturas([3, 4, 5].map(folio => ({
    folio, receptor, items: [{ nombre: 'Harina 25 kg', cantidad: folio, precioUnitario: 18500 }], ordenCompra: { folio: `OC-${folio}`, fecha: '2026-11-21' },
  })));
  assert.deepEqual(r.documentos.map(d => d.folio), [3, 4, 5]);
  assert.equal(r.envio.estado === 'recibido' && r.envio.trackId, '77');
  assert.equal(llamadas(URLS.subida).length, 1);
  assert.match(r.sobreXml, /<SubTotDTE><TpoDTE>33<\/TpoDTE><NroDTE>3<\/NroDTE><\/SubTotDTE>/);
  assert.equal(r.sobreXml.match(/<DTE /g)?.length, 3);
});

test('codResp del WS de reclamos se traduce a un resultado', () => {
  assert.deepEqual(
    [0, 7, 8, 11, 14, 17, 16, 18, -1, 5].map(resultadoDe),
    ['ok', 'ya_registrado', 'fuera_de_plazo', 'previamente_aceptado', 'no_autorizado', 'no_autorizado', 'sin_eventos', 'no_recibido', 'error_sii', 'rechazado'],
  );
});

test('el WS de reclamos va a ws2 con su namespace, Header vacío y la cookie TOKEN, y lee los eventos', async () => {
  const retorno = (metodo: string, interior: string) =>
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:${metodo}Response xmlns:ns2="x">` +
    `<return>${interior}</return></ns2:${metodo}Response></soap:Body></soap:Envelope>`;
  const { http, llamadas } = httpFalso({
    [URLS.reclamo]: [
      { status: 401, cuerpo: 'no autorizado' },
      retorno('ingresarAceptacionReclamoDoc', '<codResp>7</codResp><descResp>Evento registrado previamente</descResp>'),
      retorno('listarEventosHistDoc', '<codResp>15</codResp><descResp>Listado</descResp>' +
        '<listaEventosDoc><codEvento>RFP</codEvento><descEvento>Reclamo por Falta Parcial</descEvento>' +
        '<rutResponsable>11111111</rutResponsable><dvResponsable>1</dvResponsable><fechaEvento>2026-11-21 10:00:00</fechaEvento></listaEventosDoc>'),
    ],
  });
  const auth = new Autenticador(http, certificadoDePrueba());
  const documento = { rutEmisor: RUT_EMPRESA, tipo: 33, folio: 7 };

  const accion = await registrarAccion(http, auth, documento, 'RFP');
  assert.deepEqual(accion, { codigo: 7, descripcion: 'Evento registrado previamente', resultado: 'ya_registrado' });
  const pedido = llamadas(URLS.reclamo)[1]!;
  assert.equal(pedido.cabeceras.Cookie, 'TOKEN=TOK2', 'el 401 renovó el token');
  assert.equal(pedido.cabeceras.SOAPAction, '');
  assert.match(String(pedido.cuerpo), /xmlns:ws="http:\/\/ws.registroreclamodte.diii.sdi.sii.cl">\n {2}<soapenv:Header\/>/);
  assert.match(String(pedido.cuerpo), /<rutEmisor>22222222<\/rutEmisor><dvEmisor>2<\/dvEmisor><tipoDoc>33<\/tipoDoc><folio>7<\/folio><accionDoc>RFP<\/accionDoc>/);

  const eventos = await listarEventos(http, auth, documento);
  assert.equal(eventos.resultado, 'ok');
  assert.deepEqual(eventos.eventos, [{ codigo: 'RFP', descripcion: 'Reclamo por Falta Parcial', rutResponsable: '11111111-1', fecha: '2026-11-21 10:00:00' }]);
  await assert.rejects(registrarAccion(http, auth, { ...documento, tipo: 52 }, 'ACD'), /33, 34, 43/);
});

test('la cola deja al menos el intervalo entre el inicio de dos solicitudes', async () => {
  const cola = new ColaSii(40);
  const inicios: number[] = [];
  await Promise.all([1, 2, 3].map(() => cola.turno(async () => void inicios.push(performance.now()))));
  assert.ok(inicios[1]! - inicios[0]! >= 38 && inicios[2]! - inicios[1]! >= 38, inicios.join(', '));
});

test('el módulo solo conoce hosts de certificación', () => {
  const codigo = readdirSync('server/sii').map(f => readFileSync(join('server/sii', f), 'utf8')).join('\n');
  assert.doesNotMatch(codigo, /palena|rahue|ws1\.sii|\/\/api\.sii/);
  assert.match(codigo, /maullin\.sii\.cl/);
});
