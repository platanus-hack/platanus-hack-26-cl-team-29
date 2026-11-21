import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digitoVerificador, formatearRut, formatearRutAlEscribir, normalizarRut, partirRut, validarRut } from '../shared/rut.ts';

test('dígito verificador con módulo 11, incluidos 0 y K', () => {
  assert.equal(digitoVerificador('12345678'), '5');
  assert.equal(digitoVerificador('5126663'), '3');
  assert.equal(digitoVerificador('11111111'), '1');
  assert.equal(digitoVerificador('22222222'), '2');
});

test('el RUT de una persona se acepta con o sin puntos y guion, y se guarda en la forma del SII', () => {
  for (const texto of ['12.345.678-5', '12345678-5', '123456785', ' 12 345 678 5 ', '11.111.111-1']) {
    assert.ok(validarRut(texto), texto);
  }
  assert.equal(validarRut('12.345.678-5'), '12345678-5');
  assert.equal(validarRut('5.126.663-3'), '5126663-3');
  for (const texto of ['12.345.678-6', '1234', 'abc', '', '12.345.678-', '123456789012-3', '123-4']) {
    assert.equal(validarRut(texto), null, texto);
  }
});

test('la forma del SII lanza con formato o dígito verificador inválido', () => {
  assert.equal(normalizarRut('012.345.678-5'), '12345678-5');
  assert.deepEqual(partirRut('76.123.456-0'), ['76123456', '0']);
  assert.throws(() => normalizarRut('12345678-6'), /dígito verificador/);
  assert.throws(() => normalizarRut('123456785'), /formato/);
});

test('el RUT se muestra con puntos y se formatea mientras se escribe', () => {
  assert.equal(formatearRut('12345678-5'), '12.345.678-5');
  assert.equal(formatearRut('76123456-k'), '76.123.456-K');
  assert.equal(formatearRut('no es rut'), 'no es rut');
  assert.equal(formatearRutAlEscribir('1'), '1');
  assert.equal(formatearRutAlEscribir('12'), '1-2');
  assert.equal(formatearRutAlEscribir('1234'), '123-4');
  assert.equal(formatearRutAlEscribir('123456785'), '12.345.678-5');
  assert.equal(formatearRutAlEscribir('12.345.678-5'), '12.345.678-5');
  assert.equal(formatearRutAlEscribir('12345678k'), '12.345.678-K');
  assert.equal(formatearRutAlEscribir('12k34'), '123-4', 'una K en medio se descarta');
  assert.equal(formatearRutAlEscribir('1234567890'), '12.345.678-9', 'no pasa de 9 caracteres');
});
