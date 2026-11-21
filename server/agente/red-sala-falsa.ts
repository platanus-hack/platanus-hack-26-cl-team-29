// Red en memoria con compra conjunta de varios productos (la canasta), para tests y para probar el agente sin server/red/.
// Imita el contrato: tramos de precio por producto, el mismo teléfono reemplaza su carrito, carrito vacío = sale,
// eventos `licitacion.precio_bajo` (con productoId), `licitacion.cerrada`, `documento.emitido` y `licitacion.facturada`.
// Con `sinCanasta` imita a la red antigua: un solo producto y solo `unirseALicitacion`. Con `conPdf`, ofrece `enlacePdf`.
// Con `ruts` (RUT -> razón social), ofrece `consultarRut` como la red real: valida el dígito verificador y solo conoce esos RUT.
import { precioPorVolumen, siguienteTramo, unidadesDe as unidadesDelProducto } from '../../shared/precios.ts';
import { RUT_INVALIDO, validarRut } from '../../shared/rut.ts';
import { crearRedFalsa } from './red-falsa.ts';
import type { RedFalsa } from './red-falsa.ts';
import type {
  Documento, EventoDeLaRed, ItemCarrito, LicitacionSala, Negocio, OrdenCompra, ProductoCompra, RedSala, Tramo,
} from './puerto.ts';

export interface RedSalaFalsa extends RedFalsa, RedSala {
  emitir(tipo: string, datos: unknown): void;
  readonly documentos: Documento[];
  /** RUT con que se sumó cada teléfono (solo con `ruts`). */
  readonly rutPorTelefono: Map<string, string>;
  /** Dirección para la factura con que se sumó cada teléfono. */
  readonly direccionPorTelefono: Map<string, { direccion: string; comuna: string }>;
}

export interface ProductoFalso {
  readonly id: string;
  readonly nombre: string;
  readonly unidad: string;
  readonly unidadPlural: string;
  readonly precioSolo: number;
  readonly tramos: readonly Tramo[];
}

export interface DatosLicitacionFalsa {
  readonly id: string;
  readonly proveedorId: string;
  readonly productos: readonly ProductoFalso[];
  readonly cierraEn: string;
}

const MAXIMO = 20;

/** Error como los de la red real: `codigo` y un mensaje para mostrar tal cual. */
const errorRut = (mensaje: string) => Object.assign(new Error(mensaje), { codigo: 'datos_invalidos' });

