// Red falsa del canal web: la misma interfaz que la API real, en memoria. Se usa mientras el backend
// no tiene las rutas con sesión (o con `?prueba`). Todos los nombres son ficticios.
// Simula a la contraparte: el proveedor confirma y factura solo, y emite la nota de crédito tras un reclamo.

import type { Documento, EventoRed, Negocio, Participante, ProductoCompra, TipoDocumento, TipoEventoRed } from '../red/tipos.ts';
import { ErrorCanal, type CanalApi } from './api.ts';
import { crearConexionSiiFalsa } from './sii-falso.ts';
import { CANASTA_DEMO } from '../../../shared/canasta-demo.ts';
import {
  armarCatalogo, errorDeProductoEscrito, historialDeEjemplo, juntarCatalogo, lineasDeEjemplo, productoManual, resumenDeFacturas,
  type CatalogoProveedor, type ProductoCatalogo, type ProductoEscrito,
} from '../../../shared/catalogo.ts';
import { pluralDe, sinTildes } from '../../../shared/texto.ts';
import { CANTIDAD_MAXIMA } from '../../../shared/red.ts';
import { mismoProducto, sugerirProductos } from '../../../shared/productos.ts';
import { esUnidad } from '../../../shared/unidades.ts';
import { duenoDeTramos, errorDeTramos, ordenarTramos, precioDelProducto, puedeCerrarAntes, totalesDeCanasta, totalOrden } from '../../../shared/precios.ts';
import { COMPRADORES_FALSOS } from '../red/falso.ts';
import { armarRuta, paradasDeOrdenes, POR_ENTREGAR } from '../../../shared/ruta.ts';
import { centroDeComuna, MUT, ubicarEnComuna } from '../../../shared/ubicacion.ts';
import { formatearRutAlEscribir, RUT_INVALIDO, validarRut } from '../../../shared/rut.ts';
import { telefonoParaWhatsapp } from '../../../shared/telefono.ts';
import type { ConfigRed, FacturaA, FotoRed, LicitacionCanal, OrdenCanal, Participacion } from './tipos.ts';

/** La canasta por defecto del contrato. */
const PRODUCTOS: ProductoCompra[] = structuredClone([...CANASTA_DEMO]);
const TRAMOS = PRODUCTOS[0].tramos;

const CONFIG: ConfigRed = {
  whatsappNumero: null,
  productos: PRODUCTOS.map(({ id, nombre, unidad, unidadPlural }) => ({ id, nombre, unidad, unidadPlural })),
  producto: PRODUCTOS[0].nombre,
  unidad: PRODUCTOS[0].unidad,
  unidadPlural: PRODUCTOS[0].unidadPlural,
};

const PROVEEDOR_DEMO = 'p-papelera';
/** Con datos de prueba, este teléfono entra como el proveedor y cualquier código de 6 dígitos sirve. */
export const TELEFONO_PROVEEDOR_FALSO = '56900000000';

const PROVEEDORES: Array<[string, string, string, number]> = [
  [PROVEEDOR_DEMO, 'Papelera del Centro', 'Santiago', 4.2],
  ['p-nuble', 'Panificadora Ñuble', 'Santiago', 4.7],
  ['p-molinos', 'Molinos del Sur', 'Maipú', 4.6],
  ['p-andes', 'Harinas Andes', 'Las Condes', 4.5],
  ['p-sur', 'Distribuidora Sur', 'Recoleta', 4.4],
];


const DEL_PUBLICO = ['Cafetería El Sol', 'Fuente de soda La Pasada', 'Amasandería Doña Carmen', 'Almacén El Roble', 'Minimarket Las Palmas', 'Botillería San José', 'Pizzería El Puente', 'Almacén La Plaza'];
const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'Santiago'];

/** Precio neto de referencia de los productos que no son de la compra conjunta. */
const PRECIOS: Record<string, number> = {
  ...Object.fromEntries(PRODUCTOS.map(p => [p.nombre, p.precioSolo])),
  'Harina 25 kg': 18_000,
  'Levadura 500 g': 3_500,
  'Azúcar 25 kg': 24_000,
  'Manteca 10 kg': 21_000,
  'Sal 25 kg': 9_000,
};

