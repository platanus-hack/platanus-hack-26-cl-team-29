// Red falsa para desarrollar y ensayar sin backend: una foto sembrada y un guion que emite
// eventos con el mismo formato que `red:evento`. Todos los nombres son ficticios.
// Se usa solo mientras GET /api/red/estado no responde.
//
// La sala: unos 45 negocios arman su carrito con la canasta (uno a cuatro productos) en unos 60 s, algunos
// cambian su pedido o salen, cada producto baja por sus propios tramos y tiene su propia competencia de
// proveedores. La compra cierra, el proveedor dice que sí, salen las facturas (una línea por producto) y el
// SII las acepta. Después de un rato vuelve a empezar.

import type { ConfigRed, Documento, EstadoRed, EventoRed, Licitacion, Negocio, Oferta, OrdenCompra, Participante, TipoEvento } from './tipos.ts';
import { CANASTA_DEMO, PISO_ROLLOS_DEMO, pisoPorDefecto } from '../../../shared/canasta-demo.ts';
import { precioDelProducto, siguienteTramo, totalesDeCanasta, unidadesDe } from '../../../shared/precios.ts';

export interface RedFalsa {
  detener(): void;
  unirse(licitacionId: string, datos: { nombre: string; comuna: string; cantidad: number; productoId?: string }): void;
  reiniciar(): void;
  cerrar(licitacionId: string): void;
  confirmar(licitacionId: string): void;
}

/** La canasta por defecto. `piso`: lo mínimo que ofrece el proveedor de la sala por ese producto. */
const CANASTA = CANASTA_DEMO.map(p => ({ ...structuredClone(p), piso: p.id === 'rollos' ? PISO_ROLLOS_DEMO : pisoPorDefecto(p.tramos, p.precioSolo) }));
const PRODUCTO = CANASTA[0].nombre;
const PROVEEDOR_SALA = 'p-austral';
/** Proveedores rivales (agentes) y cuánto sobre el piso del de la sala pueden bajar, en la escala de los rollos. */
const RIVALES: Array<[string, number]> = [['p-andes', 400], ['p-molinos', 700], ['p-sur', 1100]];
const OFERTA_MS = 2200;

/** Número de relleno, claramente ficticio. */
export const CONFIG_FALSA: ConfigRed = { whatsappNumero: '56900000000', producto: PRODUCTO, unidad: CANASTA[0].unidad, unidadPlural: CANASTA[0].unidadPlural };

const PROVEEDORES: Array<[string, string, string, number]> = [
  ['p-austral', 'Papelera Austral', 'Santiago', 4.7],
  ['p-andes', 'Insumos Andes', 'Las Condes', 4.5],
  ['p-molinos', 'Rollos del Sur', 'Maipú', 4.6],
  ['p-sur', 'Distribuidora Sur', 'Recoleta', 4.4],
  ['p-centro', 'Comercial Centro', 'La Reina', 3.9],
];

/** Compradores ficticios (id, nombre, comuna), también los del canal web falso. La pantalla siembra los cuatro primeros. */
export const COMPRADORES_FALSOS: Array<[string, string, string]> = [
  ['c-esquina', 'Almacén La Esquina', 'Ñuñoa'],
  ['c-trigal', 'Panadería El Trigal', 'La Reina'],
  ['c-robles', 'Restaurante Los Robles', 'Providencia'],
  ['c-napoli', 'Pizzería Napoli', 'Macul'],
  ['c-aromos', 'Minimarket Los Aromos', 'Macul'],
  ['c-vecina', 'Botillería La Vecina', 'Peñalolén'],
];
const COMPRADORES = COMPRADORES_FALSOS.slice(0, 4);

const TIPOS = ['Almacén', 'Minimarket', 'Panadería', 'Botillería', 'Cafetería', 'Fuente de soda', 'Pizzería', 'Amasandería', 'Ferretería', 'Librería', 'Verdulería', 'Farmacia'];
const NOMBRES = ['Don Lucho', 'La Vecina', 'El Sol', 'Santa Rosa', 'Los Aromos', 'La Pasada', 'Doña Carmen', 'El Roble', 'Las Palmas', 'San José', 'El Puente', 'La Plaza', 'Los Pinos', 'Mi Barrio', 'El Rincón', 'La Estrella', 'Los Andes', 'El Faro', 'La Casona', 'Buen Pan', 'El Paso', 'La Cruz', 'Las Rosas', 'El Molino', 'La Fuente', 'El Cerro', 'Los Olivos'];
const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'San Joaquín', 'La Florida', 'Santiago', 'Maipú', 'Recoleta'];
/** Cuántas unidades de un producto pide cada negocio: casi siempre pocas, a veces más (de 1 a 20). */
const CANTIDADES = [1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8, 12];
/** Cuántos productos de la canasta lleva un carrito: casi siempre uno o dos. */
const PRODUCTOS_POR_CARRITO = [1, 1, 1, 2, 2, 2, 3, 4];

