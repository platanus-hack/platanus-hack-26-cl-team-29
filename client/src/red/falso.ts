// Red falsa para desarrollar y ensayar sin backend: una foto sembrada y un guion que emite
// eventos con el mismo formato que `red:evento`. Todos los nombres son ficticios.
// Se usa solo mientras GET /api/red/estado no responde.
//
// La sala: unos 40 negocios se suman a la compra conjunta en unos 60 s, el precio baja por tramos,
// la compra cierra, el proveedor dice que sí, salen las facturas una por una y el SII las acepta.
// Después de un rato vuelve a empezar.

import type { ConfigRed, Documento, EstadoRed, EventoRed, Licitacion, Negocio, Oferta, OrdenCompra, Participante, Tramo, TipoEvento } from './tipos.ts';
import { calcularTramos } from './derivar.ts';

export interface RedFalsa {
  detener(): void;
  unirse(licitacionId: string, datos: { nombre: string; comuna: string; cantidad: number }): void;
  reiniciar(): void;
  cerrar(licitacionId: string): void;
  confirmar(licitacionId: string): void;
}

const PRODUCTO = 'Caja de rollos térmicos 80 mm (50 un.)';
const UNIDAD = 'caja';
const UNIDAD_PLURAL = 'cajas';
const PRECIO_SOLO = 32_000;
const TRAMOS: Tramo[] = [
  { desde: 1, precioUnitario: 32_000 },
  { desde: 10, precioUnitario: 29_900 },
  { desde: 25, precioUnitario: 27_900 },
  { desde: 50, precioUnitario: 25_900 },
  { desde: 100, precioUnitario: 24_500 },
];
const PROVEEDOR_SALA = 'p-austral';
/** Proveedores (agentes) que compiten por la compra de la sala; el primero es el que está en el escenario. */
const COMPETIDORES = ['p-austral', 'p-andes', 'p-molinos', 'p-sur'];
/** Ningún proveedor baja de aquí. */
const PISO_OFERTA = 22_900;
const OFERTA_MS = 6000;

/** Número de relleno, claramente ficticio. */
export const CONFIG_FALSA: ConfigRed = { whatsappNumero: '56900000000', producto: PRODUCTO, unidad: UNIDAD, unidadPlural: UNIDAD_PLURAL };

const PROVEEDORES: Array<[string, string, string, number]> = [
  ['p-austral', 'Papelera Austral', 'Santiago', 4.7],
  ['p-andes', 'Insumos Andes', 'Las Condes', 4.5],
  ['p-molinos', 'Rollos del Sur', 'Maipú', 4.6],
  ['p-sur', 'Distribuidora Sur', 'Recoleta', 4.4],
  ['p-centro', 'Comercial Centro', 'La Reina', 3.9],
];

const COMPRADORES: Array<[string, string, string]> = [
  ['c-esquina', 'Almacén La Esquina', 'Ñuñoa'],
  ['c-trigal', 'Panadería El Trigal', 'La Reina'],
  ['c-robles', 'Restaurante Los Robles', 'Providencia'],
  ['c-napoli', 'Pizzería Napoli', 'Macul'],
];

const TIPOS = ['Almacén', 'Minimarket', 'Panadería', 'Botillería', 'Cafetería', 'Fuente de soda', 'Pizzería', 'Amasandería', 'Ferretería', 'Librería', 'Verdulería', 'Farmacia'];
const NOMBRES = ['Don Lucho', 'La Vecina', 'El Sol', 'Santa Rosa', 'Los Aromos', 'La Pasada', 'Doña Carmen', 'El Roble', 'Las Palmas', 'San José', 'El Puente', 'La Plaza', 'Los Pinos', 'Mi Barrio', 'El Rincón', 'La Estrella', 'Los Andes', 'El Faro', 'La Casona', 'Buen Pan', 'El Paso', 'La Cruz', 'Las Rosas', 'El Molino', 'La Fuente', 'El Cerro', 'Los Olivos'];
const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'San Joaquín', 'La Florida', 'Santiago', 'Maipú', 'Recoleta'];
/** Cuántas cajas pide cada negocio: casi siempre pocas, a veces más (de 1 a 20). */
const CANTIDADES = [1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8, 12];

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

