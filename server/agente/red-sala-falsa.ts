// Red en memoria con compra conjunta, para tests y para probar el agente sin server/red/.
// Imita el contrato: tramos de precio por volumen, el mismo teléfono actualiza su cantidad,
// eventos `licitacion.precio_bajo`, `licitacion.cerrada`, `documento.emitido` y `licitacion.facturada`.
import { crearRedFalsa } from './red-falsa.ts';
import type { RedFalsa } from './red-falsa.ts';
import type { Documento, EventoDeLaRed, LicitacionSala, Negocio, OrdenCompra, ParticipanteSala, RedSala, Tramo } from './puerto.ts';

export interface RedSalaFalsa extends RedFalsa, RedSala {
  emitir(tipo: string, datos: unknown): void;
  readonly documentos: Documento[];
}

export interface DatosLicitacionFalsa {
  readonly id: string;
  readonly producto: string;
  readonly unidad: string;
  readonly unidadPlural: string;
  readonly proveedorId: string;
  readonly precioSolo: number;
  readonly tramos: readonly Tramo[];
  readonly cierraEn: string;
}

export function crearRedSalaFalsa(negocios: readonly Negocio[], datos: DatosLicitacionFalsa): RedSalaFalsa {
  const base = crearRedFalsa(negocios);
  const oyentes = new Set<(e: EventoDeLaRed) => void>();
  const participantes: (ParticipanteSala & { telefono: string; negocioId: string })[] = [];
  const telefonos = new Map<string, string>(negocios.map(n => [n.id, n.telefono]));
  const documentos: Documento[] = [];
  let estado: 'abierta' | 'cerrada' | 'facturada' = 'abierta';
  let ordenesSala: OrdenCompra[] = [];
  let folio = 1042;

  const emitir = (tipo: string, d: unknown) => { for (const o of oyentes) o({ tipo, datos: d }); };
  const total = () => participantes.reduce((s, p) => s + p.cantidad, 0);
  const precioPara = (unidades: number) =>
    [...datos.tramos].filter(t => t.desde <= Math.max(unidades, 1)).at(-1)?.precioUnitario ?? datos.precioSolo;

  function foto(): LicitacionSala {
    const unidades = total();
    const siguiente = datos.tramos.find(t => t.desde > unidades);
    return {
      ...datos,
      participantes: participantes.map(p => ({ ...p })),
      totalUnidades: unidades,
      precioActual: precioPara(unidades),
      siguienteTramo: siguiente ? { desde: siguiente.desde, precioUnitario: siguiente.precioUnitario, faltan: siguiente.desde - unidades } : null,
      estado,
    };
  }

  return {
    ...base,
    documentos,
    emitir,
    licitacionAbierta: () => (estado === 'abierta' ? foto() : null),
    unirseALicitacion(id, p) {
      if (estado !== 'abierta' || id !== datos.id) throw new Error('la compra conjunta ya cerró');
      if (!Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 20) throw new Error('cantidad fuera de rango');
      const antes = precioPara(total());
      const i = participantes.findIndex(x => x.telefono === p.telefono);
      const participante = { telefono: p.telefono, nombre: p.nombre, cantidad: p.cantidad, negocioId: `p-${p.telefono}` };
      if (i === -1) participantes.push(participante); else participantes[i] = participante;
      telefonos.set(participante.negocioId, p.telefono);
      const licitacion = foto();
      const bajoDePrecio = licitacion.precioActual < antes;
      if (bajoDePrecio) {
        emitir('licitacion.precio_bajo', { licitacionId: id, precioAnterior: antes, precioNuevo: licitacion.precioActual, totalUnidades: licitacion.totalUnidades });
      }
      return { licitacion, participante, precioActual: licitacion.precioActual, bajoDePrecio };
    },
    cerrarLicitacion(id) {
      base.llamadas.push(`cerrarLicitacion ${id}`);
      if (estado !== 'abierta') throw new Error('ya cerró');
      const precio = precioPara(total());
      ordenesSala = participantes.map((p, i) => ({
        id: `oc-sala-${i + 1}`, compradorId: p.negocioId, proveedorId: datos.proveedorId, estado: 'enviada', creadaEn: new Date().toISOString(),
        items: [{ producto: datos.producto, cantidad: p.cantidad, precioUnitario: precio }],
      }));
      const licitacion = foto();
      estado = 'cerrada';
      emitir('licitacion.cerrada', { licitacion: { ...licitacion, estado }, ordenes: ordenesSala });
      return ordenesSala;
    },
    confirmarOrdenesDeLicitacion(id) {
      base.llamadas.push(`confirmarOrdenesDeLicitacion ${id}`);
      if (estado !== 'cerrada') throw new Error('no hay compra cerrada por facturar');
      estado = 'facturada';
      const emitidos = ordenesSala.map(o => {
        const [item] = o.items;
        const doc: Documento = { id: `doc-${folio}`, ordenId: o.id, tipo: 33, folio: folio++, trackId: 'sobre-1', estadoSii: 'enviado' };
        documentos.push(doc);
        emitir('documento.emitido', { documento: doc });
        return { doc, ahorro: item.cantidad * (datos.precioSolo - item.precioUnitario) };
      });
      emitir('licitacion.facturada', {
        licitacionId: id, documentos: emitidos.map(e => e.doc), total: 0, ahorroTotal: emitidos.reduce((s, e) => s + e.ahorro, 0),
      });
      return emitidos.map(e => e.doc);
    },
    telefonoDeNegocio: id => telefonos.get(id) ?? null,
    escuchar(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
