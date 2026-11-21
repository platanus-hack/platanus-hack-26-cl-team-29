// Red falsa del canal web: la misma interfaz que la API real, en memoria. Se usa mientras el backend
// no tiene las rutas con sesión (o con `?prueba`). Todos los nombres son ficticios.
// Simula a la contraparte: el proveedor confirma y factura solo, y emite la nota de crédito tras un reclamo.

import type { Documento, EventoRed, Negocio, TipoDocumento, TipoEvento } from '../red/tipos.ts';
import { ErrorCanal, type CanalApi } from './api.ts';
import type { ConfigRed, FotoRed, LicitacionCanal, OrdenCanal, Participacion } from './tipos.ts';

const CONFIG: ConfigRed = {
  whatsappNumero: null,
  producto: 'Caja de rollos térmicos 80 mm (50 un.)',
  unidad: 'caja',
  unidadPlural: 'cajas',
};

const TRAMOS = [
  { desde: 1, precioUnitario: 32_000 },
  { desde: 10, precioUnitario: 29_900 },
  { desde: 25, precioUnitario: 27_900 },
  { desde: 50, precioUnitario: 25_900 },
  { desde: 100, precioUnitario: 24_500 },
];

const PROVEEDOR_DEMO = 'p-papelera';

const PROVEEDORES: Array<[string, string, string, number]> = [
  [PROVEEDOR_DEMO, 'Papelera del Centro', 'Santiago', 4.2],
  ['p-nuble', 'Panificadora Ñuble', 'Santiago', 4.7],
  ['p-molinos', 'Molinos del Sur', 'Maipú', 4.6],
  ['p-andes', 'Harinas Andes', 'Las Condes', 4.5],
  ['p-sur', 'Distribuidora Sur', 'Recoleta', 4.4],
];

const COMPRADORES: Array<[string, string, string]> = [
  ['c-esquina', 'Almacén La Esquina', 'Ñuñoa'],
  ['c-trigal', 'Panadería El Trigal', 'La Reina'],
  ['c-robles', 'Restaurante Los Robles', 'Providencia'],
  ['c-napoli', 'Pizzería Napoli', 'Macul'],
  ['c-aromos', 'Minimarket Los Aromos', 'Macul'],
  ['c-vecina', 'Botillería La Vecina', 'Peñalolén'],
];

const DEL_PUBLICO = ['Cafetería El Sol', 'Fuente de soda La Pasada', 'Amasandería Doña Carmen', 'Almacén El Roble', 'Minimarket Las Palmas', 'Botillería San José', 'Pizzería El Puente', 'Almacén La Plaza'];
const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'Santiago'];

/** Precio neto de referencia de los productos que no son de la compra conjunta. */
const PRECIOS: Record<string, number> = {
  [CONFIG.producto]: 32_000,
  'Harina 25 kg': 18_000,
  'Levadura 500 g': 3_500,
  'Azúcar 25 kg': 24_000,
  'Manteca 10 kg': 21_000,
  'Sal 25 kg': 9_000,
};

const MINUTO = 60_000;
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahoraIso = () => new Date().toISOString();
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

function sembrar() {
  const negocios: Negocio[] = [
    ...PROVEEDORES.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'proveedor' as const })),
    ...COMPRADORES.map(([id, nombre, comuna]) => ({ id, nombre, comuna, rol: 'comprador' as const })),
  ];
  const licitacion: LicitacionCanal = {
    id: 'L-1',
    producto: CONFIG.producto,
    comuna: 'Santiago',
    cierraEn: new Date(Date.now() + 8 * MINUTO).toISOString(),
    estado: 'abierta',
    precioSolo: TRAMOS[0].precioUnitario,
    tramos: TRAMOS,
    ofertas: [],
    participantes: COMPRADORES.map(([negocioId, nombre, comuna], i) => ({ negocioId, nombre, comuna, cantidad: [4, 6, 3, 2, 3, 3][i], en: hace((12 - i) * MINUTO) })),
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
    licitaciones: [licitacion],
    ordenes,
    documentos: [] as Documento[],
  };
}

