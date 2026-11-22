import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEquivalencias, type PreguntarMismo } from '../server/catalogo/equivalencias.ts';
import { conectarOfertasDeListas } from '../server/catalogo/ofertas.ts';
import type { LicitacionVista, NuevaOferta } from '../server/red/index.ts';

const harina = { nombre: 'Harina saco 25kg', unidad: 'saco' };
const harinaSinPolvos = { nombre: 'Harina sin polvos 25 kg', unidad: 'saco' };
const silencio = { warn() {} };

/** Jev falso: responde con la tabla y anota cada llamada. */
function jevFalso(tabla: Record<string, number>) {
  const llamadas: string[][] = [];
  const preguntar: PreguntarMismo = async (_ofertado, candidatos) => {
    llamadas.push([...candidatos]);
    return candidatos.map(c => tabla[c] ?? 0);
  };
  return { preguntar, llamadas };
}

test('sin Jev solo calza el nombre exacto, como antes', async () => {
  const eq = crearEquivalencias();
  await eq.aprender(harina, [harinaSinPolvos]);
  assert.equal(eq.mismo(harina, harinaSinPolvos), false);
  assert.equal(eq.mismo(harina, { nombre: 'harina  SACO 25 kg', unidad: 'saco' }), true);
});

test('Jev confirma sobre el umbral y descarta los dudosos', async () => {
  const azucar = { nombre: 'Azúcar 25 kg', unidad: 'saco' };
  const harinaIntegral = { nombre: 'Harina integral 25 kg', unidad: 'saco' };
  const jev = jevFalso({ [harinaSinPolvos.nombre]: 0.92, [harinaIntegral.nombre]: 0.4 });
  const eq = crearEquivalencias(jev.preguntar, silencio);
  await eq.aprender(harina, [harinaSinPolvos, harinaIntegral, azucar, { nombre: 'Harina sin polvos 25 kg', unidad: 'kg' }]);
  // Solo se pregunta por la misma unidad y con alguna palabra en común (el azúcar y el kg ni se preguntan).
  assert.deepEqual(jev.llamadas, [[harinaSinPolvos.nombre, harinaIntegral.nombre]]);
  assert.equal(eq.mismo(harinaSinPolvos, harina), true);
  assert.equal(eq.mismo(harina, harinaIntegral), false);
  // Cada par se pregunta una vez.
  await eq.aprender(harina, [harinaSinPolvos, harinaIntegral]);
  assert.equal(jev.llamadas.length, 1);
});

test('un error de Jev no se guarda: se reintenta después', async () => {
  let falla = true;
  const eq = crearEquivalencias(async (_o, c) => { if (falla) throw new Error('529'); return c.map(() => 0.9); }, silencio);
  await eq.aprender(harina, [harinaSinPolvos]);
  assert.equal(eq.mismo(harina, harinaSinPolvos), false);
  falla = false;
  await eq.aprender(harina, [harinaSinPolvos]);
  assert.equal(eq.mismo(harina, harinaSinPolvos), true);
});

test('la lista del proveedor oferta en la compra aunque el producto esté escrito distinto', async () => {
  const licitacion = {
    id: 'l1', estado: 'abierta', productos: [{ id: 'p1', ...harina, ofertas: [] }],
  } as unknown as LicitacionVista;
  const ofertas: NuevaOferta[] = [];
  const red = {
    estadoDeLaRed: () => ({ licitaciones: [licitacion] }),
    ofertar: async (_id: string, o: NuevaOferta) => { ofertas.push(o); },
    escuchar: () => () => {},
  };
  const catalogos = {
    listas: () => [{ proveedorId: 'prov', productos: [{ ...harinaSinPolvos, tramos: [{ desde: 1, precioUnitario: 18_000 }] }] }],
    alCambiarLista: () => {},
  } as unknown as Parameters<typeof conectarOfertasDeListas>[1];
  const { ofertarEn } = conectarOfertasDeListas(red, catalogos, silencio, crearEquivalencias(jevFalso({ [harinaSinPolvos.nombre]: 0.95 }).preguntar));
  await ofertarEn(licitacion);
  assert.equal(ofertas.at(-1)?.productoId, 'p1');
  assert.equal(ofertas.at(-1)?.precioUnitario, 18_000);
});
