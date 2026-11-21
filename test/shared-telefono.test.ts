import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enlaceWhatsapp, formatearTelefono } from '../shared/telefono.ts';

test('formatea teléfonos con su código de país', () => {
  assert.equal(formatearTelefono('12084828247'), '+1 (208) 482-8247');
  assert.equal(formatearTelefono('56912345678'), '+56 9 1234 5678');
  assert.equal(formatearTelefono('+56 9 1234 5678'), '+56 9 1234 5678');
  assert.equal(formatearTelefono('34612345678'), '+34 612 345 678');
  assert.equal(formatearTelefono('447911123456'), '+44 791 112 3456');
});

test('el enlace de WhatsApp usa solo dígitos y desaparece sin número', () => {
  assert.equal(enlaceWhatsapp('+56 9 0000 0000', 'Hola'), 'https://wa.me/56900000000?text=Hola');
  assert.equal(enlaceWhatsapp('56900000000', 'Quiero sumarme'), 'https://wa.me/56900000000?text=Quiero%20sumarme');
  assert.equal(enlaceWhatsapp(null), '');
});