export function crearApiFalsa(): CanalApi {
  const red = sembrar();
  const folios: Record<TipoDocumento, number> = { 33: 1200, 52: 800, 61: 300 };
  const sesiones = new Map<string, string>();
  const oyentes = new Set<(e?: EventoRed) => void>();
  let contador = 0;

  const avisar = (tipo: TipoEvento, datos: Record<string, unknown> = {}) => {
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
  const total = (o: OrdenCanal) => o.items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0);
  const facturar = (o: OrdenCanal, conGuia = true) => {
    o.estado = 'facturada';
    emitir(o, 33, total(o));
    if (conGuia) emitir(o, 52, total(o));
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
  const ordenesDe = (lic: LicitacionCanal) => red.ordenes.filter(o => o.licitacionId === lic.id);

  /** Siembra el historial de un comprador nuevo para que vea todas las secciones con datos. */
  const sembrarComprador = (negocio: Negocio) => {
    const item = (cantidad: number, producto: string) => [{ producto, cantidad, precioUnitario: PRECIOS[producto] }];
    const porRecibir: OrdenCanal = { id: `o-${++contador}`, compradorId: negocio.id, proveedorId: PROVEEDOR_DEMO, estado: 'confirmada', creadaEn: hace(20 * MINUTO), items: item(8, CONFIG.producto) };
    const corregida: OrdenCanal = {
      id: `o-${++contador}`, compradorId: negocio.id, proveedorId: 'p-nuble', estado: 'reclamada', creadaEn: hace(26 * 60 * MINUTO), items: item(4, 'Harina 25 kg'),
      reclamo: { producto: 'Harina 25 kg', faltante: 1, en: hace(25 * 60 * MINUTO), estadoSii: 'aceptado' },
    };
    red.ordenes.push(corregida, porRecibir);
    facturar(corregida);
    notaCredito(corregida, false);
    facturar(porRecibir);
  };

  // El público se sigue sumando: el precio baja en vivo.
  setInterval(() => {
    const lic = red.licitaciones.find(l => l.estado === 'abierta' && Date.parse(l.cierraEn) > Date.now());
    if (!lic || lic.participantes.reduce((s, p) => s + p.cantidad, 0) > 60) return;
    const nombre = DEL_PUBLICO[contador++ % DEL_PUBLICO.length];
    const negocio: Negocio = { id: `c-pub-${contador}`, nombre, comuna: COMUNAS[contador % COMUNAS.length], rol: 'comprador' };
    red.negocios.push(negocio);
    const participante = { negocioId: negocio.id, nombre, comuna: negocio.comuna, cantidad: 1 + (contador % 3), en: ahoraIso() };
    lic.participantes.push(participante);
    avisar('licitacion.participante', { licitacion: lic, participante });
  }, 9000);

  const foto = (): FotoRed => structuredClone({
    negocios: red.negocios,
    ordenes: red.ordenes,
    documentos: red.documentos,
    notas: [...red.notas].map(([proveedorId, nota]) => ({ proveedorId, nota })),
    licitaciones: red.licitaciones,
  });

  return {
    modo: 'falso',
    config: async () => CONFIG,
    estado: async () => foto(),

    async sesion(nombre, comuna) {
      await espera(300);
      exigir(!!nombre.trim(), 'Escribe el nombre de tu negocio.');
      const negocio: Negocio = { id: `c-web-${++contador}`, nombre: nombre.trim(), comuna: comuna.trim() || 'Santiago', rol: 'comprador' };
      red.negocios.push(negocio);
      sembrarComprador(negocio);
      const token = `falso-${negocio.id}`;
      sesiones.set(token, negocio.id);
      return { token, negocio };
    },

    async yo(token) {
      const negocio = quien(token);
      const ordenes = red.ordenes.filter(o => o.compradorId === negocio.id);
      const participaciones: Participacion[] = red.licitaciones.flatMap(l =>
        l.participantes.filter(p => p.negocioId === negocio.id).map(p => ({ licitacionId: l.id, cantidad: p.cantidad })));
      return structuredClone({
        negocio,
        ordenes,
        documentos: red.documentos.filter(d => ordenes.some(o => o.id === d.ordenId)),
        participaciones,
      });
    },

    async unirse(token, licitacionId, cantidad) {
      await espera(300);
      const negocio = quien(token);
      const lic = licitacion(licitacionId);
      exigir(lic.estado === 'abierta' && Date.parse(lic.cierraEn) > Date.now(), 'Esta compra conjunta ya cerró.');
      exigir(Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 20, 'Puedes pedir entre 1 y 20.');
      const previo = lic.participantes.find(p => p.negocioId === negocio.id);
      const participante = previo ?? { negocioId: negocio.id, nombre: negocio.nombre, comuna: negocio.comuna, cantidad, en: ahoraIso() };
      participante.cantidad = cantidad;
      if (!previo) lic.participantes.push(participante);
      avisar('licitacion.participante', { licitacion: lic, participante });
    },

    async pedir(token, proveedorId, items) {
      await espera(400);
      const negocio = quien(token);
      exigir(red.negocios.some(n => n.id === proveedorId && n.rol === 'proveedor'), 'Elige un proveedor de la red.');
      exigir(items.length > 0 && items.every(i => i.cantidad >= 1 && PRECIOS[i.producto] !== undefined), 'Elige un producto y la cantidad.');
      const o: OrdenCanal = {
        id: `o-${++contador}`, compradorId: negocio.id, proveedorId, estado: 'enviada', creadaEn: ahoraIso(),
        items: items.map(i => ({ ...i, precioUnitario: PRECIOS[i.producto] })),
      };
      red.ordenes.push(o);
      avisar('orden.creada', { orden: o });
      // La contraparte: el proveedor dice "sí" y factura.
      despues(2500, () => { o.estado = 'confirmada'; avisar('orden.confirmada', { orden: o }); });
      despues(4500, () => { facturar(o); avisar('documento.emitido', { orden: o }); });
      return structuredClone(o);
    },

    async recepcion(token, ordenId, r) {
      await espera(400);
      const negocio = quien(token);
      const o = orden(ordenId);
      exigir(o.compradorId === negocio.id, 'Ese pedido no es tuyo.');
      exigir(o.estado === 'facturada', 'Este pedido ya no espera tu recepción.');
      if ('conforme' in r) {
        o.estado = 'recibida';
        avisar('recepcion.registrada', { orden: o, conforme: true });
        cambiarNota(o.proveedorId, 0.1);
        return;
      }
      const item = o.items[0];
      exigir(r.confirmado && Number.isInteger(r.faltante) && r.faltante >= 1 && r.faltante <= item.cantidad, `Indica cuántas faltaron, entre 1 y ${item.cantidad}.`);
      o.estado = 'reclamada';
      o.reclamo = { producto: item.producto, faltante: r.faltante, en: ahoraIso(), estadoSii: 'recibido' };
      avisar('reclamo.registrado', { orden: o, reclamo: o.reclamo, motivo: 'falta parcial' });
      cambiarNota(o.proveedorId, -0.4);
      despues(6000, () => notaCredito(o));
    },

    async sesionProveedor(codigo) {
      await espera(300);
      exigir(!!codigo.trim(), 'Escribe tu código de acceso.');
      const token = `falso-${PROVEEDOR_DEMO}-${++contador}`;
      sesiones.set(token, PROVEEDOR_DEMO);
      return { token };
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
      const unidades = lic.participantes.reduce((s, p) => s + p.cantidad, 0);
      const precio = [...TRAMOS].reverse().find(t => t.desde <= unidades)?.precioUnitario ?? TRAMOS[0].precioUnitario;
      for (const p of lic.participantes) {
        red.ordenes.push({
          id: `o-${++contador}`, licitacionId: lic.id, compradorId: p.negocioId ?? '', proveedorId: PROVEEDOR_DEMO, estado: 'confirmada',
          creadaEn: ahoraIso(), items: [{ producto: lic.producto, cantidad: p.cantidad, precioUnitario: precio }],
        });
      }
      avisar('licitacion.cerrada', { licitacion: lic });
    },

    async facturar(token, licitacionId) {
      await espera(900);
      quien(token);
      const lic = licitacion(licitacionId);
      exigir(lic.estado === 'cerrada' && !lic.facturadaEn, 'Esta compra conjunta no está lista para facturar.');
      ordenesDe(lic).forEach(o => facturar(o, false));
      lic.facturadaEn = ahoraIso();
      avisar('licitacion.facturada' as TipoEvento, { licitacion: lic });
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

    escuchar(alCambiar) {
      oyentes.add(alCambiar);
      return () => { oyentes.delete(alCambiar); };
    },
  };
}