const SEGUNDO = 1000;
const LLEGADA_MS = 1500;
const DURACION_SALA_MS = 62 * SEGUNDO;
const ESPERA_SI_MS = 5 * SEGUNDO;
const FACTURA_MS = 280;
const ACEPTADA_MS = 180;
const FINAL_MS = 25 * SEGUNDO;

const aleatorio = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahoraIso = () => new Date().toISOString();

function sembrarNegocios(): Negocio[] {
  const proveedores = PROVEEDORES.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'proveedor' as const }));
  const compradores = COMPRADORES.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'comprador' as const }));
  return [...proveedores, ...compradores];
}

/** Nombres sin repetir para los negocios que llegan: tipo y nombre barajados. */
function* nombresDeLaSala(): Generator<[string, string]> {
  const combos = TIPOS.flatMap(t => NOMBRES.map(n => `${t} ${n}`)).sort(() => Math.random() - 0.5);
  for (let i = 0; ; i++) yield [combos[i % combos.length], COMUNAS[Math.floor(Math.random() * COMUNAS.length)]];
}

type Item = { productoId: string; cantidad: number };

/** Un carrito al azar: uno a cuatro productos distintos de la canasta. */
function carritoAleatorio(): Item[] {
  const productos = [...CANASTA].sort(() => Math.random() - 0.5).slice(0, aleatorio(PRODUCTOS_POR_CARRITO));
  return CANASTA.filter(p => productos.includes(p)).map(p => ({ productoId: p.id, cantidad: aleatorio(CANTIDADES) }));
}

/**
 * Recalcula lo que deriva el backend (server/red/compra.ts): por producto, el precio del tramo alcanzado o,
 * si es menor, la oferta del proveedor de la sala; los campos de un solo producto son los del primero.
 */
function conDerivados(lic: Licitacion): Licitacion {
  const productos = (lic.productos ?? []).map(p => {
    const total = unidadesDe(lic, p.id);
    return { ...p, totalUnidades: total, precioActual: precioDelProducto(p, total, lic.proveedorId), siguienteTramo: siguienteTramo(p.tramos, total) };
  });
  const primero = productos[0];
  return {
    ...lic,
    productos,
    producto: primero.nombre, unidad: primero.unidad, unidadPlural: primero.unidadPlural, precioSolo: primero.precioSolo,
    tramos: primero.tramos, ofertas: primero.ofertas ?? [], precioActual: primero.precioActual, siguienteTramo: primero.siguienteTramo,
    totalNegocios: lic.participantes.filter(p => p.cantidad > 0).length,
    ...totalesDeCanasta(productos),
  };
}

const conCarrito = (p: Participante, items: Item[]): Participante => ({ ...p, items, cantidad: items.reduce((s, i) => s + i.cantidad, 0) });

function sembrarLicitacion(id: string): Licitacion {
  const carritos: Item[][] = [
    [{ productoId: 'rollos', cantidad: 2 }, { productoId: 'bolsas', cantidad: 1 }],
    [{ productoId: 'etiquetas', cantidad: 3 }],
    [{ productoId: 'rollos', cantidad: 1 }, { productoId: 'guantes', cantidad: 2 }],
    [{ productoId: 'bolsas', cantidad: 2 }],
  ];
  const participantes = COMPRADORES.map(([negocioId], i) => conCarrito({ negocioId, cantidad: 0, en: hace((4 - i) * 5 * SEGUNDO) }, carritos[i]));
  return conDerivados({
    id,
    producto: PRODUCTO,
    comuna: 'Ñuñoa y alrededores',
    cierraEn: new Date(Date.now() + DURACION_SALA_MS).toISOString(),
    estado: 'abierta',
    proveedorId: PROVEEDOR_SALA,
    productos: CANASTA.map(({ piso: _piso, ...p }) => ({ ...p, ofertas: [] })),
    participantes,
    ofertas: [],
  });
}

