// Lo que la IA puede consultar de la red. Solo lectura, acotado al negocio que pregunta y
// sin teléfonos: todo sale de la foto pública (`estadoPublico`) y de la compra conjunta abierta.
import type { Red } from '../red/index.ts';
import { normalizarProducto, precioDe, PRODUCTOS_DISPONIBLES } from '../red/index.ts';

export type RedConsultable = Pick<Red, 'estadoPublico' | 'licitacionAbierta' | 'notaDeProveedor'>;

export interface Consultas {
  misPedidos(negocioId: string): unknown;
  proveedores(producto: string | null): unknown;
  catalogo(): unknown;
  compraConjunta(): unknown;
}

const NOMBRE_DOCUMENTO = { 33: 'factura', 52: 'guía de despacho', 61: 'nota de crédito' } as const;
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
          total: o.items.reduce((suma, i) => suma + i.cantidad * i.precioUnitario, 0),
          estado: o.estado,
          creadaEn: o.creadaEn,
          documentos: documentos
            .filter(d => d.ordenId === o.id)
            .map(d => ({ tipo: NOMBRE_DOCUMENTO[d.tipo], folio: d.folio, estadoSii: d.estadoSii })),
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

    compraConjunta() {
      const l = red.licitacionAbierta();
      if (!l) return { abierta: false };
      return {
        abierta: true,
        producto: l.producto,
        unidad: l.unidad,
        precioSiCompraSolo: l.precioSolo,
        precioActual: l.precioActual,
        totalUnidades: l.totalUnidades,
        negociosSumados: l.participantes.length,
        siguienteTramo: l.siguienteTramo,
        tramos: l.tramos,
        ofertasDeProveedores: l.ofertas.length,
        cierraEn: l.cierraEn,
      };
    },
  };
}