const mejorOferta = (lic: Licitacion) =>
  lic.ofertas.reduce<Oferta | undefined>((m, o) => (!m || o.precioUnitario < m.precioUnitario ? o : m), undefined);

/** Recalcula lo que el backend deriva: el precio del tramo alcanzado o, si es menor, la mejor oferta. */
function conDerivados(lic: Licitacion): Licitacion {
  const tramos = calcularTramos(lic.participantes, lic.tramos, lic.precioSolo);
  const mejor = mejorOferta(lic)?.precioUnitario;
  const precioActual = mejor !== undefined && tramos.precioActual !== undefined ? Math.min(mejor, tramos.precioActual) : tramos.precioActual;
  return { ...lic, ...tramos, precioActual };
}

function sembrarLicitacion(id: string): Licitacion {
  const participantes: Participante[] = COMPRADORES.map(([negocioId], i) => ({ negocioId, cantidad: [2, 3, 1, 2][i], en: hace((4 - i) * 5 * SEGUNDO) }));
  return conDerivados({
    id,
    producto: PRODUCTO,
    comuna: 'Ñuñoa y alrededores',
    cierraEn: new Date(Date.now() + DURACION_SALA_MS).toISOString(),
    estado: 'abierta',
    precioSolo: PRECIO_SOLO,
    proveedorId: PROVEEDOR_SALA,
    unidad: UNIDAD,
    unidadPlural: UNIDAD_PLURAL,
    tramos: TRAMOS,
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

  /** Suma un participante (y el negocio, como lo haría el backend) y anuncia si el precio bajó de tramo. */
  const sumar = (id: string, datos: { nombre: string; comuna: string; cantidad: number }): Paso => e => {
    const lic = licitacion(e, id);
    if (!lic || lic.estado !== 'abierta') return [];
    const negocio: Negocio = { id: `c-sala-${e.negocios.length}`, nombre: datos.nombre, comuna: datos.comuna, rol: 'comprador' };
    const participante: Participante = { negocioId: negocio.id, nombre: datos.nombre, comuna: datos.comuna, cantidad: datos.cantidad, en: ahoraIso() };
    e.negocios = [...e.negocios, negocio];
    modificarLicitacion(e, id, l => conDerivados({ ...l, participantes: [...l.participantes, participante] }));
    const nueva = licitacion(e, id)!;
    return [['licitacion.participante', { licitacion: nueva, participante }], ...bajada(lic, nueva)];
  };

  const bajada = (antes: Licitacion, despues: Licitacion): Array<[TipoEvento, Record<string, unknown>]> =>
    antes.precioActual !== undefined && despues.precioActual !== undefined && despues.precioActual < antes.precioActual
      ? [['licitacion.precio_bajo', { licitacionId: despues.id, precioAnterior: antes.precioActual, precioNuevo: despues.precioActual, totalUnidades: despues.totalUnidades }]]
      : [];

  /** Un proveedor mejora: ofrece algo menos que el mejor precio de hoy (el del tramo o la mejor oferta). */
  const ofertar = (id: string): Paso => e => {
    const lic = licitacion(e, id);
    if (!lic || lic.estado !== 'abierta' || lic.participantes.length < 3) return [];
    const proveedorId = aleatorio(COMPETIDORES.filter(p => p !== mejorOferta(lic)?.proveedorId));
    const referencia = lic.precioActual ?? PRECIO_SOLO;
    const precioUnitario = Math.max(PISO_OFERTA, referencia - aleatorio([200, 300, 400, 500, 700]));
    if (precioUnitario >= referencia) return [];
    const nota = e.notas.find(n => n.proveedorId === proveedorId)?.nota;
    const proveedorNombre = e.negocios.find(n => n.id === proveedorId)?.nombre;
    const oferta: Oferta = { proveedorId, proveedorNombre, precioUnitario, plazoDias: 1, nota, en: ahoraIso() };
    modificarLicitacion(e, id, l => conDerivados({ ...l, ofertas: [...l.ofertas, oferta] }));
    const nueva = licitacion(e, id)!;
    return [['licitacion.oferta', { licitacionId: id, licitacion: nueva, oferta, mejor: mejorOferta(nueva) === oferta }], ...bajada(lic, nueva)];
  };

  const cerrar = (id: string) => {
    publicar(e => {
      const lic = licitacion(e, id);
      if (!lic || lic.estado !== 'abierta') return [];
      const mejor = mejorOferta(lic);
      const ganadora = mejor ? { ...mejor, nota: mejor.nota ?? 4.5, precioAjustado: mejor.precioUnitario } : undefined;
      modificarLicitacion(e, id, l => ({ ...l, estado: 'cerrada', ganadora, cierraEn: l.cierraEn > ahoraIso() ? ahoraIso() : l.cierraEn }));
      return [['licitacion.cerrada', { licitacion: licitacion(e, id), ordenes: [] }]];
    });
    despues(ESPERA_SI_MS, () => confirmar(id));
  };

  /** El proveedor dijo que sí: una orden por negocio, las facturas una por una y después el SII las acepta. */
  const confirmar = (id: string) => {
    const lic = licitacion(estado, id);
    if (!lic || lic.estado === 'abierta' || confirmadas.has(id)) return;
    confirmadas.add(id);
    const precio = lic.precioActual ?? PRECIO_SOLO;
    const ordenes: OrdenCompra[] = lic.participantes.map((p, i) => ({
      id: `o-${id}-${i}`, compradorId: p.negocioId ?? '', proveedorId: lic.ganadora?.proveedorId ?? lic.proveedorId ?? PROVEEDOR_SALA,
      estado: 'confirmada', creadaEn: ahoraIso(), items: [{ producto: PRODUCTO, cantidad: p.cantidad, precioUnitario: precio }],
    }));
    publicar(e => {
      e.ordenes = [...e.ordenes, ...ordenes];
      modificarLicitacion(e, id, l => ({ ...l, ordenIds: ordenes.map(o => o.id) }));
      return [];
    });

    const documentos: Documento[] = [];
    ordenes.forEach((o, i) => despues(i * FACTURA_MS, () => publicar(e => {
      const item = o.items[0];
      const documento: Documento = {
        id: `d-${o.id}`, ordenId: o.id, tipo: 33, folio: folio++, trackId: null, estadoSii: 'recibido',
        monto: item.cantidad * item.precioUnitario, emitidoEn: ahoraIso(),
      };
      documentos.push(documento);
      e.documentos = [...e.documentos, documento];
      e.ordenes = e.ordenes.map(x => (x.id === o.id ? { ...x, estado: 'facturada' } : x));
      return [['documento.emitido', { documento }]];
    })));

    const finEmision = ordenes.length * FACTURA_MS;
    despues(finEmision + 600, () => publicar(e => {
      const total = documentos.reduce((s, d) => s + (d.monto ?? 0), 0);
      const unidades = lic.totalUnidades ?? 0;
      return [['licitacion.facturada', { licitacionId: id, documentos: documentos.length, total, ahorroTotal: (PRECIO_SOLO - precio) * unidades }]];
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

  /** Cada 1,5 s llega uno o dos negocios; al vencer el plazo, la compra cierra. */
  const avanzarSala = () => {
    const lic = estado.licitaciones.find(l => l.estado === 'abierta');
    if (!lic) return;
    if (Date.parse(lic.cierraEn) <= Date.now()) return cerrar(lic.id);
    const llegan = Math.random() < 0.25 ? 2 : 1;
    for (let i = 0; i < llegan; i++) {
      const [nombre, comuna] = nombres.next().value!;
      publicar(sumar(lic.id, { nombre, comuna, cantidad: aleatorio(CANTIDADES) }));
    }
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
      publicar(sumar(licitacionId, datos));
    },
    reiniciar,
    cerrar,
    confirmar,
  };
}
