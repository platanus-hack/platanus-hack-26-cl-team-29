import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esTipoDocumento, nombreDocumento, nombreElectronico, nombreEnFrase } from '../shared/documentos.ts';

test('un solo nombre por tipo de documento, en título, en frase y electrónico', () => {
  assert.equal(nombreDocumento(52), 'Guía de despacho');
  assert.equal(nombreEnFrase(61), 'nota de crédito');
  assert.equal(nombreElectronico(33), 'Factura electrónica');
  assert.equal(nombreElectronico(801), 'Orden de compra');
  assert.equal(nombreDocumento(39), 'Documento tipo 39');
  assert.ok(esTipoDocumento(33));
  assert.ok(!esTipoDocumento('33'));
});