function sembrarEstado(): EstadoRed {
  const documentos = Array.from({ length: 120 }, (_, i) => ({
    id: `d-${i}`, ordenId: `o-hist-${i}`, tipo: 33 as const, folio: 1000 + i, trackId: null, estadoSii: 'aceptado',
  }));
  return {
    negocios: sembrarNegocios(),
    ordenes: [],
    documentos,
    notas: PROVEEDORES.map(([proveedorId, , , nota]) => ({ proveedorId, nota })),
    licitaciones: [sembrarLicitacion('l-1')],
  };
}

/** Un paso del guion: cambia la foto y devuelve el evento que lo anuncia. */
type Paso = (e: EstadoRed) => Array<[TipoEvento, Record<string, unknown>]>;

/** Ciclo de una orden suelta para la pantalla /red (con o sin reclamo). */
function guionDeOrden(conReclamo: boolean, n: number): Paso[] {
  const ordenId = `o-${n}`;
  const compradorId = conReclamo ? 'c-esquina' : 'c-trigal';
  const folio = 2000 + n * 3;
  const orden = (e: EstadoRed) => e.ordenes.find(o => o.id === ordenId)!;
  const estadoOrden = (e: EstadoRed, estado: OrdenCompra['estado']) => {
    e.ordenes = e.ordenes.map(o => (o.id === ordenId ? { ...o, estado } : o));
  };
  const emitir = (e: EstadoRed, tipo: 33 | 52 | 61, f: number) => {
    const documento = { id: `d-${ordenId}-${tipo}`, ordenId, tipo, folio: f, trackId: null, estadoSii: 'recibido', monto: tipo === 61 ? 59_800 : 119_600, emitidoEn: ahoraIso() };
    e.documentos = [...e.documentos, documento];
    return ['documento.emitido', { documento }] as [TipoEvento, Record<string, unknown>];
  };
  const cambiarNota = (e: EstadoRed, nueva: number): [TipoEvento, Record<string, unknown>] => {
    const anterior = e.notas.find(x => x.proveedorId === 'p-molinos')!.nota;
    e.notas = e.notas.map(x => (x.proveedorId === 'p-molinos' ? { ...x, nota: nueva } : x));
    return ['nota.cambiada', { proveedorId: 'p-molinos', anterior, nota: nueva }];
  };

  const inicio: Paso[] = [
    e => {
      e.ordenes = [...e.ordenes, {
        id: ordenId, compradorId, proveedorId: 'p-molinos', estado: 'enviada', creadaEn: ahoraIso(),
        items: [{ producto: PRODUCTO, cantidad: 4, precioUnitario: 29_900 }],
      }];
      return [['orden.creada', { orden: orden(e) }]];
    },
    e => { estadoOrden(e, 'confirmada'); return [['orden.confirmada', { orden: orden(e) }]]; },
    e => { estadoOrden(e, 'facturada'); return [emitir(e, 33, folio), emitir(e, 52, folio + 1)]; },
    e => {
      e.documentos = e.documentos.map(d => (d.ordenId === ordenId && d.tipo === 33 ? { ...d, estadoSii: 'aceptado' } : d));
      return [['documento.actualizado', { documento: e.documentos.find(d => d.ordenId === ordenId && d.tipo === 33) }]];
    },
  ];
  if (!conReclamo) {
    return [...inicio,
      e => { estadoOrden(e, 'recibida'); return [['recepcion.registrada', { orden: orden(e), conforme: true }]]; },
      e => [cambiarNota(e, 4.6)],
    ];
  }
  return [...inicio,
    e => {
      estadoOrden(e, 'reclamada');
      e.ordenes = e.ordenes.map(o => (o.id === ordenId ? { ...o, reclamo: { producto: PRODUCTO, faltante: 2, en: ahoraIso(), estadoSii: 'simulado' } } : o));
      return [['recepcion.registrada', { orden: orden(e), conforme: false, faltante: 2 }]];
    },
    e => [['reclamo.registrado', { orden: orden(e), reclamo: orden(e).reclamo, motivo: 'falta parcial' }]],
    e => [cambiarNota(e, 4.2)],
    e => {
      estadoOrden(e, 'corregida');
      const [, { documento }] = emitir(e, 61, folio + 2);
      return [['nota_credito.emitida', { orden: orden(e), documento }]];
    },
    e => [cambiarNota(e, 4.4)],
  ];
}

