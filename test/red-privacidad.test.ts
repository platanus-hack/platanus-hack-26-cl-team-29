import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, crearRepositorioMemoria, crearSiiFalso, COMPRADOR_DEMO, PROVEEDOR_DEMO } from '../server/red/index.ts';
import type { EventoRed } from '../server/red/index.ts';
import { sembrarSiVacio } from '../server/red/semilla.ts';

/** Falla si algún teléfono (o un campo `telefono`) aparece en lo que ve una pantalla. */
function sinTelefonos(publico: unknown, telefonos: string[]) {
  const texto = JSON.stringify(publico);
  assert.ok(!texto.includes('"telefono"'), `apareció un campo telefono: ${texto.slice(0, 200)}`);
  for (const t of telefonos) {
    const digitos = t.replace(/\D/g, '').slice(-8);
    assert.ok(!texto.replace(/\D/g, ' ').split(' ').some(n => n.endsWith(digitos)), `apareció el teléfono ${t}`);
  }
}

test('la foto pública y los eventos nunca llevan teléfonos', async () => {
  const repo = crearRepositorioMemoria();
  await sembrarSiVacio(repo);
  const red = await crearRed({ repo, sii: crearSiiFalso() });
  const eventos: EventoRed[] = [];
  red.escuchar(e => eventos.push(e));
  const telefonos = red.estadoDeLaRed().negocios.map(n => n.telefono).filter(Boolean);
  assert.ok(telefonos.length > 0, 'la foto interna sí tiene los teléfonos');

  const orden = await red.crearOrden({ compradorId: COMPRADOR_DEMO, proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'harina', cantidad: 2 }] });
  await red.confirmarOrden(orden.id);
  await red.unirseALicitacion('L-1', { nombre: 'Ana', cantidad: 1 });
  await red.reiniciarDemo();

  sinTelefonos(red.estadoPublico(), telefonos);
  assert.ok(eventos.length > 0);
  for (const e of eventos) sinTelefonos(e, telefonos);
});
