import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detalleEvento } from '../client/src/red/derivar.ts';
import type { EstadoRed, EventoRed, OrdenCompra } from '../client/src/red/tipos.ts';

const orden: OrdenCompra = {
  id: 'o1', compradorId: 'c1', proveedorId: 'p1', estado: 'enviada', creadaEn: '2026-11-21T10:00:00Z',
  items: [{ producto: 'cajas de rollos térmicos 80 mm', cantidad: 4, precioUnitario: 14_950 }, { producto: 'harina', cantidad: 2, precioUnitario: 20_000 }],
};
const estado: EstadoRed = {
  negocios: [
    { id: 'p1', nombre: 'Papelera Austral', comuna: 'Santiago', rol: 'proveedor' },
    { id: 'c1', nombre: 'Almacén Uno', comuna: 'Ñuñoa', rol: 'comprador' },
  ],
  ordenes: [orden],
  documentos: [{ id: 'd1', ordenId: 'o1', tipo: 33, folio: 5190, trackId: null, estadoSii: 'aceptado', monto: 99_800 }],
  notas: [{ proveedorId: 'p1', nota: 4.2 }],
  licitaciones: [],
};
const evento = (tipo: EventoRed['tipo'], datos: Record<string, unknown>, en = '2026-11-21T10:00:00Z'): EventoRed => ({ tipo, datos, en });

test('un pedido muestra productos, cantidades y total, y una fila por ítem', () => {
  const d = detalleEvento(evento('orden.creada', { orden }), estado);
  assert.equal(d.resumen, '4 cajas de rollos térmicos 80 mm · 2 sacos de harina · $99.800');
  assert.deepEqual(d.filas[0], { etiqueta: '4 cajas de rollos térmicos 80 mm', valor: '$14.950 c/u · $59.800' });
  assert.ok(d.filas.some(f => f.etiqueta === 'Total neto' && f.valor === '$99.800'));
});

test('una factura muestra tipo, folio, monto y el estado más reciente del SII', () => {
  // El evento trae el documento recién emitido; la foto ya lo tiene aceptado.
  const d = detalleEvento(evento('documento.emitido', { documento: { ...estado.documentos[0], estadoSii: 'recibido' } }), estado);
  assert.equal(d.resumen, 'Factura 33 · folio 5190 · $99.800 neto · aceptado por el SII');
  assert.deepEqual(d.filas.find(f => f.sii), { etiqueta: 'Estado en el SII', valor: 'aceptado por el SII', sii: true });
  assert.equal(d.pdfUrl, undefined, 'el enlace al PDF es privado: solo si el evento lo trae');
});

test('un reclamo muestra el motivo y cómo cambió la nota del proveedor', () => {
  const reclamo = evento('reclamo.registrado', { orden, motivo: 'Faltan 2 de 4 unidades de rollos', reclamo: { estadoSii: 'reclamado' } });
  const eventos = [
    evento('nota.cambiada', { proveedorId: 'p1', anterior: 4.6, nota: 4.2 }, '2026-11-21T10:00:01Z'),
    evento('nota.cambiada', { proveedorId: 'p1', anterior: 4.8, nota: 4.6 }, '2026-11-21T09:00:00Z'),
    reclamo,
  ];
  const d = detalleEvento(reclamo, estado, eventos);
  assert.equal(d.resumen, 'Faltan 2 de 4 unidades de rollos · nota 4,6 → 4,2');
  assert.ok(d.filas.some(f => f.etiqueta === 'Factura reclamada' && f.valor === 'folio 5190 · $99.800'));
});
