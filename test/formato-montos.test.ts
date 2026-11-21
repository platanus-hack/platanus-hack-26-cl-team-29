import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dinero as dineroWeb } from '../client/src/red/formato.ts';
import { dinero as dineroWhatsApp } from '../server/agente/mensajes.ts';

// Regla fija: todo monto lleva separador de miles, también los de cuatro dígitos.
for (const [nombre, dinero] of [['web', dineroWeb], ['WhatsApp', dineroWhatsApp]] as const) {
  test(`montos con separador de miles (${nombre})`, () => {
    assert.equal(dinero(6900), '$6.900');
    assert.equal(dinero(34400), '$34.400');
    assert.equal(dinero(1234567), '$1.234.567');
    assert.equal(dinero(950), '$950');
  });
}
