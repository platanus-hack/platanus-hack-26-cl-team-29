import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desgloseIva, dineroMasIva, ivaDe, totalConIva } from '../shared/precios.ts';

// Todo monto guardado es neto: la web muestra el total con IVA y, debajo, su desglose, con el mismo redondeo del DTE.
test('el total con IVA suma el IVA redondeado como en el DTE', () => {
  assert.equal(ivaDe(351_600), 66_804);
  assert.equal(totalConIva(351_600), 418_404);
  assert.equal(totalConIva(0), 0);
  assert.equal(desgloseIva(351_600), 'Neto $351.600 · IVA $66.804');
});

test('una nota de crédito resta el mismo IVA que sumó la factura', () => {
  assert.equal(ivaDe(-12_345), -ivaDe(12_345));
  assert.equal(totalConIva(-351_600), -418_404);
  assert.equal(desgloseIva(-351_600), 'Neto -$351.600 · IVA -$66.804');
});

test('un precio unitario neto se lee con su "+ IVA"', () => {
  assert.equal(dineroMasIva(27_900), '$27.900 + IVA');
});
