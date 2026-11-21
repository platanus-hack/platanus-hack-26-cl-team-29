// Lo que la IA puede consultar de la red. Solo lectura, acotado al negocio que pregunta y
// sin teléfonos: todo sale de la foto pública (`estadoPublico`) y de la compra conjunta abierta.
import { nombreEnFrase } from '../../shared/documentos.ts';
import { totalOrden } from '../../shared/precios.ts';
import type { Red } from '../red/index.ts';
import { normalizarProducto, precioDe, PRODUCTOS_DISPONIBLES } from '../red/index.ts';

export type RedConsultable = Pick<Red, 'estadoPublico' | 'licitacionAbierta' | 'notaDeProveedor'>;

export interface Consultas {
  misPedidos(negocioId: string): unknown;
  proveedores(producto: string | null): unknown;
  catalogo(): unknown;
  compraConjunta(negocioId: string): unknown;
}

const MAX_PEDIDOS = 10;

export function crearConsultasRed(red: RedConsultable): Consultas {
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
      const canonico = producto ? normalizarProducto(producto) : undefined;
      if (producto && !canonico) return { aviso: `"${producto}" no está en el catálogo`, disponibles: PRODUCTOS_DISPONIBLES };
      return negocios
        .filter(n => n.rol === 'proveedor')
        .map(n => ({
          nombre: n.nombre,
          comuna: n.comuna,
          // La misma nota con que el agente elige proveedor al pedir (la foto pública omite algunas).
          nota: red.notaDeProveedor(n.id),
          ...(canonico ? { producto: canonico, precioNeto: precioDe(n.id, canonico) ?? null } : {}),
        }))
        .sort((a, b) => b.nota - a.nota);
    },

    catalogo() {
      const { negocios } = red.estadoPublico();
      const proveedores = negocios.filter(n => n.rol === 'proveedor');
      return PRODUCTOS_DISPONIBLES.map(nombre => {
        const precios = proveedores.map(p => precioDe(p.id, nombre)).filter((x): x is number => x !== undefined);
        return { producto: nombre, precioNetoDesde: precios.length ? Math.min(...precios) : null };
      });
    },

    compraConjunta(negocioId) {
      const l = red.licitacionAbierta();
      if (!l) return { abierta: false };
      const mio = l.participantes.find(p => p.negocioId === negocioId);
      const producto = (id: string) => l.productos.find(p => p.id === id);
      return {
        abierta: true,
        cierraEn: l.cierraEn,
        negociosSumados: l.participantes.length,
        // El proveedor se define al cierre: hasta entonces nadie le ha comprado a nadie.
        productos: l.productos.map(p => ({
          nombre: p.nombre,
          unidad: p.unidadPlural,
          precioSiCompraSolo: p.precioSolo,
          precioActual: p.precioActual,
          totalUnidadesDelGrupo: p.totalUnidades,
          siguienteTramo: p.siguienteTramo,
          ofertasDeProveedores: p.ofertas.length,
        })),
        tuPedido: mio
          ? mio.items.map(i => ({ producto: producto(i.productoId)?.nombre ?? i.productoId, cantidad: i.cantidad, precioActual: producto(i.productoId)?.precioActual ?? null }))
          : null,
      };
    },
  };
}
