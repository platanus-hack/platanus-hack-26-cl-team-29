// Red falsa para desarrollar y ensayar sin backend: una foto sembrada y un guion que emite
// eventos con el mismo formato que `red:evento`. Todos los nombres son ficticios.
// Se usa solo mientras GET /api/red/estado no responde.

import type { EstadoRed, EventoRed, Licitacion, Negocio, OrdenCompra, Participante, TipoEvento } from './tipos.ts';

export interface RedFalsa {
  detener(): void;
  unirse(licitacionId: string, datos: { nombre: string; comuna: string; cantidad: number }): void;
}

const PROVEEDORES: Array<[string, string, string, number]> = [
  ['p-nuble', 'Panificadora Ñuble', 'Santiago', 4.7],
  ['p-andes', 'Harinas Andes', 'Las Condes', 4.5],
  ['p-molinos', 'Molinos del Sur', 'Maipú', 4.6],
  ['p-sur', 'Distribuidora Sur', 'Recoleta', 4.4],
  ['p-centro', 'Comercial Centro', 'La Reina', 3.9],
];

const COMPRADORES: Array<[string, string, string]> = [
  ['c-esquina', 'Almacén La Esquina', 'Ñuñoa'],
  ['c-trigal', 'Panadería El Trigal', 'La Reina'],
  ['c-robles', 'Restaurante Los Robles', 'Providencia'],
  ['c-napoli', 'Pizzería Napoli', 'Macul'],
];

const TIPOS = ['Almacén', 'Minimarket', 'Panadería', 'Botillería', 'Cafetería', 'Fuente de soda', 'Pizzería', 'Amasandería'];
const NOMBRES = ['Don Lucho', 'La Vecina', 'El Sol', 'Santa Rosa', 'Los Aromos', 'La Pasada', 'Doña Carmen', 'El Roble', 'Las Palmas', 'San José', 'El Puente', 'La Plaza', 'Los Pinos', 'Mi Barrio', 'El Rincón', 'La Estrella', 'Los Andes', 'El Faro', 'La Casona', 'Buen Pan', 'El Paso', 'La Cruz', 'Las Rosas', 'El Molino', 'La Fuente', 'El Cerro', 'Los Olivos'];
const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'San Joaquín', 'La Florida', 'Santiago', 'Maipú', 'Recoleta'];

const PRODUCTO = 'Harina 25 kg';
const MINUTO = 60_000;

const aleatorio = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

function sembrarNegocios(): Negocio[] {
  const proveedores = PROVEEDORES.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'proveedor' as const }));
  const compradores = COMPRADORES.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'comprador' as const }));
  const relleno: Negocio[] = [];
  for (let i = 0; relleno.length < 205; i++) {
    relleno.push({
      id: `c-${i}`,
      nombre: `${TIPOS[i % TIPOS.length]} ${NOMBRES[Math.floor(i / TIPOS.length) % NOMBRES.length]}`,
      comuna: COMUNAS[i % COMUNAS.length],
      rol: 'comprador',
    });
  }
  return [...proveedores, ...compradores, ...relleno];
}

