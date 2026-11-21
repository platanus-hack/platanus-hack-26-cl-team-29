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
  const deLaSala = '+56 9 8765 4321';
  const telefonos = [deLaSala, ...red.estadoDeLaRed().negocios.map(n => n.telefono).filter(Boolean)];

  const orden = await red.crearOrden({ compradorId: COMPRADOR_DEMO, proveedorId: PROVEEDOR_DEMO, items: [{ producto: 'harina', cantidad: 2 }] });
  await red.confirmarOrden(orden.id);
  const union = await red.unirseALicitacion('L-1', { telefono: deLaSala, nombre: 'Ana', cantidad: 12 });
  await red.unirseALicitacion('L-1', { telefono: deLaSala, nombre: 'Ana', cantidad: 13 });
  sinTelefonos(union, telefonos);
  // El evento licitacion.participante lleva al participante, que guarda el teléfono internamente.
  const participantes = eventos.filter(e => e.tipo === 'licitacion.participante');
  assert.equal(participantes.length, 2);
  for (const e of participantes) {
    const { participante, licitacion } = e.datos as { participante: Record<string, unknown>; licitacion: { participantes: Record<string, unknown>[] } };
    assert.equal(participante.nombre, 'Ana');
    assert.ok(!('telefono' in participante) && licitacion.participantes.every(p => !('telefono' in p)));
    sinTelefonos(e, telefonos);
  }
  sinTelefonos(red.licitacionAbierta(), telefonos);
  assert.ok(JSON.stringify(red.estadoDeLaRed()).includes('8765 4321'), 'la foto interna sí guarda el teléfono');
  sinTelefonos(red.estadoPublico(), telefonos);
  await red.cerrarLicitacion('L-1');
  await red.confirmarOrdenesDeLicitacion('L-1');
  sinTelefonos(red.estadoPublico(), telefonos);
  await red.reiniciarDemo();

  sinTelefonos(red.estadoPublico(), telefonos);
  assert.ok(eventos.some(e => e.tipo === 'licitacion.precio_bajo') && eventos.some(e => e.tipo === 'licitacion.facturada'));
  assert.ok(eventos.length > 0);
  for (const e of eventos) sinTelefonos(e, telefonos);
});

test('el sanitizador central quita teléfonos, tokens, RUT y datos del SII a cualquier nivel', async () => {
  const { sinTelefonos: limpiar } = await import('../server/red/publico.ts');
  const sucio = {
    a: { telefono: '56911112222', token: 'secreto', lista: [{ telefono: 'x', nombre: 'Ana', rut: '11111111-1', contribuyente: { razonSocial: 'Ana SpA' } }] },
  };
  assert.deepEqual(limpiar(sucio), { a: { lista: [{ nombre: 'Ana' }] } });
});
