import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loQueEmpeoro, revisarArchivo } from '../scripts/marca-reglas.ts';

test('cuenta colores escritos a mano, salvo en tokens.css y en comentarios', () => {
  const css = '.a { color: #E2B031; background: rgb(0 0 0 / .4); } /* el miel es #E2B031 */';
  assert.deepEqual(revisarArchivo('client/src/vistas/x.css', css), { 'color-escrito': 2 });
  assert.deepEqual(revisarArchivo('client/src/marca/tokens.css', css), {});
});

test('un enlace con # no es un color', () => {
  assert.deepEqual(revisarArchivo('client/src/x.tsx', '<a href="#compra/nueva">Ir</a> <a href="#add">'), {});
});

test('la tipografía anterior cuenta en cualquier archivo: toda la app es de la marca', () => {
  assert.deepEqual(revisarArchivo('client/src/vistas/x.css', '.t { font-family: Oxanium; }'), { 'tipografia-anterior': 1 });
});

test('letra bajo 12 px, toLocaleString y emojis', () => {
  const tsx = `const s = { fontSize: 11 }; const t = n.toLocaleString('es-CL'); const e = 'listo \u{1F389}'; // mapa © OSM`;
  assert.deepEqual(revisarArchivo('client/src/x.tsx', tsx), { 'formato-suelto': 1, 'letra-chica': 1, 'emoji': 1 });
  assert.deepEqual(revisarArchivo('client/src/x.css', '.a { font-size: 12px; } .b { font-size: 10px; }'), { 'letra-chica': 1 });
});

test('trinquete: solo falla lo que empeoró respecto de la línea base', () => {
  const base = { 'a.css': { 'color-escrito': 3 } };
  assert.deepEqual(loQueEmpeoro(base, { 'a.css': { 'color-escrito': 2 } }), []);
  assert.deepEqual(loQueEmpeoro(base, { 'a.css': { 'color-escrito': 4 }, 'b.tsx': { emoji: 1 } }), [
    { ruta: 'a.css', regla: 'color-escrito', antes: 3, ahora: 4 },
    { ruta: 'b.tsx', regla: 'emoji', antes: 0, ahora: 1 },
  ]);
});