function sembrarLicitacion(id: string): Licitacion {
  const participantes: Participante[] = [
    ...COMPRADORES.map(([negocioId], i) => ({ negocioId, cantidad: [4, 8, 3, 6][i], en: hace((14 - i) * MINUTO) })),
    ...Array.from({ length: 10 }, (_, i) => ({
      nombre: `${aleatorio(TIPOS)} ${aleatorio(NOMBRES)}`,
      comuna: aleatorio(COMUNAS),
      cantidad: 2 + (i % 5),
      en: hace((10 - i) * MINUTO),
    })),
  ];
  return {
    id,
    producto: PRODUCTO,
    comuna: 'Ñuñoa y alrededores',
    cierraEn: new Date(Date.now() + 5 * MINUTO).toISOString(),
    estado: 'abierta',
    precioSolo: 21_500,
    participantes,
    ofertas: [
      { proveedorId: 'p-sur', precioUnitario: 19_100, plazoDias: 1, en: hace(12.5 * MINUTO) },
      { proveedorId: 'p-andes', precioUnitario: 18_400, plazoDias: 2, en: hace(9.5 * MINUTO) },
      { proveedorId: 'p-molinos', precioUnitario: 17_100, plazoDias: 3, en: hace(7.5 * MINUTO) },
      { proveedorId: 'p-nuble', precioUnitario: 17_900, plazoDias: 1, en: hace(6.5 * MINUTO) },
      { proveedorId: 'p-andes', precioUnitario: 17_650, plazoDias: 2, en: hace(3.5 * MINUTO) },
    ],
  };
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

function guionDeOrden(conReclamo: boolean, n: number): Paso[] {
  const ordenId = `o-${n}`;
  const compradorId = conReclamo ? 'c-esquina' : 'c-trigal';
  const folio = 2000 + n * 3;
  const orden = (e: EstadoRed) => e.ordenes.find(o => o.id === ordenId)!;
  const estadoOrden = (e: EstadoRed, estado: OrdenCompra['estado']) => {
    e.ordenes = e.ordenes.map(o => (o.id === ordenId ? { ...o, estado } : o));
  };
  const emitir = (e: EstadoRed, tipo: 33 | 52 | 61, f: number) => {
    const documento = { id: `d-${ordenId}-${tipo}`, ordenId, tipo, folio: f, trackId: null, estadoSii: 'recibido', monto: tipo === 61 ? 37_000 : 74_000, emitidoEn: new Date().toISOString() };
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
        id: ordenId, compradorId, proveedorId: 'p-molinos', estado: 'enviada', creadaEn: new Date().toISOString(),
        items: [{ producto: PRODUCTO, cantidad: 4, precioUnitario: 18_500 }],
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
      e.ordenes = e.ordenes.map(o => (o.id === ordenId ? { ...o, reclamo: { producto: PRODUCTO, faltante: 2, en: new Date().toISOString(), estadoSii: 'simulado' } } : o));
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
  let licitaciones = 1;

  const publicar = (paso: Paso) => {
    const siguiente = { ...estado };
    const eventos = paso(siguiente);
    estado = siguiente;
    if (!eventos.length) alCambiar(estado);
    for (const [tipo, datos] of eventos) alCambiar(estado, { tipo, datos, en: new Date().toISOString() });
  };

  const modificarLicitacion = (id: string, cambio: (l: Licitacion) => Licitacion) => (e: EstadoRed) => {
    e.licitaciones = e.licitaciones.map(l => (l.id === id ? cambio(l) : l));
  };

  const contraoferta = (id: string): Paso => e => {
    const lic = e.licitaciones.find(l => l.id === id);
    if (!lic || lic.estado !== 'abierta') return [];
    const proveedorId = aleatorio(['p-nuble', 'p-andes', 'p-sur']);
    const mejor = Math.min(...lic.ofertas.filter(o => o.proveedorId !== 'p-molinos').map(o => o.precioUnitario));
    const precioUnitario = Math.max(15_900, mejor - aleatorio([100, 150, 200, 250]));
    if (precioUnitario >= mejor) return [];
    const oferta = { proveedorId, precioUnitario, plazoDias: proveedorId === 'p-andes' ? 2 : 1, en: new Date().toISOString() };
    modificarLicitacion(id, l => ({ ...l, ofertas: [...l.ofertas, oferta] }))(e);
    const nota = e.notas.find(n => n.proveedorId === proveedorId)?.nota;
    return [['licitacion.oferta', { licitacion: e.licitaciones.find(l => l.id === id), oferta, nota }]];
  };

  const sumar = (id: string, p: Participante): Paso => e => {
    modificarLicitacion(id, l => ({ ...l, participantes: [...l.participantes, p] }))(e);
    return [['licitacion.participante', { licitacion: e.licitaciones.find(l => l.id === id), participante: p }]];
  };

  let pasoLicitacion = 0;
  const avanzarLicitacion = () => {
    const lic = estado.licitaciones.find(l => l.estado === 'abierta') ?? estado.licitaciones.at(-1)!;
    if (lic.estado === 'cerrada') {
      licitaciones += 1;
      return publicar(e => { e.licitaciones = [sembrarLicitacion(`l-${licitaciones}`)]; return []; });
    }
    if (Date.parse(lic.cierraEn) <= Date.now()) {
      return publicar(e => {
        modificarLicitacion(lic.id, l => ({ ...l, estado: 'cerrada' }))(e);
        return [['licitacion.cerrada', { licitacion: e.licitaciones.find(l => l.id === lic.id), ordenes: [] }]];
      });
    }
    pasoLicitacion += 1;
    if (pasoLicitacion % 3 === 0) return publicar(contraoferta(lic.id));
    publicar(sumar(lic.id, {
      nombre: `${aleatorio(TIPOS)} ${aleatorio(NOMBRES)}`, comuna: aleatorio(COMUNAS), cantidad: 1 + Math.floor(Math.random() * 6), en: new Date().toISOString(),
    }));
  };

  const avanzarOrden = () => {
    if (!guion.length) {
      vuelta += 1;
      guion = [...guionDeOrden(vuelta % 2 === 1, vuelta), () => [], () => []];
    }
    publicar(guion.shift()!);
  };

  alCambiar(estado);
  const timers = [setInterval(avanzarOrden, 4500), setInterval(avanzarLicitacion, 3500)];
  const pendientes: Array<ReturnType<typeof setTimeout>> = [];

  return {
    detener() {
      timers.forEach(clearInterval);
      pendientes.forEach(clearTimeout);
    },
    unirse(licitacionId, datos) {
      publicar(sumar(licitacionId, { ...datos, en: new Date().toISOString() }));
      pendientes.push(setTimeout(() => publicar(contraoferta(licitacionId)), 1500));
    },
  };
}
