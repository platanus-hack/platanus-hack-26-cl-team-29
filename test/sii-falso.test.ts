import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearSii } from '../server/sii/index.ts';

const silencioso = { info() {}, warn() {}, error() {} };
const receptor = { rut: '11111111-1', razonSocial: 'Cliente de Prueba', giro: 'Comercio', direccion: 'Calle 1', comuna: 'Santiago' };

test('sin credenciales crearSii entrega la implementación falsa, con el flujo completo en memoria', async () => {
  const sii = crearSii({ env: { SII_RUT_EMISOR: '22.222.222-2' }, log: silencioso });
  assert.equal(sii.modo, 'falso');
  assert.equal(sii.rutEmisor, '22222222-2');

  const { documento, envio } = await sii.emitirFactura({
    folio: 7, fechaEmision: '2026-11-21', receptor,
    items: [{ nombre: 'Tornillos', cantidad: 10, precioUnitario: 100 }],
    ordenCompra: { folio: 'OC-1', fecha: '2026-11-20' },
  });
  assert.equal(documento.montoTotal, 1190);
  assert.ok(envio.estado === 'recibido');
  assert.equal((await sii.estadoEnvio(envio.trackId)).codigo, 'EPR');

  const consulta = { tipo: 33, folio: 7, fechaEmision: '2026-11-21', montoTotal: 1190, rutReceptor: receptor.rut };
  assert.equal((await sii.estadoDocumento(consulta)).codigo, 'DOK');
  assert.equal((await sii.estadoDocumento({ ...consulta, montoTotal: 1 })).codigo, 'DNK');
  assert.equal((await sii.estadoDocumento({ ...consulta, folio: 8 })).codigo, 'FAU');

  const factura = { rutEmisor: '22222222-2', tipo: 33, folio: 7 };
  assert.equal((await sii.eventosDocumento(factura)).resultado, 'sin_eventos');
  assert.equal((await sii.registrarAccionReceptor(factura, 'ACD')).resultado, 'ok');
  assert.equal((await sii.registrarAccionReceptor(factura, 'ACD')).resultado, 'ya_registrado');
  assert.equal((await sii.registrarAccionReceptor(factura, 'RFP')).resultado, 'previamente_aceptado');
  assert.deepEqual((await sii.eventosDocumento(factura)).eventos.map(e => e.codigo), ['ACD']);
});

test('la implementación falsa valida la entrada igual que la real', async () => {
  const sii = crearSii({ env: {}, log: silencioso });
  await assert.rejects(sii.emitirFactura({ folio: 1, receptor: { ...receptor, rut: '11111111-2' }, items: [{ nombre: 'x', cantidad: 1, precioUnitario: 1 }] }), /dígito verificador/);
  await assert.rejects(sii.emitirGuia({ folio: 1, receptor, items: [], motivoTraslado: 1 }), /al menos un ítem/);
  await assert.rejects(sii.registrarAccionReceptor({ rutEmisor: '11111111-1', tipo: 61, folio: 1 }, 'ACD'), /33, 34, 43/);
});

test('con certificado pero sin el resto de la configuración, falla al crear y dice qué falta', () => {
  assert.throws(() => crearSii({ env: { SII_PFX_BASE64: 'x' }, log: silencioso }), /SII_PFX_CLAVE.*SII_FCH_RESOL/);
});