/** Carritos de los compradores sembrados: el grupo parte cerca de bajar de tramo en varios productos. */
const CARRITOS_SEMBRADOS: Array<Array<[string, number]>> = [
  [['rollos', 4], ['etiquetas', 2]], [['rollos', 6], ['bolsas', 3]], [['rollos', 3], ['guantes', 2]],
  [['rollos', 2], ['bolsas', 2]], [['rollos', 3], ['etiquetas', 4]], [['rollos', 3], ['guantes', 4]],
];

const conCantidad = (p: Participante): Participante => ({ ...p, cantidad: (p.items ?? []).reduce((s, i) => s + i.cantidad, 0) });

const tramoEn = (p: ProductoCompra, unidades: number) => [...p.tramos].reverse().find(t => t.desde <= unidades) ?? p.tramos[0];

/** Los derivados que calcula el backend: por producto (unidades, precio, próximo tramo) y de toda la canasta. */
function conDerivados(lic: LicitacionCanal): LicitacionCanal {
  const productos = (lic.productos ?? []).map(p => {
    const totalUnidades = lic.participantes.reduce((s, x) => s + (x.items ?? []).filter(i => i.productoId === p.id).reduce((a, i) => a + i.cantidad, 0), 0);
    // Como el backend: el tramo alcanzado o la mejor oferta a ese volumen; sin nada, el precio de referencia.
    const precioActual = precioDelProducto(p, totalUnidades, lic.proveedorId);
    const sig = p.tramos.find(t => t.desde > totalUnidades && t.precioUnitario < precioActual);
    return { ...p, totalUnidades, precioActual, siguienteTramo: sig ? { ...sig, faltan: sig.desde - totalUnidades } : null };
  });
  const p0 = productos[0];
  return {
    ...lic, productos,
    tramos: p0?.tramos, precioSolo: p0?.precioSolo, precioActual: p0?.precioActual, siguienteTramo: p0?.siguienteTramo,
    unidad: p0?.unidad, unidadPlural: p0?.unidadPlural,
    ...totalesDeCanasta(productos),
  };
}

const MINUTO = 60_000;
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahoraIso = () => new Date().toISOString();
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

function sembrar() {
  const negocios: Negocio[] = [
    ...PROVEEDORES.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'proveedor' as const })),
    ...COMPRADORES_FALSOS.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'comprador' as const })),
  ];
  const licitacion: LicitacionCanal = {
    id: 'L-1',
    producto: CONFIG.producto,
    proveedorId: PROVEEDOR_DEMO,
    comuna: 'Santiago',
    cierraEn: new Date(Date.now() + 8 * MINUTO).toISOString(),
    estado: 'abierta',
    precioSolo: TRAMOS[0].precioUnitario,
    tramos: TRAMOS,
    ofertas: [],
    productos: structuredClone(PRODUCTOS),
    participantes: COMPRADORES_FALSOS.map(([negocioId, nombre, comuna], i) => conCantidad({
      negocioId, nombre, comuna, cantidad: 0, en: hace((12 - i) * MINUTO),
      items: CARRITOS_SEMBRADOS[i].map(([productoId, cantidad]) => ({ productoId, cantidad })),
    })),
  };
  // Una compra que inició un comprador (sin proveedor fijo): Molinos del Sur compite con su lista y su pedido mínimo.
  const cafe = {
    id: 'cafe-molido-1-kg', nombre: 'Café molido 1 kg', unidad: 'bolsa', unidadPlural: 'bolsas', precioSolo: 0, tramos: [],
    ofertas: [{ proveedorId: 'p-molinos', productoId: 'cafe-molido-1-kg', precioUnitario: 12_500, tramos: [{ desde: 1, precioUnitario: 12_500 }, { desde: 20, precioUnitario: 11_200 }], minimo: 30, automatica: true as const, plazoDias: 1, en: hace(20 * MINUTO) }],
  };
  const solicitud: LicitacionCanal = {
    id: 'L-2', producto: cafe.nombre, unidad: cafe.unidad, unidadPlural: cafe.unidadPlural, comuna: 'Ñuñoa', cierraEn: new Date(Date.now() + 6 * 60 * MINUTO).toISOString(),
    estado: 'abierta', precioSolo: 0, tramos: [], ofertas: [], productos: [cafe],
    participantes: COMPRADORES_FALSOS.slice(0, 3).map(([negocioId, nombre, comuna], i) => conCantidad({
      negocioId, nombre, comuna, cantidad: 0, en: hace((30 - i) * MINUTO), items: [{ productoId: cafe.id, cantidad: 4 + i * 2 }],
    })),
  };
  const item = (cantidad: number, producto = CONFIG.producto) => [{ producto, cantidad, precioUnitario: PRECIOS[producto] }];
  const ordenes: OrdenCanal[] = [
    { id: 'o-101', compradorId: 'c-trigal', proveedorId: PROVEEDOR_DEMO, estado: 'enviada', creadaEn: hace(3 * MINUTO), items: item(6) },
    { id: 'o-102', compradorId: 'c-robles', proveedorId: PROVEEDOR_DEMO, estado: 'enviada', creadaEn: hace(MINUTO), items: item(3) },
    {
      id: 'o-90', compradorId: 'c-esquina', proveedorId: PROVEEDOR_DEMO, estado: 'reclamada', creadaEn: hace(40 * MINUTO), items: item(10),
      reclamo: { producto: CONFIG.producto, faltante: 2, en: hace(5 * MINUTO), estadoSii: 'recibido' },
    },
    { id: 'o-80', compradorId: 'c-napoli', proveedorId: PROVEEDOR_DEMO, estado: 'recibida', creadaEn: hace(90 * MINUTO), items: item(5) },
  ];
  return {
    negocios,
    notas: new Map(PROVEEDORES.map(([id, , , n]) => [id, n])),
    notasAnteriores: new Map<string, number>([[PROVEEDOR_DEMO, 4.6]]),
    licitaciones: [licitacion, solicitud],
    ordenes,
    documentos: [] as Documento[],
  };
}

