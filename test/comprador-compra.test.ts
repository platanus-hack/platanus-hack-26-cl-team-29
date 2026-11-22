import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ahorroDelMes, escalera, frasco, localesDelGrupo, rango, siLlegan } from '../client/src/comprador/compra.ts';

const TRAMOS = [{ desde: 1, precioUnitario: 32000 }, { desde: 20, precioUnitario: 30500 }, { desde: 35, precioUnitario: 28900 }, { desde: 50, precioUnitario: 27000 }];
const CAJAS = { unidad: 'caja', unidadPlural: 'cajas' };

test('la escalera marca el tramo de hoy, el siguiente y los que ya se pasaron, de más barato a más caro', () => {
  assert.deepEqual(escalera(TRAMOS, 37).map(p => [p.desde, p.hasta, p.estado]), [
    [50, null, 'siguiente'], [35, 49, 'actual'], [20, 34, 'superado'], [1, 19, 'superado'],
  ]);
  assert.deepEqual(escalera(TRAMOS, 60).map(p => p.estado), ['actual', 'superado', 'superado', 'superado']);
  assert.deepEqual(escalera(TRAMOS, 10).map(p => p.estado), ['lejano', 'lejano', 'siguiente', 'actual']);
  assert.deepEqual(escalera([{ desde: 5, precioUnitario: 100 }], 0).map(p => p.estado), ['siguiente'], 'sin unidades, el primero es el siguiente');
});

test('cada tramo se lee como persona: "50 cajas o más", "20 a 34 cajas", "1 caja"', () => {
  assert.equal(rango({ desde: 50, hasta: null }, CAJAS), '50 cajas o más');
  assert.equal(rango({ desde: 20, hasta: 34 }, CAJAS), '20 a 34 cajas');
  assert.equal(rango({ desde: 1, hasta: 1 }, CAJAS), '1 caja');
});

test('el frasco se llena hacia el siguiente tramo y, sin más tramos, queda lleno', () => {
  const f = frasco(TRAMOS, 37, { desde: 50, precioUnitario: 27000, faltan: 13 });
  assert.equal(f.meta, 50);
  assert.equal(f.llenado, 0.74);
  assert.deepEqual(f.marcas, [0.4, 0.7], 'marca los tramos de 20 y 35 cajas');
  assert.equal(frasco(TRAMOS, 60, null).llenado, 1);
  assert.equal(frasco([], 0, null).llenado, 0);
});

test('"si llegan" usa el precio del siguiente tramo y la cantidad elegida', () => {
  assert.equal(siLlegan({ desde: 50, precioUnitario: 27000, faltan: 13 }, 6, CAJAS), 'Si llegan a 50 cajas, pagas $162.000 + IVA.');
  assert.equal(siLlegan(null, 6, CAJAS), '');
});

test('el grupo se cuenta por locales y comunas, nunca por nombre', () => {
  const negocios = [{ id: 'a', comuna: 'Providencia' }, { id: 'b', comuna: 'Ñuñoa' }, { id: 'c', comuna: 'Providencia' }, { id: 'd', comuna: 'Macul' }];
  const van = ['a', 'b', 'c', 'd'].map(negocioId => ({ negocioId, cantidad: 1 }));
  assert.equal(localesDelGrupo(van, negocios), '4 locales de Providencia y Macul');
  assert.equal(localesDelGrupo([{ negocioId: 'b', cantidad: 2 }, { negocioId: 'x', cantidad: 0 }], negocios), '1 local de Ñuñoa');
  assert.equal(localesDelGrupo([], negocios), '');
});

test('el ahorro del mes: contra el precio de comprar solo de cada producto, solo pedidos de compras en grupo de este mes', () => {
  const ahora = new Date('2026-11-22T15:00:00Z');
  const licitaciones = [{ id: 'L-1', productos: [{ id: 'coca', nombre: 'CocaCola 330ml', precioSolo: 1000 }, { id: 'papas', nombre: 'Papas', precioSolo: 0 }] }];
  const orden = (creadaEn: string, licitacionId?: string) => ({
    id: creadaEn, compradorId: 'c', proveedorId: 'p', estado: 'facturada' as const, creadaEn, ...(licitacionId ? { licitacionId } : {}),
    items: [{ productoId: 'coca', producto: 'CocaCola 330ml', cantidad: 100, precioUnitario: 800 }, { productoId: 'papas', producto: 'Papas', cantidad: 5, precioUnitario: 900 }],
  });
  // 100 cocas a $800 en vez de $1.000: ahorró $20.000 de $100.000 (20%). Las papas no tienen referencia.
  assert.deepEqual(ahorroDelMes([orden('2026-11-10T12:00:00Z', 'L-1')], licitaciones, ahora), { ahorro: 20_000, porcentaje: 20 });
  // De otro mes o sin compra en grupo: no cuenta.
  assert.equal(ahorroDelMes([orden('2026-10-30T12:00:00Z', 'L-1'), orden('2026-11-10T12:00:00Z')], licitaciones, ahora), null);
  // La red no pone la compra en el pedido: se encuentra por los pedidos de su cierre (`ordenIds`).
  const conOrdenes = [{ ...licitaciones[0]!, ordenIds: ['2026-11-12T12:00:00Z'] }];
  assert.deepEqual(ahorroDelMes([orden('2026-11-12T12:00:00Z')], conOrdenes, ahora), { ahorro: 20_000, porcentaje: 20 });
});
