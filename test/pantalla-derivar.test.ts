import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cambiosDeNota, cicloDeOrden, describirEvento, normalizarEstado, precioAjustado, ranking, resumenLicitacion } from '../client/src/red/derivar.ts';
import { contar, cuentaRegresiva, dinero, nota, textoEstadoSii } from '../client/src/red/formato.ts';
import type { EstadoRed, Licitacion } from '../client/src/red/tipos.ts';

const base = (): EstadoRed => ({
  negocios: [
    { id: 'a', nombre: 'Panificadora Uno', comuna: 'Santiago', rol: 'proveedor' },
    { id: 'b', nombre: 'Molinos Dos', comuna: 'Maipú', rol: 'proveedor' },
    { id: 'c', nombre: 'Harinas Tres', comuna: 'Recoleta', rol: 'proveedor' },
    { id: 'x', nombre: 'Almacén Equis', comuna: 'Ñuñoa', rol: 'comprador' },
  ],
  ordenes: [],
  documentos: [],
  notas: [{ proveedorId: 'a', nota: 4.7 }, { proveedorId: 'b', nota: 4.6 }, { proveedorId: 'c', nota: 4.4 }],
  licitaciones: [],
});

test('formatea dinero chileno y notas con coma', () => {
  assert.equal(dinero(17200), '$17.200');
  assert.equal(dinero(1234567), '$1.234.567');
  assert.equal(nota(4.2), '4,2');
  assert.equal(cuentaRegresiva(272_000), '04:32');
  assert.equal(contar(1, 'negocio'), '1 negocio');
  assert.equal(contar(3, 'día'), '3 días');
  assert.equal(textoEstadoSii('aceptado'), 'aceptado por el SII');
  assert.equal(cuentaRegresiva(7_171_000), '1:59:31');
});

test('normaliza notas que llegan como objeto y listas que faltan', () => {
  const e = normalizarEstado({ negocios: [], notas: { a: 4.5 } });
  assert.deepEqual(e.notas, [{ proveedorId: 'a', nota: 4.5 }]);
  assert.deepEqual(e.licitaciones, []);
});

test('una nota que baja se detecta y el ranking muestra de qué puesto cayó', () => {
  const antes = base();
  const despues = { ...antes, notas: antes.notas.map(n => (n.proveedorId === 'b' ? { ...n, nota: 4.2 } : n)) };
  const cambios = cambiosDeNota(antes, despues, 1000);
  assert.deepEqual(cambios, [{ proveedorId: 'b', anterior: 4.6, nota: 4.2, en: 1000 }]);
  const fila = ranking(despues, cambios).find(f => f.proveedor.id === 'b')!;
  assert.equal(fila.puesto, 3);
  assert.deepEqual(fila.cambio, { anterior: 4.6, puestoAnterior: 2 });
});

test('el ciclo de una orden reclamada marca el reclamo y deja la nota de crédito pendiente', () => {
  const e = base();
  e.ordenes = [{ id: 'o1', compradorId: 'x', proveedorId: 'b', estado: 'reclamada', creadaEn: '2026-11-21T12:00:00Z', items: [{ producto: 'Harina 25 kg', cantidad: 4, precioUnitario: 18500 }] }];
  e.documentos = [{ id: 'd', ordenId: 'o1', tipo: 33, folio: 10, trackId: null, estadoSii: 'aceptado' }];
  const pasos = cicloDeOrden(e, e.ordenes[0], [{ tipo: 'recepcion.registrada', datos: { ordenId: 'o1', faltante: 2 }, en: '' }]);
  assert.deepEqual(pasos.map(p => p.estado), ['hecho', 'hecho', 'hecho', 'hecho', 'ultimo', 'pendiente']);
  assert.match(pasos[3].detalle, /faltan 2/);
  assert.equal(pasos[2].detalle, 'Folio 10 · aceptado por el SII');
});

test('gana el menor precio ajustado por nota y plazo; la más barata con mala nota se marca', () => {
  const e = base();
  e.notas = e.notas.map(n => (n.proveedorId === 'b' ? { ...n, nota: 4.2 } : n));
  const lic: Licitacion = {
    id: 'l', producto: 'Harina 25 kg', comuna: 'Ñuñoa', cierraEn: '', estado: 'abierta', precioSolo: 21500,
    participantes: [{ negocioId: 'x', cantidad: 4 }, { nombre: 'Público', cantidad: 6 }],
    ofertas: [
      { proveedorId: 'a', precioUnitario: 17900, plazoDias: 1 },
      { proveedorId: 'b', precioUnitario: 17100, plazoDias: 3 },
      { proveedorId: 'a', precioUnitario: 17200, plazoDias: 1 },
    ],
  };
  const r = resumenLicitacion(lic, e);
  assert.equal(r.mejor?.proveedorId, 'a');
  assert.equal(r.mejor?.precioUnitario, 17200);
  assert.equal(r.ofertas.length, 2);
  assert.equal(r.ofertas.find(o => o.proveedorId === 'b')?.riesgo, true);
  assert.equal(r.ahorroGrupal, (21500 - 17200) * 10);
  assert.equal(r.delPublico, 1);
  assert.deepEqual(r.curva.map(p => p.precio), [21500, 17900, 17200, 17200]);
  assert.equal(r.ofertas[0].gana, true);
});

test('el precio ajustado coincide con la fórmula del backend', () => {
  assert.equal(precioAjustado(17900, 2, 3.9), Math.round(17900 * 1.11 * 1.02));
});

test('el feed lee los datos con la forma del contrato', () => {
  const e = base();
  const orden = { id: 'OC-1001', compradorId: 'x', proveedorId: 'a', estado: 'enviada' as const, creadaEn: '', items: [{ producto: 'Harina 25 kg', cantidad: 4, precioUnitario: 18000 }] };
  assert.equal(describirEvento({ tipo: 'orden.creada', datos: { orden }, en: '' }, e), 'Almacén Equis pidió 4 sacos a Panificadora Uno');
  assert.equal(describirEvento({ tipo: 'documento.emitido', datos: { documento: { tipo: 33, folio: 7, ordenId: 'OC-1001' } }, en: '' }, e), 'Factura folio 7 emitida en el SII');
  assert.equal(describirEvento({ tipo: 'licitacion.participante', datos: { participante: { nombre: 'Kiosco Uno', comuna: 'Macul', cantidad: 2 } }, en: '' }, e), 'Kiosco Uno en Macul se sumó a la compra conjunta');
});

test('documento.actualizado muestra el nuevo estado en el SII', () => {
  const ev = { tipo: 'documento.actualizado' as const, datos: { documento: { tipo: 33, folio: 7, estadoSii: 'aceptado' } }, en: '' };
  assert.equal(describirEvento(ev, base()), 'Factura folio 7 · aceptado por el SII');
});