/** El catálogo de ejemplo: el mismo historial que arma el servidor, ya listo. */
function catalogoDeEjemplo(): CatalogoProveedor {
  const ventas = historialDeEjemplo(new Date());
  return {
    estado: 'listo', origen: 'ejemplo', ...resumenDeFacturas(ventas.map(v => v.fecha)),
    productos: armarCatalogo(lineasDeEjemplo(ventas)), actualizado: ahoraIso(),
  };
}

export function crearApiFalsa(): CanalApi {
  const red = sembrar();
  const folios: Record<TipoDocumento, number> = { 33: 1200, 52: 800, 61: 300 };
  const sesiones = new Map<string, string>();
  const porTelefono = new Map<string, string>([[TELEFONO_PROVEEDOR_FALSO, PROVEEDOR_DEMO]]);
  /** A quién sale la factura de cada comprador web (datos simulados, como la consulta falsa del servidor). */
  const facturas = new Map<string, FacturaA>();
  const oyentes = new Set<(e?: EventoRed) => void>();
  let contador = 0;

  const avisar = (tipo: TipoEventoRed, datos: Record<string, unknown> = {}) => {
    const e = { tipo, datos, en: ahoraIso() };
    oyentes.forEach(o => o(e));
  };
  const despues = (ms: number, fn: () => void) => setTimeout(fn, ms);

  const emitir = (orden: OrdenCanal, tipo: TipoDocumento, monto: number, estadoSii = 'recibido') => {
    folios[tipo] += 1;
    const documento: Documento = {
      id: `d-${tipo}-${folios[tipo]}`, ordenId: orden.id, tipo, folio: folios[tipo], trackId: null, estadoSii, monto, emitidoEn: ahoraIso(),
    };
    red.documentos.push(documento);
    // El SII acepta unos segundos después, como el veredicto del SII real.
    if (tipo !== 52) despues(5000, () => { documento.estadoSii = 'aceptado'; avisar('documento.actualizado', { documento }); });
    return documento;
  };
  const facturar = (o: OrdenCanal, conGuia = true) => {
    o.estado = 'facturada';
    emitir(o, 33, totalOrden(o));
    if (conGuia) emitir(o, 52, totalOrden(o));
  };
  const cambiarNota = (proveedorId: string, delta: number) => {
    const anterior = red.notas.get(proveedorId) ?? 4.4;
    const nota = Math.min(5, Math.max(1, Math.round((anterior + delta) * 10) / 10));
    red.notas.set(proveedorId, nota);
    red.notasAnteriores.set(proveedorId, anterior);
    avisar('nota.cambiada', { proveedorId, anterior, nota });
  };
  const notaCredito = (o: OrdenCanal, sube = true) => {
    const precio = o.items[0]?.precioUnitario ?? 0;
    o.estado = 'corregida';
    const documento = emitir(o, 61, (o.reclamo?.faltante ?? 0) * precio);
    avisar('nota_credito.emitida', { orden: o, documento });
    if (sube) cambiarNota(o.proveedorId, 0.2);
  };

  // Historial sembrado del proveedor: el reclamo pendiente y la entrega conforme ya tienen su factura.
  for (const o of red.ordenes.filter(x => x.estado === 'reclamada' || x.estado === 'recibida')) {
    const estado = o.estado;
    facturar(o);
    o.estado = estado;
  }

  const quien = (token: string) => {
    const id = sesiones.get(token);
    const negocio = red.negocios.find(n => n.id === id);
    if (!negocio) throw new ErrorCanal('Tu sesión venció. Vuelve a entrar.', true);
    return negocio;
  };
  const orden = (id: string) => {
    const o = red.ordenes.find(x => x.id === id);
    if (!o) throw new ErrorCanal('No encontramos ese pedido. Puede que ya haya cambiado.');
    return o;
  };
  const exigir = (cumple: boolean, mensaje: string) => {
    if (!cumple) throw new ErrorCanal(mensaje);
  };
  const licitacion = (id: string) => {
    const l = red.licitaciones.find(x => x.id === id);
    if (!l) throw new ErrorCanal('No encontramos esa compra conjunta.');
    return l;
  };
  const ordenesDe = (lic: LicitacionCanal) => red.ordenes.filter(o => lic.ordenIds?.includes(o.id));

  /** Siembra el historial de un comprador nuevo para que vea todas las secciones con datos. */
  const sembrarComprador = (negocio: Negocio) => {
    const item = (cantidad: number, producto: string) => [{ producto, cantidad, precioUnitario: PRECIOS[producto] }];
    const porRecibir: OrdenCanal = { id: `o-${++contador}`, licitacionId: 'L-0', compradorId: negocio.id, proveedorId: PROVEEDOR_DEMO, estado: 'confirmada', creadaEn: hace(20 * MINUTO), items: item(8, CONFIG.producto) };
    const corregida: OrdenCanal = {
      id: `o-${++contador}`, compradorId: negocio.id, proveedorId: 'p-nuble', estado: 'reclamada', creadaEn: hace(26 * 60 * MINUTO), items: item(4, 'Harina 25 kg'),
      reclamo: { producto: 'Harina 25 kg', faltante: 1, en: hace(25 * 60 * MINUTO), estadoSii: 'aceptado' },
    };
    red.ordenes.push(corregida, porRecibir);
    facturar(corregida);
    notaCredito(corregida, false);
    facturar(porRecibir);
  };

  /** Guarda el carrito de un participante y avisa como el backend: participante y, si bajó, un precio_bajo por producto. */
  const cambiarCarrito = (lic: LicitacionCanal, participante: Participante, accion: 'entra' | 'cambia' | 'sale') => {
    const antes = conDerivados(lic).productos ?? [];
    lic.participantes = lic.participantes.filter(p => p.negocioId !== participante.negocioId);
    if (participante.cantidad > 0) lic.participantes.push(participante);
    const despues = conDerivados(lic);
    avisar('licitacion.participante', { licitacionId: lic.id, licitacion: despues, participante, accion });
    avisarBajas(lic, antes, despues);
  };
  /** Un `licitacion.precio_bajo` por cada producto que quedó más barato que en `antes`. */
  const avisarBajas = (lic: LicitacionCanal, antes: ProductoCompra[], despues: LicitacionCanal) => {
    for (const p of despues.productos ?? []) {
      const previo = antes.find(x => x.id === p.id);
      if (previo?.precioActual && p.precioActual && p.precioActual < previo.precioActual) {
        avisar('licitacion.precio_bajo', { licitacionId: lic.id, productoId: p.id, precioAnterior: previo.precioActual, precioNuevo: p.precioActual, totalUnidades: p.totalUnidades });
      }
    }
  };
  const abierta = (licitacionId: string) => {
    const lic = licitacion(licitacionId);
    exigir(lic.estado === 'abierta' && Date.parse(lic.cierraEn) > Date.now(), 'Esta compra conjunta ya cerró.');
    return lic;
  };

  // El público se sigue sumando: el precio baja en vivo.
  setInterval(() => {
    const lic = red.licitaciones.find(l => l.estado === 'abierta' && Date.parse(l.cierraEn) > Date.now());
    if (!lic || lic.participantes.reduce((s, p) => s + p.cantidad, 0) > 120) return;
    const nombre = DEL_PUBLICO[contador++ % DEL_PUBLICO.length];
    const negocio: Negocio = { id: `c-pub-${contador}`, nombre, comuna: COMUNAS[contador % COMUNAS.length], rol: 'comprador' };
    red.negocios.push(negocio);
    const productoId = PRODUCTOS[contador % PRODUCTOS.length].id;
    const participante = conCantidad({ negocioId: negocio.id, nombre, comuna: negocio.comuna, cantidad: 0, items: [{ productoId, cantidad: 1 + (contador % 3) }], en: ahoraIso() });
    cambiarCarrito(lic, participante, 'entra');
  }, 9000);

  // La lista de productos del proveedor de prueba, como la guarda server/catalogo (mismas reglas, en memoria).
  const manuales: ProductoCatalogo[] = [];
  const validado = (escrito: ProductoEscrito, otros: readonly ProductoCatalogo[], clave?: string) => {
    const problema = errorDeProductoEscrito(escrito, otros);
    exigir(!problema, `${problema}.`);
    return productoManual(escrito, ahoraIso().slice(0, 10), clave);
  };

  /** Como server/catalogo/ofertas.ts: la lista del proveedor de prueba entra sola donde piden lo mismo. */
  const ofertarConLista = () => {
    for (const l of red.licitaciones.filter(x => x.estado === 'abierta' && !x.proveedorId)) {
      for (const p of (l.productos ?? []).filter(x => !x.proveedorId)) {
        const suyo = manuales.find(m => mismoProducto(m, p));
        const actual = p.ofertas?.find(o => o.proveedorId === PROVEEDOR_DEMO);
        if (!suyo || (actual && !actual.automatica)) continue;
        p.ofertas = [...(p.ofertas ?? []).filter(o => o.proveedorId !== PROVEEDOR_DEMO),
          { proveedorId: PROVEEDOR_DEMO, productoId: p.id, precioUnitario: suyo.tramos[0].precioUnitario, tramos: suyo.tramos, ...(suyo.minimo ? { minimo: suyo.minimo } : {}), automatica: true, plazoDias: 1, en: ahoraIso() }];
      }
    }
  };

  const foto = (): FotoRed => structuredClone({
    negocios: red.negocios,
    ordenes: red.ordenes,
    documentos: red.documentos,
    notas: [...red.notas].map(([proveedorId, nota]) => ({ proveedorId, nota })),
    licitaciones: red.licitaciones.map(conDerivados),
  });

  return {
    ...crearConexionSiiFalsa(token => { quien(token); }),
    modo: 'falso',
    config: async () => CONFIG,
    estado: async () => foto(),

    async pedirCodigo(telefono) {
      await espera(300);
      exigir(!!telefonoParaWhatsapp(telefono), 'Escribe tu número de WhatsApp, por ejemplo 9 1234 5678.');
      return { retenido: false };
    },

    async entrar(texto, codigo, datos) {
      await espera(300);
      const telefono = telefonoParaWhatsapp(texto) ?? '';
      if (!/^\d{6}$/.test(codigo)) throw new ErrorCanal('El código no coincide. Revisa el último que te llegó.');
      let negocio = red.negocios.find(n => n.id === porTelefono.get(telefono));
      if (!negocio) {
        if (!datos) return { registro: true };
        exigir(!!datos.nombre.trim(), 'Escribe el nombre de tu negocio.');
        exigir(!!validarRut(datos.rut), RUT_INVALIDO);
        negocio = { id: `c-web-${++contador}`, nombre: datos.nombre.trim(), comuna: datos.comuna.trim() || 'Santiago', rol: 'comprador', ...(datos.rubro ? { rubro: datos.rubro } : {}) };
        red.negocios.push(negocio);
        sembrarComprador(negocio);
        porTelefono.set(telefono, negocio.id);
        facturas.set(negocio.id, {
          rut: formatearRutAlEscribir(datos.rut), razonSocial: 'Contribuyente de prueba', giro: 'Comercio al por menor', comuna: 'Santiago', simulado: true,
        });
      }
      const token = `falso-${negocio.id}-${++contador}`;
      sesiones.set(token, negocio.id);
      return { token, negocio };
    },

    async cerrarSesion(token) {
      sesiones.delete(token);
    },

    async yo(token) {
      const negocio = quien(token);
      const ordenes = red.ordenes.filter(o => o.compradorId === negocio.id);
      const participaciones: Participacion[] = red.licitaciones.flatMap(l =>
        l.participantes.filter(p => p.negocioId === negocio.id).map(p => ({ licitacionId: l.id, cantidad: p.cantidad, items: p.items ?? [] })));
      return structuredClone({
        negocio,
        facturaA: facturas.get(negocio.id) ?? null,
        ordenes,
        documentos: red.documentos.filter(d => ordenes.some(o => o.id === d.ordenId)),
        participaciones,
      });
    },

    async unirse(token, licitacionId, cantidad) {
      await espera(300);
      const negocio = quien(token);
      const lic = abierta(licitacionId);
      exigir(Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= CANTIDAD_MAXIMA, 'Escribe una cantidad válida.');
      const previo = lic.participantes.find(p => p.negocioId === negocio.id);
      const items = [...(previo?.items ?? []).filter(i => i.productoId !== PRODUCTOS[0].id), { productoId: PRODUCTOS[0].id, cantidad }];
      cambiarCarrito(lic, conCantidad({ negocioId: negocio.id, nombre: negocio.nombre, comuna: negocio.comuna, cantidad: 0, items, en: previo?.en ?? ahoraIso() }), previo ? 'cambia' : 'entra');
    },

    async carrito(token, licitacionId, items) {
      await espera(250);
      const negocio = quien(token);
      const lic = abierta(licitacionId);
      // Cada compra tiene su canasta: la de la sala o el producto de una solicitud.
      const orden = (lic.productos ?? PRODUCTOS).map(p => p.id);
      exigir(items.every(i => orden.includes(i.productoId) && Number.isInteger(i.cantidad) && i.cantidad >= 0 && i.cantidad <= CANTIDAD_MAXIMA), 'Escribe una cantidad válida para cada producto.');
      const previo = lic.participantes.find(p => p.negocioId === negocio.id);
      const limpios = items.filter(i => i.cantidad > 0).sort((a, b) => orden.indexOf(a.productoId) - orden.indexOf(b.productoId));
      const participante = conCantidad({ negocioId: negocio.id, nombre: negocio.nombre, comuna: negocio.comuna, cantidad: 0, items: limpios, en: previo?.en ?? ahoraIso() });
      cambiarCarrito(lic, participante, !limpios.length ? 'sale' : previo ? 'cambia' : 'entra');
    },

    async buscarProductos(q) {
      const deListas = manuales.map(p => ({ nombre: p.nombre, unidad: p.unidad, precioBase: p.tramos[0].precioUnitario, ...(p.minimo ? { minimo: p.minimo } : {}) }));
      const conocidos = [...deListas, ...red.licitaciones.flatMap(l => l.productos ?? [])].flatMap(p => (esUnidad(p.unidad) ? [{ ...p, unidad: p.unidad }] : []));
      return sugerirProductos(q, conocidos);
    },

    async cerrarSolicitud(token, licitacionId) {
      await espera(500);
      const lic = abierta(licitacionId);
      exigir(lic.iniciadaPor === quien(token).id, 'Solo quien inició la compra en grupo la puede cerrar antes.');
      const listo = (lic.productos ?? []).every(p => puedeCerrarAntes(p.ofertas, conDerivados(lic).productos!.find(x => x.id === p.id)!.totalUnidades ?? 0));
      exigir(listo, 'Todavía no se puede cerrar: falta una oferta o llegar al pedido mínimo del proveedor.');
      lic.estado = 'cerrada';
      lic.cierraEn = ahoraIso();
      avisar('licitacion.cerrada', { licitacion: lic });
    },

    async abrirSolicitud(token, { producto, unidad, cantidad, precioHoy, minutos }) {
      await espera(400);
      quien(token);
      const nombre = producto.replace(/\s+/g, ' ').trim();
      exigir(nombre.length >= 3, 'Escribe qué producto quieres comprar.');
      exigir(Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= CANTIDAD_MAXIMA, 'Escribe una cantidad válida.');
      exigir(!red.licitaciones.some(l => l.estado === 'abierta' && l.productos?.some(p => sinTildes(p.nombre) === sinTildes(nombre))), `Ya hay una compra en grupo abierta de "${nombre}": súmate a ella.`);
      const u = unidad.trim().toLowerCase() || 'unidad';
      const p = { id: sinTildes(nombre).replace(/[^a-z0-9]+/g, '-'), nombre, unidad: u, unidadPlural: pluralDe(u), precioSolo: precioHoy ?? 0, tramos: [], ofertas: [] };
      const lic = {
        id: `L-${red.licitaciones.length + 1}`, productos: [p], producto: nombre, unidad: u, unidadPlural: p.unidadPlural, comuna: quien(token).comuna,
        cierraEn: new Date(Date.now() + minutos * 60_000).toISOString(), precioSolo: p.precioSolo, tramos: [], participantes: [], ofertas: [], estado: 'abierta' as const,
        iniciadaPor: quien(token).id,
      };
      red.licitaciones.push(lic);
      ofertarConLista();
      avisar('licitacion.abierta', { licitacionId: lic.id });
      await this.carrito(token, lic.id, [{ productoId: p.id, cantidad }]);
      return { licitacionId: lic.id, productoId: p.id };
    },

    async salir(token, licitacionId) {
      await espera(250);
      const negocio = quien(token);
      const lic = licitacion(licitacionId);
      const previo = lic.participantes.find(p => p.negocioId === negocio.id);
      if (previo) cambiarCarrito(lic, { ...previo, items: [], cantidad: 0 }, 'sale');
    },

    async yoProveedor(token) {
      const proveedor = quien(token);
      const ordenes = red.ordenes.filter(o => o.proveedorId === proveedor.id);
      return structuredClone({
        proveedor,
        ordenes,
        documentos: red.documentos.filter(d => ordenes.some(o => o.id === d.ordenId)),
        nota: red.notas.get(proveedor.id) ?? null,
        notaAnterior: red.notasAnteriores.get(proveedor.id),
      });
    },

    async cerrar(token, licitacionId) {
      await espera(400);
      quien(token);
      const lic = licitacion(licitacionId);
      exigir(lic.estado === 'abierta', 'Esta compra conjunta ya estaba cerrada.');
      lic.estado = 'cerrada';
      const productos = conDerivados(lic).productos ?? [];
      // Como el backend: una orden por participante con todo su carrito, enviada, y sus ids en la licitación.
      const nuevas: OrdenCanal[] = lic.participantes.map(p => ({
        id: `o-${++contador}`, compradorId: p.negocioId ?? '', proveedorId: PROVEEDOR_DEMO, estado: 'enviada',
        creadaEn: ahoraIso(),
        items: (p.items ?? []).map(i => {
          const producto = productos.find(x => x.id === i.productoId)!;
          return { producto: producto.nombre, cantidad: i.cantidad, precioUnitario: producto.precioActual ?? producto.precioSolo };
        }),
      }));
      red.ordenes.push(...nuevas);
      lic.ordenIds = nuevas.map(o => o.id);
      avisar('licitacion.cerrada', { licitacion: lic });
    },

    async facturar(token, licitacionId) {
      await espera(900);
      quien(token);
      const lic = licitacion(licitacionId);
      exigir(lic.estado === 'cerrada' && ordenesDe(lic).some(o => o.estado === 'enviada'), 'Esta compra conjunta no está lista para facturar.');
      ordenesDe(lic).forEach(o => facturar(o, false));
      avisar('licitacion.facturada' as TipoEventoRed, { licitacion: lic });
    },

    async ofertar(token, licitacionId, productoId, tramos, minimo) {
      await espera(400);
      const proveedor = quien(token);
      const producto = abierta(licitacionId).productos?.find(p => p.id === productoId);
      exigir(!!producto, 'Ese producto no está en la compra.');
      const nuevos = ordenarTramos(tramos);
      const error = errorDeTramos(nuevos);
      exigir(!error, `${error}.`);
      producto!.ofertas = [...(producto!.ofertas ?? []).filter(o => o.proveedorId !== proveedor.id),
        { proveedorId: proveedor.id, productoId, precioUnitario: nuevos[0].precioUnitario, tramos: nuevos, ...(minimo ? { minimo } : {}), plazoDias: 1, en: ahoraIso() }];
      avisar('licitacion.oferta', { licitacionId });
    },

    async fijarTramos(token, licitacionId, productoId, tramos) {
      await espera(400);
      const proveedor = quien(token);
      const lic = abierta(licitacionId);
      const antes = conDerivados(lic).productos ?? [];
      const producto = lic.productos?.find(p => p.id === productoId);
      exigir(!!producto && duenoDeTramos(producto, lic) === proveedor.id, 'Solo quien vende ese producto fija sus tramos.');
      const actual = antes.find(p => p.id === productoId)!;
      const unidades = actual.totalUnidades ?? 0;
      const nuevos = ordenarTramos(tramos);
      const error = errorDeTramos(nuevos, { unidades, precio: tramoEn(actual, unidades).precioUnitario });
      exigir(!error, `${error}.`);
      producto!.tramos = nuevos;
      const despues = conDerivados(lic);
      avisar('licitacion.producto', { licitacionId: lic.id, licitacion: despues, producto: despues.productos!.find(p => p.id === productoId), proveedorNombre: proveedor.nombre, cambio: 'tramos' });
      avisarBajas(lic, antes, despues);
    },

    // Como el servidor sin OSRM ni Nominatim: cada negocio en su comuna y el orden en línea recta.
    async rutaReparto(token) {
      await espera(300);
      const proveedor = quien(token);
      const donde = (id: string) => {
        const n = red.negocios.find(x => x.id === id);
        return n ? { nombre: n.nombre, comuna: n.comuna, punto: ubicarEnComuna(n.id, n.comuna), aproximado: true } : null;
      };
      const ordenes = red.ordenes.filter(o => o.proveedorId === proveedor.id);
      const bodega = { punto: centroDeComuna(proveedor.comuna) ?? MUT, aproximada: true };
      return armarRuta(bodega, paradasDeOrdenes(ordenes, red.documentos, donde), null);
    },

    async emitirGuias(token) {
      await espera(900);
      const proveedor = quien(token);
      const sinGuia = red.ordenes.filter(o => o.proveedorId === proveedor.id && POR_ENTREGAR.includes(o.estado)
        && !red.documentos.some(d => d.ordenId === o.id && d.tipo === 52));
      exigir(sinGuia.length > 0, 'Todos tus pedidos por entregar ya tienen su guía.');
      for (const o of sinGuia) avisar('documento.emitido', { documento: emitir(o, 52, totalOrden(o)) });
    },

    async confirmarOrden(token, ordenId) {
      await espera(600);
      const proveedor = quien(token);
      const o = orden(ordenId);
      exigir(o.proveedorId === proveedor.id && o.estado === 'enviada', 'Este pedido ya fue confirmado.');
      facturar(o);
      avisar('orden.confirmada', { orden: o });
    },

    async notaCredito(token, ordenId) {
      await espera(600);
      const proveedor = quien(token);
      const o = orden(ordenId);
      exigir(o.proveedorId === proveedor.id && o.estado === 'reclamada', 'Este reclamo ya tiene nota de crédito.');
      notaCredito(o);
    },

    async catalogo(token) {
      await espera(400);
      quien(token);
      const ejemplo = catalogoDeEjemplo();
      return { ...ejemplo, productos: juntarCatalogo(manuales, ejemplo.productos) };
    },

    async agregarProducto(token, escrito) {
      await espera(300);
      quien(token);
      manuales.unshift(validado(escrito, manuales));
      ofertarConLista();
      avisar('catalogo.actualizado', {});
    },

    async editarProducto(token, clave, escrito) {
      await espera(300);
      quien(token);
      const i = manuales.findIndex(x => x.clave === clave);
      exigir(i >= 0, 'Ese producto no está en tu lista.');
      manuales[i] = validado(escrito, manuales.filter(x => x.clave !== clave), clave);
      ofertarConLista();
      avisar('catalogo.actualizado', {});
    },

    async quitarProducto(token, clave) {
      await espera(300);
      quien(token);
      exigir(manuales.some(x => x.clave === clave), 'Ese producto no está en tu lista.');
      manuales.splice(manuales.findIndex(x => x.clave === clave), 1);
      avisar('catalogo.actualizado', {});
    },

    async sumarDelCatalogo(token, clave) {
      await espera(500);
      const proveedor = quien(token);
      const p = [...manuales, ...catalogoDeEjemplo().productos].find(x => x.clave === clave);
      const lic = red.licitaciones.find(l => l.estado === 'abierta');
      if (!p || !lic?.productos) throw new ErrorCanal('No hay una compra conjunta abierta.');
      exigir(!lic.productos.some(x => x.nombre === p.nombre), `"${p.nombre}" ya está en la canasta.`);
      lic.productos.push({
        id: clave, nombre: p.nombre, unidad: p.unidad, unidadPlural: pluralDe(p.unidad), precioSolo: p.tramos[0].precioUnitario,
        tramos: p.tramos, ofertas: [], proveedorId: proveedor.id,
      });
      avisar('licitacion.producto', { licitacionId: lic.id });
    },

    escuchar(alCambiar) {
      oyentes.add(alCambiar);
      return () => { oyentes.delete(alCambiar); };
    },
  };
}
