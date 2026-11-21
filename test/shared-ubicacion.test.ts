import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centroDeComuna, MUT, ubicarProveedor } from '../shared/ubicacion.ts';

const km = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111.19;

test('con comuna conocida, el proveedor cae junto al centro de su comuna', () => {
  const u = ubicarProveedor({ clave: '76.000.000-0', comuna: 'Ñuñoa', region: 'Región Metropolitana de Santiago' });
  assert.equal(u?.ubicacion, 'comuna');
  assert.ok(km(u!.punto, centroDeComuna('Ñuñoa')!) < 2);
});

test('solo con región: punto estable, aproximado y dentro de esa región', () => {
  const rm = { clave: '77.111.222-3', comuna: '', region: 'Región Metropolitana de Santiago' };
  assert.deepEqual(ubicarProveedor(rm), ubicarProveedor(rm));
  assert.equal(ubicarProveedor(rm)?.ubicacion, 'region');
  for (let i = 0; i < 200; i++) {
    const p = ubicarProveedor({ ...rm, clave: `rut-${i}` })!;
    assert.ok(km(p.punto, MUT) < 30, 'Santiago: dentro del área urbana');
  }
  const conce = ubicarProveedor({ clave: '78.000.000-1', comuna: '', region: 'Región del Biobío' })!;
  assert.equal(conce.ubicacion, 'region');
  assert.ok(km(conce.punto, [-73.05, -36.83]) < 15, 'otra región: cerca de su capital');
  // Una comuna fuera de la tabla no se inventa: cae a su región.
  assert.equal(ubicarProveedor({ clave: 'x', comuna: 'Viña del Mar', region: 'Región de Valparaíso' })?.ubicacion, 'region');
});

test('sin comuna ni región no se ubica', () => {
  assert.equal(ubicarProveedor({ clave: 'x', comuna: '', region: '' }), null);
});
