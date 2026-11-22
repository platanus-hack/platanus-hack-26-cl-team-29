// Lo que la IA puede consultar de la red. Solo lectura, acotado al negocio que pregunta y
// sin teléfonos: todo sale de la foto pública (`estadoPublico`), de la compra conjunta abierta y de las listas de
// productos de los proveedores (server/catalogo): lo que de verdad se vende en Bando, con su precio base.
import { nombreEnFrase } from '../../shared/documentos.ts';
import { fechaEnChile, horaEnChile } from '../../shared/fecha.ts';
import { totalOrden } from '../../shared/precios.ts';
import { sugerirProductos } from '../../shared/productos.ts';
import { esUnidad } from '../../shared/unidades.ts';
import type { Catalogos } from '../catalogo/index.ts';
import { puedeVender } from '../../shared/red.ts';
import type { Red } from '../red/index.ts';

export type RedConsultable = Pick<Red, 'estadoPublico' | 'notaDeProveedor'>;

export interface Consultas {
  misPedidos(negocioId: string): unknown;
  proveedores(producto: string | null): unknown;
  catalogo(): unknown;
  compraConjunta(negocioId: string): unknown;
}

const MAX_PEDIDOS = 10;

/** Las listas de productos de los proveedores (server/catalogo). */
export type ListasDeProductos = Pick<Catalogos, 'listas'>;

export function crearConsultasRed(red: RedConsultable, catalogos: ListasDeProductos): Consultas {
  /** Cada producto de cada lista con su proveedor y su precio base (el primer tramo). */
  const enListas = () => catalogos.listas().flatMap(l => l.productos
    .filter(p => p.tramos.length && esUnidad(p.unidad))
    .map(p => ({ proveedorId: l.proveedorId, nombre: p.nombre, unidad: p.unidad as never, precioBase: p.tramos[0]!.precioUnitario, ...(p.minimo ? { minimo: p.minimo } : {}) })));

  return {
    misPedidos(negocioId) {
      const { ordenes, documentos, negocios } = red.estadoPublico();
      const nombre = (id: string) => negocios.find(n => n.id === id)?.nombre ?? 'desconocido';
      return ordenes
        .filter(o => o.compradorId === negocioId || o.proveedorId === negocioId)
        .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn))
        .slice(0, MAX_PEDIDOS)
        .map(o => ({
          id: o.id,
          yoSoy: o.compradorId === negocioId ? 'comprador' : 'proveedor',
          contraparte: nombre(o.compradorId === negocioId ? o.proveedorId : o.compradorId),
          items: o.items.map(i => ({ producto: i.producto, cantidad: i.cantidad, precioUnitario: i.precioUnitario })),
          total: totalOrden(o),
          estado: o.estado,
          creadaEn: o.creadaEn,
          documentos: documentos
            .filter(d => d.ordenId === o.id)
            .map(d => ({ tipo: nombreEnFrase(d.tipo), folio: d.folio, estadoSii: d.estadoSii })),
          ...(o.reclamo ? { reclamo: { faltante: o.reclamo.faltante, estadoSii: o.reclamo.estadoSii } } : {}),
        }));
    },

    proveedores(producto) {
      const { negocios } = red.estadoPublico();
      const nombre = (id: string) => negocios.find(n => n.id === id);
      if (!producto) {
        return negocios.filter(puedeVender)
          .map(n => ({ nombre: n.nombre, comuna: n.comuna, nota: red.notaDeProveedor(n.id) }))
          .sort((a, b) => b.nota - a.nota);
      }
      // Los que tienen en su lista un producto que calza con lo que preguntó ("duraznos" → "Durazno").
      const calzan = sugerirProductos(producto, enListas()) as ReturnType<typeof enListas>;
      if (!calzan.length) return { aviso: `Ningún proveedor tiene "${producto}" en su lista todavía` };
      return enListas().filter(x => calzan.some(c => c.nombre === x.nombre && c.unidad === x.unidad))
        .flatMap(x => {
          const n = nombre(x.proveedorId);
          return n ? [{ nombre: n.nombre, comuna: n.comuna, nota: red.notaDeProveedor(n.id), producto: x.nombre, unidad: x.unidad, precioNetoBase: x.precioBase, ...(x.minimo ? { pedidoMinimo: x.minimo } : {}) }] : [];
        })
        .sort((a, b) => a.precioNetoBase - b.precioNetoBase);
    },

    catalogo() {
      const porProducto = new Map<string, { producto: string; unidad: string; precioNetoDesde: number; proveedores: number }>();
      for (const x of enListas()) {
        const clave = `${x.nombre.toLowerCase()}|${x.unidad}`;
        const previo = porProducto.get(clave);
        porProducto.set(clave, previo
          ? { ...previo, precioNetoDesde: Math.min(previo.precioNetoDesde, x.precioBase), proveedores: previo.proveedores + 1 }
          : { producto: x.nombre, unidad: x.unidad, precioNetoDesde: x.precioBase, proveedores: 1 });
      }
      return [...porProducto.values()].sort((a, b) => a.producto.localeCompare(b.producto));
    },

    compraConjunta(negocioId) {
      // Todas las abiertas (cada comprador puede abrir una): lo que lleva en cada una y la hora de Chile del cierre.
      const abiertas = red.estadoPublico().licitaciones.filter(l => l.estado === 'abierta');
      if (!abiertas.length) return { abiertas: [] };
      return {
        abiertas: abiertas.map(l => {
          const mio = l.participantes.find(p => p.negocioId === negocioId);
          const producto = (id: string) => l.productos.find(p => p.id === id);
          return {
            cierra: `${fechaEnChile(l.cierraEn)} ${horaEnChile(Date.parse(l.cierraEn))} (hora de Chile)`,
            laAbristeTu: l.iniciadaPor === negocioId,
            negociosSumados: l.participantes.length,
            // El proveedor se define al cierre: hasta entonces nadie le ha comprado a nadie.
            productos: l.productos.map(p => ({
              nombre: p.nombre,
              unidad: p.unidadPlural,
              precioActual: p.precioActual,
              totalUnidadesDelGrupo: p.totalUnidades,
              siguienteTramo: p.siguienteTramo,
              ofertasDeProveedores: p.ofertas.length,
            })),
            tuPedido: mio
              ? (mio.items ?? []).map(i => ({ producto: producto(i.productoId)?.nombre ?? i.productoId, cantidad: i.cantidad, precioActual: producto(i.productoId)?.precioActual ?? null }))
              : null,
          };
        }),
      };
    },
  };
}