export function iniciarRedFalsa(alCambiar: (estado: EstadoRed, evento?: EventoRed) => void): RedFalsa {
  let estado = sembrarEstado();
  let vuelta = 0;
  let guion: Paso[] = [];
  let numeroLicitacion = 1;
  let folio = 5001;
  let nombres = nombresDeLaSala();
  /** Licitaciones que ya recibieron el sí del proveedor (para no facturar dos veces). */
  const confirmadas = new Set<string>();
  let pendientes: Array<ReturnType<typeof setTimeout>> = [];
  const despues = (ms: number, f: () => void) => pendientes.push(setTimeout(f, ms));

  const publicar = (paso: Paso) => {
    const siguiente = { ...estado };
    const eventos = paso(siguiente);
    estado = siguiente;
    if (!eventos.length) alCambiar(estado);
    for (const [tipo, datos] of eventos) alCambiar(estado, { tipo, datos, en: ahoraIso() });
  };

  const licitacion = (e: EstadoRed, id: string) => e.licitaciones.find(l => l.id === id);
  const modificarLicitacion = (e: EstadoRed, id: string, cambio: (l: Licitacion) => Licitacion) => {
    e.licitaciones = e.licitaciones.map(l => (l.id === id ? cambio(l) : l));
  };

  type Evento = [TipoEvento, Record<string, unknown>];

  /** Un `licitacion.precio_bajo` por cada producto cuyo precio bajó, con las unidades de ese producto. */
  const bajadas = (antes: Licitacion, despues: Licitacion): Evento[] =>
    (despues.productos ?? []).flatMap(p => {
      const previo = antes.productos?.find(x => x.id === p.id)?.precioActual;
      return previo !== undefined && p.precioActual !== undefined && p.precioActual < previo
        ? [['licitacion.precio_bajo', { licitacionId: despues.id, productoId: p.id, precioAnterior: previo, precioNuevo: p.precioActual, totalUnidades: p.totalUnidades }] as Evento]
        : [];
    });

  /** Reemplaza el carrito de un participante, como `actualizarCarrito`: vacío = sale. Anuncia el cambio y las bajadas. */
  const cambiarCarrito = (id: string, negocioId: string, items: Item[], datos?: { nombre: string; comuna: string }): Paso => e => {
    const lic = licitacion(e, id);
    if (!lic || lic.estado !== 'abierta') return [];
    const previo = lic.participantes.find(p => p.negocioId === negocioId);
    const limpios = items.filter(i => i.cantidad > 0);
    const accion = !previo ? 'entra' : limpios.length ? 'cambia' : 'sale';
    if (!previo && !limpios.length) return [];
    const participante = conCarrito(previo ?? { negocioId, nombre: datos?.nombre, comuna: datos?.comuna, cantidad: 0, en: ahoraIso() }, limpios);
    modificarLicitacion(e, id, l => conDerivados({
      ...l,
      participantes: accion === 'sale' ? l.participantes.filter(p => p.negocioId !== negocioId)
        : previo ? l.participantes.map(p => (p.negocioId === negocioId ? participante : p)) : [...l.participantes, participante],
    }));
    const nueva = licitacion(e, id)!;
    return [['licitacion.participante', { licitacionId: id, licitacion: nueva, participante, accion }], ...bajadas(lic, nueva)];
  };

  /** Un negocio nuevo (como lo registraría el backend) se suma con su carrito. */
  const sumar = (id: string, datos: { nombre: string; comuna: string }, items: Item[]): Paso => e => {
    const negocio: Negocio = { id: `c-sala-${e.negocios.length}`, nombre: datos.nombre, comuna: datos.comuna, rol: 'comprador' };
    const pasos = cambiarCarrito(id, negocio.id, items, datos)(e);
    if (pasos.length) e.negocios = [...e.negocios, negocio];
    return pasos;
  };

  /** Alguien que ya estaba cambia su pedido: agrega un producto, cambia una cantidad o, a veces, sale. */
  const editarAlguno = (id: string): Paso => e => {
    const lic = licitacion(e, id);
    const quienes = (lic?.participantes ?? []).filter(p => p.negocioId?.startsWith('c-sala-'));
    if (!lic || quienes.length < 8) return [];
    const p = aleatorio(quienes);
    const items = [...(p.items ?? [])];
    if (Math.random() < 0.2) return cambiarCarrito(id, p.negocioId!, [])(e);
    const producto = aleatorio(CANASTA);
    const actual = items.find(i => i.productoId === producto.id);
    const cantidad = Math.min(20, (actual?.cantidad ?? 0) + aleatorio([1, 2, 3, 5]));
    const nuevos = CANASTA.flatMap(x => (x.id === producto.id ? [{ productoId: x.id, cantidad }] : items.filter(i => i.productoId === x.id)));
    return cambiarCarrito(id, p.negocioId!, nuevos)(e);
  };

  /**
   * Competencia por producto, como server/red/competencia.ts: en un producto que ya cruzó un tramo, un rival
   * baja el precio y el proveedor de la sala responde $100 menos (nunca bajo su piso). Gana siempre el de la sala.
   */
  const ofertar = (id: string): Paso => e => {
    const lic = licitacion(e, id);
    if (!lic || lic.estado !== 'abierta') return [];
    const candidatos = (lic.productos ?? []).filter(p => (p.totalUnidades ?? 0) >= 10);
    if (!candidatos.length) return [];
    const producto = aleatorio(candidatos);
    const base = CANASTA.find(p => p.id === producto.id)!;
    const ofertas = producto.ofertas ?? [];
    const mejorRival = Math.min(...ofertas.filter(o => o.proveedorId !== PROVEEDOR_SALA).map(o => o.precioUnitario));
    const propia = ofertas.find(o => o.proveedorId === PROVEEDOR_SALA)?.precioUnitario ?? Infinity;
    const precio = producto.precioActual ?? base.precioSolo;
    const redondear = (n: number) => Math.round(n / 10) * 10;
    let proveedorId: string;
    let precioUnitario: number;
    if (Number.isFinite(mejorRival) && mejorRival <= Math.min(propia, precio)) {
      proveedorId = PROVEEDOR_SALA;
      precioUnitario = Math.max(base.piso, mejorRival - 100);
    } else {
      const [rival, sobrePiso] = aleatorio(RIVALES);
      proveedorId = rival;
      const paso = redondear(precio * aleatorio([0.01, 0.015, 0.02]));
      precioUnitario = Math.max(base.piso + redondear((sobrePiso * base.piso) / CANASTA[0].piso), Math.min(precio, propia) - paso);
    }
    if (precioUnitario >= Math.min(precio, propia)) return [];
    const nota = e.notas.find(n => n.proveedorId === proveedorId)?.nota;
    const proveedorNombre = e.negocios.find(n => n.id === proveedorId)?.nombre;
    const oferta: Oferta = { proveedorId, productoId: producto.id, proveedorNombre, precioUnitario, plazoDias: 1, nota, en: ahoraIso() };
    // Como el backend: cada proveedor tiene una sola oferta vigente por producto, la nueva reemplaza a la anterior.
    modificarLicitacion(e, id, l => conDerivados({
      ...l,
      productos: l.productos!.map(p => (p.id === producto.id ? { ...p, ofertas: [...(p.ofertas ?? []).filter(x => x.proveedorId !== proveedorId), oferta] } : p)),
    }));
    const nueva = licitacion(e, id)!;
    const delProducto = nueva.productos!.find(p => p.id === producto.id)!;
    const mejor = Math.min(...(delProducto.ofertas ?? []).map(o => o.precioUnitario)) === precioUnitario && precioUnitario <= (delProducto.precioActual ?? Infinity);
    return [['licitacion.oferta', { licitacionId: id, productoId: producto.id, licitacion: nueva, oferta, nota, mejor }], ...bajadas(lic, nueva)];
  };

  const cerrar = (id: string) => {
    publicar(e => {
      const lic = licitacion(e, id);
      if (!lic || lic.estado !== 'abierta') return [];
      const propia = lic.productos?.[0]?.ofertas?.find(o => o.proveedorId === PROVEEDOR_SALA);
      const ganadora = propia ? { ...propia, nota: propia.nota ?? 4.5, precioAjustado: propia.precioUnitario } : undefined;
      modificarLicitacion(e, id, l => ({ ...l, estado: 'cerrada', ganadora, cierraEn: l.cierraEn > ahoraIso() ? ahoraIso() : l.cierraEn }));
      return [['licitacion.cerrada', { licitacion: licitacion(e, id), ordenes: [] }]];
    });
    despues(ESPERA_SI_MS, () => confirmar(id));
  };

  /** El proveedor dijo que sí: una orden por negocio con una línea por producto, las facturas una por una y el SII las acepta. */
  const confirmar = (id: string) => {
    const lic = licitacion(estado, id);
    if (!lic || lic.estado === 'abierta' || confirmadas.has(id)) return;
    confirmadas.add(id);
    const productos = lic.productos ?? [];
    const ordenes: OrdenCompra[] = lic.participantes.map((p, i) => ({
      id: `o-${id}-${i}`, compradorId: p.negocioId ?? '', proveedorId: lic.ganadora?.proveedorId ?? lic.proveedorId ?? PROVEEDOR_SALA,
      estado: 'confirmada', creadaEn: ahoraIso(),
      items: (p.items ?? []).map(item => {
        const producto = productos.find(x => x.id === item.productoId)!;
        return { productoId: producto.id, producto: producto.nombre, cantidad: item.cantidad, precioUnitario: producto.precioActual ?? producto.precioSolo };
      }),
    }));
    publicar(e => {
      e.ordenes = [...e.ordenes, ...ordenes];
      modificarLicitacion(e, id, l => ({ ...l, ordenIds: ordenes.map(o => o.id) }));
      return [];
    });

    const documentos: Documento[] = [];
    ordenes.forEach((o, i) => despues(i * FACTURA_MS, () => publicar(e => {
      const documento: Documento = {
        id: `d-${o.id}`, ordenId: o.id, tipo: 33, folio: folio++, trackId: null, estadoSii: 'recibido',
        monto: o.items.reduce((s, item) => s + item.cantidad * item.precioUnitario, 0), emitidoEn: ahoraIso(),
      };
      documentos.push(documento);
      e.documentos = [...e.documentos, documento];
      e.ordenes = e.ordenes.map(x => (x.id === o.id ? { ...x, estado: 'facturada' } : x));
      return [['documento.emitido', { documento }]];
    })));

    const finEmision = ordenes.length * FACTURA_MS;
    despues(finEmision + 600, () => publicar(() => {
      const total = documentos.reduce((s, d) => s + (d.monto ?? 0), 0);
      return [['licitacion.facturada', { licitacionId: id, documentos: documentos.length, total, ahorroTotal: lic.ahorroTotal ?? 0 }]];
    }));
    ordenes.forEach((o, i) => despues(finEmision + 1500 + i * ACEPTADA_MS, () => publicar(e => {
      e.documentos = e.documentos.map(d => (d.ordenId === o.id ? { ...d, estadoSii: 'aceptado' } : d));
      return [['documento.actualizado', { documento: e.documentos.find(d => d.ordenId === o.id) }]];
    })));
    despues(finEmision + 1500 + ordenes.length * ACEPTADA_MS + FINAL_MS, reiniciar);
  };

  /** Vuelve al inicio: licitación nueva, sin las órdenes ni facturas de la sala. Como POST /api/red/demo/reiniciar. */
  function reiniciar() {
    pendientes.forEach(clearTimeout);
    pendientes = [];
    numeroLicitacion += 1;
    nombres = nombresDeLaSala();
    guion = [];
    const semilla = sembrarEstado();
    estado = { ...semilla, licitaciones: [sembrarLicitacion(`l-${numeroLicitacion}`)] };
    alCambiar(estado, { tipo: 'red.reiniciada', datos: estado as unknown as Record<string, unknown>, en: ahoraIso() });
  }

  /** Cada 1,5 s llega uno o dos negocios con su carrito y a veces alguien cambia el suyo; al vencer el plazo, la compra cierra. */
  const avanzarSala = () => {
    const lic = estado.licitaciones.find(l => l.estado === 'abierta');
    if (!lic) return;
    if (Date.parse(lic.cierraEn) <= Date.now()) return cerrar(lic.id);
    const llegan = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < llegan; i++) {
      const [nombre, comuna] = nombres.next().value!;
      publicar(sumar(lic.id, { nombre, comuna }, carritoAleatorio()));
    }
    if (Math.random() < 0.3) publicar(editarAlguno(lic.id));
  };

  const avanzarOrden = () => {
    if (!guion.length) {
      vuelta += 1;
      guion = [...guionDeOrden(vuelta % 2 === 1, vuelta), () => [], () => []];
    }
    publicar(guion.shift()!);
  };

  alCambiar(estado);
  const competir = () => {
    const lic = estado.licitaciones.find(l => l.estado === 'abierta');
    if (lic) publicar(ofertar(lic.id));
  };
  const timers = [setInterval(avanzarOrden, 4500), setInterval(avanzarSala, LLEGADA_MS), setInterval(competir, OFERTA_MS)];

  return {
    detener() {
      timers.forEach(clearInterval);
      pendientes.forEach(clearTimeout);
    },
    unirse(licitacionId, datos) {
      publicar(sumar(licitacionId, datos, [{ productoId: datos.productoId ?? CANASTA[0].id, cantidad: datos.cantidad }]));
    },
    reiniciar,
    cerrar,
    confirmar,
  };
}