export function crearRedSalaFalsa(
  negocios: readonly Negocio[], datos: DatosLicitacionFalsa,
  opciones: { sinCanasta?: boolean; conPdf?: boolean; ruts?: Readonly<Record<string, string | { razonSocial: string; direccion: string; comuna: string }>> } = {},
): RedSalaFalsa {
  const base = crearRedFalsa(negocios);
  const oyentes = new Set<(e: EventoDeLaRed) => void>();
  const participantes: { telefono: string; negocioId: string; nombre: string; items: ItemCarrito[] }[] = [];
  const telefonos = new Map<string, string>(negocios.map(n => [n.id, n.telefono]));
  const documentos: Documento[] = [];
  const rutPorTelefono = new Map<string, string>();
  const direccionPorTelefono = new Map<string, { direccion: string; comuna: string }>();
  let estado: 'abierta' | 'cerrada' | 'facturada' = 'abierta';
  let ordenesSala: OrdenCompra[] = [];
  let folio = 5190;

  const emitir = (tipo: string, d: unknown) => { for (const o of oyentes) o({ tipo, datos: d }); };
  const unidadesDe = (id: string) => unidadesDelProducto({ participantes }, id);
  const precioPara = (p: ProductoFalso, unidades: number) => precioPorVolumen(p, Math.max(unidades, 1));

  function producto(p: ProductoFalso): ProductoCompra {
    const unidades = unidadesDe(p.id);
    return { ...p, totalUnidades: unidades, precioActual: precioPara(p, unidades), siguienteTramo: siguienteTramo(p.tramos, unidades) };
  }

  function foto(): LicitacionSala {
    const productos = datos.productos.map(producto);
    const [p0] = productos;
    return {
      id: datos.id, proveedorId: datos.proveedorId, cierraEn: datos.cierraEn, estado,
      ...(opciones.sinCanasta ? {} : { productos }),
      producto: p0.nombre, unidad: p0.unidad, unidadPlural: p0.unidadPlural, precioSolo: p0.precioSolo, tramos: p0.tramos,
      totalUnidades: p0.totalUnidades, precioActual: p0.precioActual, siguienteTramo: p0.siguienteTramo,
      participantes: participantes.map(({ items, ...p }) => ({
        ...p, ...(opciones.sinCanasta ? {} : { items: [...items] }), cantidad: items.reduce((s, i) => s + i.cantidad, 0),
      })),
    };
  }

  function actualizarCarrito(id: string, p: { telefono: string; nombre?: string; rut?: string; direccionFactura?: { direccion: string; comuna: string }; items: readonly ItemCarrito[] }) {
    if (estado !== 'abierta' || id !== datos.id) throw new Error('la compra conjunta ya cerró');
    if (p.rut) rutPorTelefono.set(p.telefono, p.rut);
    if (p.direccionFactura) direccionPorTelefono.set(p.telefono, { ...p.direccionFactura });
    for (const i of p.items) {
      if (!datos.productos.some(x => x.id === i.productoId)) throw new Error(`no existe el producto ${i.productoId}`);
      if (!Number.isInteger(i.cantidad) || i.cantidad < 0 || i.cantidad > MAXIMO) throw new Error('cantidad fuera de rango');
    }
    const antes = datos.productos.map(x => precioPara(x, unidadesDe(x.id)));
    const items = p.items.filter(i => i.cantidad > 0).map(i => ({ ...i }));
    const i = participantes.findIndex(x => x.telefono === p.telefono);
    const negocioId = `p-${p.telefono}`;
    let participante: (typeof participantes)[number] | null = null;
    if (items.length === 0) {
      if (i !== -1) participantes.splice(i, 1);
    } else {
      participante = { telefono: p.telefono, negocioId, nombre: p.nombre ?? participantes[i]?.nombre ?? 'Negocio', items };
      if (i === -1) participantes.push(participante); else participantes[i] = participante;
      telefonos.set(negocioId, p.telefono);
    }
    const licitacion = foto();
    datos.productos.forEach((x, k) => {
      const nuevo = precioPara(x, unidadesDe(x.id));
      if (nuevo < antes[k]) {
        emitir('licitacion.precio_bajo', { licitacionId: id, productoId: x.id, precioAnterior: antes[k], precioNuevo: nuevo, totalUnidades: unidadesDe(x.id) });
      }
    });
    return { licitacion, participante: participante ? licitacion.participantes.find(x => x.negocioId === negocioId)! : null };
  }

  const canasta = opciones.sinCanasta ? {} : {
    actualizarCarrito,
    salirDeLicitacion(id: string, p: { telefono: string }) {
      base.llamadas.push(`salirDeLicitacion ${id}`);
      return actualizarCarrito(id, { telefono: p.telefono, items: [] });
    },
  };

  return {
    ...base,
    ...canasta,
    documentos,
    emitir,
    licitacionAbierta: () => (estado === 'abierta' ? foto() : null),
    unirseALicitacion(id, p) {
      if (!Number.isInteger(p.cantidad) || p.cantidad < 1) throw new Error('cantidad fuera de rango');
      const r = actualizarCarrito(id, { telefono: p.telefono, nombre: p.nombre, items: [{ productoId: datos.productos[0].id, cantidad: p.cantidad }] });
      return { licitacion: r.licitacion, participante: r.participante!, precioActual: r.licitacion.precioActual, bajoDePrecio: false };
    },
    cerrarLicitacion(id) {
      base.llamadas.push(`cerrarLicitacion ${id}`);
      if (estado !== 'abierta') throw new Error('ya cerró');
      const precios = new Map(datos.productos.map(x => [x.id, precioPara(x, unidadesDe(x.id))]));
      ordenesSala = participantes.map((p, i) => ({
        id: `oc-sala-${i + 1}`, compradorId: p.negocioId, proveedorId: datos.proveedorId, estado: 'enviada', creadaEn: new Date().toISOString(),
        items: p.items.map(item => ({
          producto: datos.productos.find(x => x.id === item.productoId)!.nombre,
          ...(opciones.sinCanasta ? {} : { productoId: item.productoId }),
          cantidad: item.cantidad, precioUnitario: precios.get(item.productoId)!,
        })),
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
        const doc: Documento = { id: `doc-${folio}`, ordenId: o.id, tipo: 33, folio: folio++, trackId: 'sobre-1', estadoSii: 'enviado' };
        documentos.push(doc);
        emitir('documento.emitido', { documento: doc });
        return doc;
      });
      emitir('licitacion.facturada', { licitacionId: id, documentos: emitidos, total: 0, ahorroTotal: 0 });
      return emitidos;
    },
    ...(opciones.conPdf ? { enlacePdf: (d: Documento) => `https://demo.invalid/pdf/${d.id}` } : {}),
    rutPorTelefono,
    direccionPorTelefono,
    ...(opciones.ruts ? {
      consultarRut(texto: string) {
        base.llamadas.push('consultarRut');
        const rut = validarRut(texto);
        if (!rut) throw errorRut(RUT_INVALIDO);
        const conocido = opciones.ruts![rut];
        if (!conocido) throw errorRut('No encontramos ese RUT en el SII. Revísalo e intenta de nuevo.');
        return typeof conocido === 'string' ? { rut, razonSocial: conocido } : { rut, ...conocido };
      },
    } : {}),
    telefonoDeNegocio: id => telefonos.get(id) ?? null,
    escuchar(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
