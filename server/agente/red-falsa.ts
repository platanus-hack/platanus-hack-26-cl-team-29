// Red en memoria para tests y para probar el agente sin server/red/. Imita lo justo del
// dominio: estados de la orden y una nota que baja con un reclamo y sube con la nota de crédito.
import type { Documento, Negocio, OrdenCompra, Red } from './puerto.ts';

export interface RedFalsa extends Red {
  readonly ordenes: OrdenCompra[];
  readonly llamadas: string[];
}

export function crearRedFalsa(negocios: readonly Negocio[], opciones: {
  readonly notas?: Record<string, number>;
  readonly precio?: number;
  /** Para simular una guía que no calza con la orden: unidades que realmente se despachan. */
  readonly despachar?: (cantidad: number) => number;
} = {}): RedFalsa {
  const notas = new Map(Object.entries(opciones.notas ?? {}));
  const ordenes: OrdenCompra[] = [];
  const llamadas: string[] = [];
  let folio = 100;

  const buscar = (id: string) => {
    const i = ordenes.findIndex(o => o.id === id);
    if (i === -1) throw new Error(`no existe la orden ${id}`);
    return i;
  };
  const cambiar = (id: string, cambio: Partial<OrdenCompra>) => {
    const i = buscar(id);
    ordenes[i] = { ...ordenes[i], ...cambio };
    return ordenes[i];
  };
  const ajustarNota = (proveedorId: string, delta: number) =>
    notas.set(proveedorId, Math.round(((notas.get(proveedorId) ?? 4) + delta) * 10) / 10);

  return {
    ordenes,
    llamadas,
    negocioPorTelefono: telefono => negocios.find(n => n.telefono === telefono) ?? null,
    estadoDeLaRed: () => ({ negocios, ordenes }),
    notaDeProveedor: id => notas.get(id) ?? 4,
    crearOrden({ compradorId, proveedorId, items }) {
      llamadas.push('crearOrden');
      const orden: OrdenCompra = {
        id: `oc-${ordenes.length + 1}`, compradorId, proveedorId, estado: 'enviada', creadaEn: new Date().toISOString(),
        items: items.map(i => ({ ...i, precioUnitario: opciones.precio ?? 17200 })),
      };
      ordenes.push(orden);
      return orden;
    },
    confirmarOrden(id) {
      llamadas.push(`confirmarOrden ${id}`);
      const orden = ordenes[buscar(id)];
      const items = orden.items.map(i => ({ ...i, cantidadDespachada: opciones.despachar?.(i.cantidad) ?? i.cantidad }));
      return cambiar(id, { estado: 'facturada', items });
    },
    registrarRecepcion(id, recepcion) {
      llamadas.push(`registrarRecepcion ${id} ${'faltante' in recepcion ? `faltante ${recepcion.faltante}` : 'conforme'}`);
      const orden = ordenes[buscar(id)];
      ajustarNota(orden.proveedorId, 'faltante' in recepcion ? -0.2 : 0.1);
      return cambiar(id, { estado: 'faltante' in recepcion ? 'reclamada' : 'recibida' });
    },
    emitirNotaCredito(id) {
      llamadas.push(`emitirNotaCredito ${id}`);
      const orden = cambiar(id, { estado: 'corregida' });
      ajustarNota(orden.proveedorId, 0.2);
      const documento: Documento = { id: `doc-${folio}`, ordenId: id, tipo: 61, folio: folio++, trackId: 'falso', estadoSii: 'aceptado' };
      return documento;
    },
  };
}
