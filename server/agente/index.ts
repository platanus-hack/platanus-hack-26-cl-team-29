// Agente de WhatsApp de la red. Máquina de estados por negocio:
//   sin pendiente --(pedido / "pedidos")--> acción pendiente --(sí)--> ejecuta en el dominio
//                                                           --(no)--> descarta
// Regla dura: nada con efecto legal (orden, factura, reclamo, nota de crédito) se ejecuta
// sin un sí explícito de la persona en la conversación. La pendiente se saca de la cola
// ANTES de ejecutar, así un segundo "sí" no repite la acción.
// Con una red que trae la compra conjunta (server/agente/sala.ts), los teléfonos desconocidos
// son el público de la sala y la facturación de la compra pasa por la misma cola de confirmaciones.
import type { WhatsApp } from '../whatsapp/index.ts';
import type { Interprete, Intencion } from './intencion.ts';
import type { LicitacionSala, Negocio, OrdenCompra, Red } from './puerto.ts';
import { unidadDeTexto } from '../../shared/unidades.ts';
import { tieneProveedores, tieneSala } from './puerto.ts';
import { interpretarConReglas, interpreteDeReglas, leerStock, normalizar, stockEnTexto } from './intencion.ts';
import { CANTIDAD_MAXIMA, puedeComprar, puedeVender } from '../../shared/red.ts';
import { mismoNombre, type ProductoConocido } from '../../shared/productos.ts';
import { mejorOferta, puedeCerrarAntes } from '../../shared/precios.ts';
import type { Biblioteca } from '../catalogo/biblioteca.ts';
import type { Equivalencias } from '../catalogo/equivalencias.ts';
import { itemsDe, productosDe } from './canasta.ts';
import { crearProveedores } from './proveedor.ts';
import type { EstadoSiiProveedor, ListaDeProductos, PropuestaProveedor, Proveedores } from './proveedor.ts';
import { crearInterpreteClaude } from './claude.ts';
import { crearEnvios, enmascarar } from './envios.ts';
import type { Log, WhatsAppDeEnvios } from './envios.ts';
import { crearSala } from './sala.ts';
import type { Sala } from './sala.ts';
import * as m from './mensajes.ts';
import type { AlmacenBorradores } from './borradores.ts';
import { crearAlmacenBorradoresMemoria, MapaPersistente } from './borradores.ts';

export type { Red } from './puerto.ts';
export { crearAlmacenBorradores } from './borradores.ts';

const PLAZO_RECLAMO_DIAS = 8;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Para qué se eligió el producto: comprarlo en grupo o agregarlo a la lista del proveedor. */
type ParaProducto = { readonly tipo: 'comprar'; readonly cantidad: number } | { readonly tipo: 'vender'; readonly unidad: string; readonly precio: number };

/** "cerrar la compra", "cierra la compra en grupo ya", "cerrar compra de coca cola". */
const VERBO_CERRAR = '(cerrar|cerrarla|cerrarlas|cerrarlo|cerralo|cerrala|cerralas|cierra|cierrala|cierralas|cierralo|cierre|cierren)';
/** "cerrar la compra", "cérralo", "quiero cerrar ambas", "cierra la de coca cola". */
const CERRAR_COMPRA = new RegExp(`\\b${VERBO_CERRAR}\\b.*\\b(compras?|grupo|pedido|ambas|todas|las dos|la de|el de)\\b|^(quiero |puedes |podrias )?${VERBO_CERRAR}( ya| ahora| por favor)?$`);
/**
 * Si el texto nombra el producto por alguna de sus palabras ("las coca colas" → "CocaCola 330ml", "bolsas" →
 * "Paquete de bolsas camiseta"), sin contar unidades ni palabras cortas. El texto, ya `normalizar`.
 */
function nombraProducto(dicho: string, producto: string): boolean {
  const junto = dicho.replace(/[^a-z0-9]/g, '');
  return normalizar(producto).split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !unidadDeTexto(w) && !/\d/.test(w))
    .some(w => junto.includes(w.replace(/e?s$/, '')));
}

/** "kilos de durazno" → "durazno": la unidad y los artículos no son parte del nombre del producto. */
function sinUnidades(escrito: string): string {
  const fuera = new Set<number>();
  const palabras = escrito.trim().split(/\s+/);
  palabras.forEach((w, i) => {
    // La unidad sale con el "de" que la sigue ("kilos de durazno"); "servilletas de papel" queda igual.
    if (unidadDeTexto(w)) fuera.add(i).add(/^(de|del)$/i.test(palabras[i + 1] ?? '') ? i + 1 : i);
  });
  const limpio = palabras.filter((_, i) => !fuera.has(i)).join(' ').replace(/^(el|la|los|las|un|una|unos|unas)\s+/i, '');
  return limpio || escrito.trim();
}

/** "sí, pero con 10", "mejor 10", "10 para mí": la cantidad nueva (no un botón: esos llegan como "1" o "2" solos). */
function cantidadDicha(texto: string): number | null {
  if (/^\d$/.test(texto.trim())) return null;
  const n = Number(/\b(\d{1,6})\b/.exec(texto)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= CANTIDAD_MAXIMA ? n : null;
}
const AFIRMA = /^(si|sip|dale|ok|ya|bueno|perfecto|claro)\b/;

const MIS_COMPRAS = /^(mis compras|mis compras en grupo|en (que|cuales) compras estoy|que compras tengo|mis pedidos en grupo)\b/;
const SALIR_DE = /\b(salir|salirme|sacame|retirarme)\b/;
const SUMAR = /\b(mas|agrega|agregar|agregame|suma|sumar|sumame|anade|anadir)\b/;
const RESTAR = /\b(menos|quita|quitar|quitame|saca|sacar|resta|restar|baja|bajar)\b/;
const FIJAR = /\b(solo|cambia|cambiar|cambialo|cambiala|deja|dejar|dejame|pon|poner|total)\b|\ba \d+\b/;

/** "ambas", "todas", "las dos": todas las que abrió. */
const TODAS = /\b(ambas|todas|las dos|los dos|todo)\b/;

/** Las sugerencias de la biblioteca que se ofrecen como máximo. */
const MAXIMO_OPCIONES = 5;

type Pendiente = { readonly mensaje: string } & (
  | { readonly tipo: 'crear_orden'; readonly proveedor: Negocio; readonly producto: string; readonly cantidad: number }
  | { readonly tipo: 'abrir_solicitud'; readonly producto: string; readonly unidad: string; readonly cantidad: number }
  // Cambiar lo que lleva en una compra en grupo (0: salir de ella).
  | { readonly tipo: 'cambiar_cantidad'; readonly licitacionId: string; readonly productoId: string; readonly producto: string; readonly unidad: string; readonly unidadPlural?: string; readonly cantidad: number }
  | { readonly tipo: 'cerrar_antes'; readonly licitacionIds: readonly string[]; readonly productos: readonly string[] }
  // Abrió varias y no dijo cuál cerrar: se pregunta con botones (una por producto y "Todas").
  | { readonly tipo: 'elegir_cierre'; readonly opciones: readonly { readonly id: string; readonly producto: string }[] }
  // Ya hay una compra en grupo abierta de ese producto: se suma a ella con su cantidad (además de lo que ya lleva).
  | { readonly tipo: 'sumarse'; readonly licitacionId: string; readonly productoId: string; readonly producto: string; readonly cantidad: number }
  // Lo escrito se parece a productos de la biblioteca: se pregunta cuál es (o si es uno nuevo) antes de seguir.
  | { readonly tipo: 'elegir_producto'; readonly escrito: string; readonly opciones: readonly ProductoConocido[]; readonly para: ParaProducto }
  | { readonly tipo: 'confirmar_ordenes'; readonly ordenIds: readonly string[] }
  | { readonly tipo: 'recepcion'; readonly ordenId: string; readonly facturaEn: Date }
  | { readonly tipo: 'reclamar'; readonly ordenId: string; readonly faltante: number; readonly facturaEn: Date }
  | { readonly tipo: 'nota_credito'; readonly ordenId: string; readonly faltante: number; readonly monto: number; readonly reclamoEn: Date }
  | { readonly tipo: 'facturar_licitacion'; readonly licitacionId: string }
  /** Ofertar o sumar un producto a la compra conjunta (server/agente/proveedor.ts). */
  | { readonly tipo: 'proveedor'; readonly propuesta: PropuestaProveedor }
);

/** Lo que solo hace quien vende: no es de la sala aunque lo escriba alguien que también compra. */
const DE_PROVEEDOR = new Set<Intencion['tipo']>(['ofertar', 'crear_producto', 'ser_proveedor', 'ver_ofertas']);

export interface OpcionesAgente {
  readonly interprete?: Interprete;
  /** La biblioteca de productos (server/catalogo/biblioteca.ts): sugiere uno existente antes de crear otro. */
  readonly biblioteca?: Pick<Biblioteca, 'buscar'> & Partial<Pick<Biblioteca, 'cotizar'>>;
  /** La lista de productos de cada proveedor (server/catalogo): "vendo ..." la llena por WhatsApp. */
  readonly productos?: ListaDeProductos;
  /** Mismo producto escrito distinto (server/catalogo/equivalencias.ts): para sumarse a la compra abierta que ya existe. */
  readonly equivalencias?: Equivalencias;
  readonly ahora?: () => Date;
  readonly log?: Log;
  /** Tiempos y límites de la compra conjunta; por defecto los de la demo. */
  readonly sala?: Partial<TiemposSala>;
  readonly env?: NodeJS.ProcessEnv;
  /** Certificado digital por link privado (server/certificados), opcional: se ofrece al sumarse y con "conectar certificado". */
  readonly certificados?: { enlace(telefono: string): string };
  /** Dónde guardar lo que cada teléfono lleva a medias (registro, carrito), para que sobreviva a un reinicio. */
  readonly almacenBorradores?: AlmacenBorradores;
  /** SII de cada proveedor registrado por WhatsApp (server/conexion-sii). Sin él, sus facturas son simuladas. */
  readonly conexionSii?: {
    conectar(rutEmpresa: string, rutTitular: string): Promise<void>;
    estado(rutEmpresa: string): Promise<EstadoSiiProveedor>;
  };
  /** Cada cuánto revisar la conexión al SII de un proveedor nuevo (tests). */
  readonly revisarSiiMs?: number;
  /** Avisos de compra abierta (server/avisos), opcional: BASTA responde siempre y un SÍ a su aviso lo suma a la sala. */
  readonly avisos?: { atender(telefono: string, texto: string): Promise<{ respuesta: string } | { sumarse: string } | null> };
}

export interface TiemposSala {
  readonly concurrencia: number;
  readonly ventanaCascadaMs: number;
  readonly minimoDifusionMs: number;
  readonly vigilarCierreMs: number;
  readonly avisoAceptadaMs: number;
  /** Máximo por producto y negocio. */
  readonly cantidadMaxima: number;
}

const TIEMPOS_SALA: TiemposSala = {
  concurrencia: 5,
  ventanaCascadaMs: 1500,
  minimoDifusionMs: 5000,
  vigilarCierreMs: 1000,
  avisoAceptadaMs: 60_000,
  cantidadMaxima: CANTIDAD_MAXIMA,
};

export interface Agente {
  /** Para facturas emitidas fuera de WhatsApp (p. ej. desde la pantalla): pregunta al comprador si recibió todo. */
  avisarFactura(ordenId: string): Promise<void>;
  /**
   * La persona conectó su certificado: se le confirma por WhatsApp y, si se está registrando, su registro sigue con
   * el RUT del titular como si lo hubiera escrito.
   */
  certificadoConectado(telefono: string, rut: string): Promise<void>;
  desconectar(): void;
}

type WhatsAppDelAgente = Pick<WhatsApp, 'onMessage'> & WhatsAppDeEnvios & Partial<Pick<WhatsApp, 'history' | 'send'>>;

export function conectarAgente(whatsapp: WhatsAppDelAgente, red: Red, opciones: OpcionesAgente = {}): Agente {
  const env = opciones.env ?? process.env;
  const interprete = opciones.interprete ?? interpreteDesdeEnv(env);
  const ahora = opciones.ahora ?? (() => new Date());
  const log = opciones.log ?? console;
  /**
   * Cola de acciones pendientes por negocio; la primera es la que se está preguntando. Se guarda (como los borradores
   * de la sala): cada deploy reinicia el proceso y, sin esto, un "Sí" a una pregunta de antes del reinicio se perdía.
   */
  const colas = new MapaPersistente<Pendiente[]>(opciones.almacenBorradores ?? crearAlmacenBorradoresMemoria(), 'agente', log);
  const fijarCola = (negocioId: string, cola: Pendiente[]) => (cola.length ? colas.set(negocioId, cola) : colas.delete(negocioId));

  const actual = (negocioId: string) => colas.get(negocioId)?.[0] ?? null;
  const tomar = (negocioId: string) => {
    const [primera = null, ...resto] = colas.get(negocioId) ?? [];
    fijarCola(negocioId, resto);
    return primera;
  };
  const alFrente = (negocioId: string, p: Pendiente) => fijarCola(negocioId, [p, ...(colas.get(negocioId) ?? [])]);

  /** Pendiente iniciada por la contraparte: se pregunta ahora si no hay otra en curso, o al terminar la actual. */
  async function encolar(negocio: Negocio, p: Pendiente) {
    await depurar(negocio.id);
    const cola = [...(colas.get(negocio.id) ?? []), p];
    fijarCola(negocio.id, cola);
    if (cola.length === 1) await enviar(negocio.telefono, p.mensaje, 'agente');
  }

  /**
   * Si una pregunta pendiente todavía tiene sentido: la cola sobrevive a los reinicios y lo mismo se puede hacer en la
   * web, así que "¿Las facturo todas?" de una compra ya facturada desde el panel ya no se pregunta.
   */
  function vigente(p: Pendiente, { ordenes, licitaciones = [] }: Awaited<ReturnType<Red['estadoDeLaRed']>>): boolean {
    const estadoDe = (id: string) => ordenes.find(o => o.id === id)?.estado;
    const abierta = (id: string) => licitaciones.some(l => l.id === id && l.estado === 'abierta');
    switch (p.tipo) {
      case 'facturar_licitacion': {
        const l = licitaciones.find(x => x.id === p.licitacionId) as { ordenIds?: readonly string[] } | undefined;
        // Sin la lista de sus pedidos (red antigua), no se sabe: se deja.
        return !l?.ordenIds || l.ordenIds.some(id => ['enviada', 'confirmada'].includes(estadoDe(id) ?? ''));
      }
      case 'confirmar_ordenes': return p.ordenIds.some(id => estadoDe(id) === 'enviada');
      case 'recepcion': case 'reclamar': return estadoDe(p.ordenId) === 'facturada';
      case 'nota_credito': return estadoDe(p.ordenId) === 'reclamada';
      case 'sumarse': case 'cambiar_cantidad': return abierta(p.licitacionId);
      case 'cerrar_antes': return p.licitacionIds.some(abierta);
      case 'elegir_cierre': return p.opciones.some(o => abierta(o.id));
      default: return true;
    }
  }

  /** Saca de la cola lo que ya no tiene sentido preguntar (ver `vigente`). */
  async function depurar(negocioId: string) {
    const cola = colas.get(negocioId);
    if (!cola?.length) return;
    const estado = await red.estadoDeLaRed();
    const quedan = cola.filter(p => vigente(p, estado));
    if (quedan.length !== cola.length) fijarCola(negocioId, quedan);
  }

  /** Lo guardado vuelve como JSON: las fechas de las pendientes se rehacen. */
  async function cargarColas() {
    await colas.cargar();
    const fecha = (v: unknown) => new Date(v as string);
    for (const [id, cola] of colas) {
      colas.set(id, cola.map(p => ('facturaEn' in p ? { ...p, facturaEn: fecha(p.facturaEn) } : 'reclamoEn' in p ? { ...p, reclamoEn: fecha(p.reclamoEn) } : p)));
    }
  }

  /**
   * Manda un texto; si termina en opciones ("1. Sí… 2. No"), como botones de WhatsApp. Apretar uno llega como
   * "1" o "2", que el agente y la sala ya entienden. Sin `send` (o si falla), va como texto.
   */
  async function enviar(telefono: string, texto: string, source: string) {
    const interactivo = aInteractivo(texto);
    if (whatsapp.send && interactivo) {
      const r = await whatsapp.send(telefono, interactivo, { source });
      if (r.status !== 'failed') return;
    }
    await whatsapp.sendText(telefono, texto);
  }

  /**
   * Opciones al final ("1. Sí… 2. No") → botones; un bloque de 4 a 10 opciones (los productos de la sala) → lista
   * desplegable. Elegir una fila llega como su título ("Guantes"), que la sala entiende como el producto.
   */
  function aInteractivo(texto: string) {
    const opciones = m.separarOpciones(texto);
    if (opciones) return { body: opciones.cuerpo, buttons: opciones.opciones.map((title, i) => ({ id: String(i + 1), title })) };
    const lista = m.separarLista(texto);
    if (lista) {
      const rows = lista.filas.map((f, i) => ({ id: `op${i + 1}`, title: f.titulo, ...(f.descripcion ? { description: f.descripcion } : {}) }));
      return { body: lista.cuerpo, list: { button: 'Ver opciones', rows } };
    }
    return null;
  }

  // Proveedores por WhatsApp: con compra conjunta, una red que registra proveedores y el link al certificado.
  const conProveedores = tieneSala(red) && tieneProveedores(red) && Boolean(opciones.certificados);
  let proveedores: Proveedores | null = null;
  const sala: Sala | null = tieneSala(red) ? crearSalaDelAgente(red, opciones.sala ?? {}) : null;
  if (conProveedores && tieneSala(red) && tieneProveedores(red) && opciones.certificados) {
    const { certificados, conexionSii } = opciones;
    proveedores = crearProveedores(red, {
      log,
      enlaceCertificado: telefono => certificados.enlace(telefono),
      avisar: (telefono, texto) => enviar(telefono, texto, 'agente'),
      ...(conexionSii ? { conectarSii: conexionSii.conectar, estadoSii: conexionSii.estado } : {}),
      ...(opciones.almacenBorradores ? { almacenBorradores: opciones.almacenBorradores } : {}),
      ...(opciones.revisarSiiMs !== undefined ? { revisarSiiMs: opciones.revisarSiiMs } : {}),
      sinCertificado: env.DEMO_PROVEEDOR_SIN_CERTIFICADO === '1',
      ...(opciones.productos ? { productos: opciones.productos } : {}),
    });
  }

  function crearSalaDelAgente(redSala: Parameters<typeof crearSala>[0], t: Partial<TiemposSala>): Sala {
    const tiempos = { ...TIEMPOS_SALA, ...t };
    if (env.SALA_AVISO_ACEPTADA_MS !== undefined && t.avisoAceptadaMs === undefined) {
      tiempos.avisoAceptadaMs = Number(env.SALA_AVISO_ACEPTADA_MS) || 0;
    }
    return crearSala(redSala, {
      ...tiempos,
      interprete,
      log,
      envios: crearEnvios(whatsapp, { concurrencia: tiempos.concurrencia, minimoDifusionMs: tiempos.minimoDifusionMs, log }),
      telefonoProveedor: env.DEMO_TELEFONO_PROVEEDOR || null,
      urlPublica: env.PUBLIC_URL || null,
      ...(opciones.certificados ? { enlaceCertificado: (telefono: string) => opciones.certificados!.enlace(telefono) } : {}),
      ...(opciones.almacenBorradores ? { almacenBorradores: opciones.almacenBorradores } : {}),
      ...(conProveedores ? { alElegirVender: async (telefono: string) => proveedores!.empezar(telefono) } : {}),
      pedirConfirmacion: (proveedor, licitacionId, mensaje) => encolar(proveedor, { tipo: 'facturar_licitacion', licitacionId, mensaje }),
      preguntarRecepcion: async (ordenId, folio) => avisarFacturaDe(await ordenPorId(ordenId), await negociosPorId(), m.preguntaRecepcion(folio)),
    });
  }

  async function avisar(negocio: Negocio, texto: string) {
    await enviar(negocio.telefono, texto, 'agente');
  }

  async function negociosPorId(): Promise<Map<string, Negocio>> {
    const { negocios } = await red.estadoDeLaRed();
    return new Map(negocios.map(n => [n.id, n]));
  }

  async function ordenPorId(ordenId: string): Promise<OrdenCompra> {
    const orden = (await red.estadoDeLaRed()).ordenes.find(o => o.id === ordenId);
    if (!orden) throw new Error(`no existe la orden ${ordenId}`);
    return orden;
  }

  async function avisarFacturaDe(orden: OrdenCompra, negocios: ReadonlyMap<string, Negocio>, mensaje?: string) {
    const comprador = negocios.get(orden.compradorId);
    const proveedor = negocios.get(orden.proveedorId);
    if (!comprador || !proveedor) return;
    // Una sola pregunta por orden aunque la factura se avise por dos caminos (WhatsApp y la sala).
    if (colas.get(comprador.id)?.some(p => p.tipo === 'recepcion' && p.ordenId === orden.id)) return;
    await encolar(comprador, { tipo: 'recepcion', ordenId: orden.id, facturaEn: ahora(), mensaje: mensaje ?? m.llegoFactura(orden, proveedor) });
  }

  async function proponerPedido(comprador: Negocio, producto: string, cantidad: number, elegido?: string): Promise<string> {
    // Se compra en grupo: se suma a la compra abierta de ese producto o se ofrece abrir una (no hay pedidos directos).
    if (red.abrirSolicitud) {
      const r = productoDeLaBiblioteca(comprador, producto, { tipo: 'comprar', cantidad });
      return typeof r === 'string' ? r : proponerSolicitud(comprador, r.nombre, r.unidad ?? 'unidad', cantidad);
    }
    const { negocios } = await red.estadoDeLaRed();
    const candidatos = await Promise.all(
      // Nadie se compra a sí mismo, salvo en la demo con DEMO_COMPRA_A_SI_MISMO=1 (para probar todo con un teléfono).
      negocios.filter(n => puedeVender(n) && (n.id !== comprador.id || env.DEMO_COMPRA_A_SI_MISMO === '1')).map(async n => ({ n, nota: await red.notaDeProveedor(n.id) })),
    );
    if (candidatos.length === 0) return m.SIN_PROVEEDOR;
    // El que eligió la persona; si no eligió, el mejor evaluado, prefiriendo los de la misma comuna.
    candidatos.sort((a, b) => Number(b.n.comuna === comprador.comuna) - Number(a.n.comuna === comprador.comuna) || b.nota - a.nota);
    const elegidoNorm = elegido ? normalizar(elegido) : null;
    const coincide = (nombre: string) => elegidoNorm !== null && (normalizar(nombre).includes(elegidoNorm) || elegidoNorm.includes(normalizar(nombre)));
    const elegidos = elegido ? candidatos.filter(c => coincide(c.n.nombre)) : candidatos;
    if (elegido && elegidos.length === 0) return m.proveedorNoEncontrado(elegido, candidatos.map(c => c.n.nombre));
    const [{ n: proveedor, nota }] = elegidos;
    const mensaje = m.proponerPedido(cantidad, producto, proveedor, nota);
    // Un pedido nuevo reemplaza a otro pedido sin confirmar, pero no a lo que pregunta la contraparte.
    if (actual(comprador.id)?.tipo === 'crear_orden') tomar(comprador.id);
    alFrente(comprador.id, { tipo: 'crear_orden', proveedor, producto, cantidad, mensaje });
    return mensaje;
  }

  /** Si ya hay una compra en grupo abierta de ese producto, propone sumarse a ella; si no, abrir una. */
  async function proponerSolicitud(comprador: Negocio, nombre: string, unidad: string, cantidad: number): Promise<string> {
    const { licitaciones = [] } = await red.estadoDeLaRed();
    const abiertas = licitaciones.filter(l => l.estado === 'abierta' && Date.parse(l.cierraEn) > ahora().getTime());
    await opciones.equivalencias?.aprender({ nombre, unidad }, abiertas.flatMap(productosDe));
    const esLaMisma = (p: { nombre: string; unidad: string }) => mismoNombre(p.nombre, nombre) || !!opciones.equivalencias?.mismo(p, { nombre, unidad });
    const abierta = abiertas.flatMap(l => productosDe(l).filter(esLaMisma).map(p => ({ l, p })))[0];
    if (['crear_orden', 'abrir_solicitud', 'sumarse'].includes(actual(comprador.id)?.tipo ?? '')) tomar(comprador.id);
    if (abierta && red.agregarAlCarrito) {
      const mensaje = m.proponerSumarse(abierta.p, cantidad, abierta.l.cierraEn);
      alFrente(comprador.id, { tipo: 'sumarse', licitacionId: abierta.l.id, productoId: abierta.p.id, producto: abierta.p.nombre, cantidad, mensaje });
      return mensaje;
    }
    // Lo que hoy dan las listas (su propia lista no cuenta, salvo en la demo que deja comprarse a sí mismo).
    const excluir = env.DEMO_COMPRA_A_SI_MISMO === '1' ? undefined : comprador.id;
    const mensaje = m.proponerSolicitud(nombre, cantidad, unidad, opciones.biblioteca?.cotizar?.(nombre, unidad, cantidad, excluir));
    alFrente(comprador.id, { tipo: 'abrir_solicitud', producto: nombre, unidad, cantidad, mensaje });
    return mensaje;
  }

  /**
   * El producto que nombró la persona, contra la biblioteca: si es uno que ya existe (escrito igual o de otra forma),
   * ese; si solo se parece a otros, la pregunta de cuál es (queda pendiente); si no se parece a nada, uno nuevo.
   */
  function productoDeLaBiblioteca(negocio: Negocio, dicho: string, para: ParaProducto): { nombre: string; unidad?: string } | string {
    // Al comprar, "kilos de durazno" se busca como "durazno"; al vender, el nombre queda como lo escribió.
    const escrito = para.tipo === 'comprar' ? sinUnidades(dicho) : dicho;
    const nuevo = { nombre: escrito.charAt(0).toUpperCase() + escrito.slice(1) };
    const parecidos = opciones.biblioteca?.buscar(escrito).slice(0, MAXIMO_OPCIONES) ?? [];
    const igual = parecidos.find(p => mismoNombre(p.nombre, escrito));
    if (igual) return igual;
    // Se compra en grupo solo lo que algún proveedor vende; vender sí crea productos nuevos.
    const puedeCrear = para.tipo === 'vender' || !opciones.biblioteca;
    if (!parecidos.length) return puedeCrear ? nuevo : m.nadieLoVende(escrito);
    const mensaje = m.elegirProducto(escrito, parecidos, puedeCrear);
    if (actual(negocio.id)?.tipo === 'elegir_producto') tomar(negocio.id);
    alFrente(negocio.id, { tipo: 'elegir_producto', escrito, opciones: parecidos, para, mensaje });
    return mensaje;
  }

  /** La respuesta a "¿cuál es?": un número o el nombre de una opción; el último número es "uno nuevo". Undefined: no eligió. */
  function eleccion(p: Extract<Pendiente, { tipo: 'elegir_producto' }>, texto: string): { nombre: string; unidad?: string } | undefined {
    const n = Number(texto.trim().replace(/\.$/, ''));
    if (Number.isInteger(n) && n >= 1 && n <= p.opciones.length) return p.opciones[n - 1];
    const puedeCrear = p.para.tipo === 'vender';
    if (puedeCrear && (n === p.opciones.length + 1 || /\b(otro|nuevo|crear)\b/.test(normalizar(texto)))) return { nombre: p.escrito.charAt(0).toUpperCase() + p.escrito.slice(1) };
    return p.opciones.find(o => mismoNombre(o.nombre, texto));
  }

  /** Sigue lo que se estaba haciendo con el producto ya elegido. */
  async function seguirCon(negocio: Negocio, para: ParaProducto, producto: { nombre: string; unidad?: string }): Promise<string> {
    if (para.tipo === 'comprar') return await proponerSolicitud(negocio, producto.nombre, producto.unidad ?? 'unidad', para.cantidad);
    return proponerAlProveedor(negocio, await proveedores!.proponerProducto(negocio, producto.nombre, producto.unidad ?? para.unidad, para.precio));
  }

  /** Las compras en grupo abiertas que abrió este comprador. */
  async function abiertasPor(comprador: Negocio) {
    const { licitaciones = [] } = await red.estadoDeLaRed();
    return licitaciones.filter(l => l.estado === 'abierta' && l.iniciadaPor === comprador.id);
  }

  /** "cerrar la compra": quien abrió una compra en grupo la cierra antes, con un paso de confirmación. */
  async function proponerCierre(comprador: Negocio, texto: string): Promise<string> {
    const suyas = await abiertasPor(comprador);
    if (!suyas.length) return m.SIN_COMPRA_PARA_CERRAR;
    const dicho = normalizar(texto);
    const nombradas = suyas.filter(l => nombraProducto(dicho, l.producto));
    const elegidas = TODAS.test(dicho) ? suyas : nombradas.length ? nombradas : suyas.length === 1 ? suyas : null;
    if (elegidas) return proponerCierreDe(comprador, elegidas);
    const opcionesCierre = suyas.map(l => ({ id: l.id, producto: l.producto }));
    const mensaje = m.cualCerrar(opcionesCierre.map(o => o.producto));
    if (actual(comprador.id)?.tipo === 'elegir_cierre') tomar(comprador.id);
    alFrente(comprador.id, { tipo: 'elegir_cierre', opciones: opcionesCierre, mensaje });
    return mensaje;
  }

  /** La respuesta a "¿cuál cierro?": el número de un botón, el producto o "todas". */
  async function elegirCierre(comprador: Negocio, p: Extract<Pendiente, { tipo: 'elegir_cierre' }>, texto: string): Promise<string | null> {
    const dicho = normalizar(texto);
    const n = Number(dicho);
    const ids = TODAS.test(dicho) || n === p.opciones.length + 1 ? p.opciones.map(o => o.id)
      : Number.isInteger(n) && n >= 1 && n <= p.opciones.length ? [p.opciones[n - 1]!.id]
      : p.opciones.filter(o => nombraProducto(dicho, o.producto)).map(o => o.id);
    if (!ids.length) return null;
    tomar(comprador.id);
    const suyas = (await abiertasPor(comprador)).filter(l => ids.includes(l.id));
    return suyas.length ? proponerCierreDe(comprador, suyas) : m.SIN_COMPRA_PARA_CERRAR;
  }

  /** Propone cerrar las que ya se pueden (con oferta y el mínimo del que gana) y dice por qué no las otras. */
  function proponerCierreDe(comprador: Negocio, elegidas: readonly LicitacionSala[]): string {
    const listas = elegidas.filter(l => { const p = productosDe(l)[0]!; return puedeCerrarAntes(p.ofertas, p.totalUnidades); });
    const porque = elegidas.filter(l => !listas.includes(l)).map(l => {
      const p = productosDe(l)[0]!;
      return m.todaviaNoSeCierra(l.producto, mejorOferta(p.ofertas, p.totalUnidades)?.minimo, p.totalUnidades);
    });
    if (!listas.length) return porque.join('\n');
    const [una] = listas;
    const p = productosDe(una!)[0]!;
    const pregunta = listas.length === 1
      ? m.proponerCierre(una!.producto, una!.participantes.length, p.totalUnidades, p.precioActual, p.unidad)
      : m.proponerCierreVarias(listas.map(l => l.producto));
    const mensaje = porque.length ? `${porque.join('\n')}\n\n${pregunta}` : pregunta;
    if (actual(comprador.id)?.tipo === 'cerrar_antes') tomar(comprador.id);
    alFrente(comprador.id, { tipo: 'cerrar_antes', licitacionIds: listas.map(l => l.id), productos: listas.map(l => l.producto), mensaje });
    return mensaje;
  }

  /** Las compras en grupo abiertas en que está este comprador, de la más nueva a la más vieja. */
  async function enLasQueEsta(comprador: Negocio) {
    const { licitaciones = [] } = await red.estadoDeLaRed();
    const abiertas = licitaciones.filter(l => l.estado === 'abierta');
    return { abiertas, suyas: abiertas.filter(l => l.participantes.some(p => p.negocioId === comprador.id)).reverse() };
  }

  /** "mis compras": en cuáles está, cuánto lleva, a cuánto y cuándo cierra cada una. */
  async function misCompras(comprador: Negocio): Promise<string> {
    const { suyas } = await enLasQueEsta(comprador);
    return m.misCompras(suyas.flatMap(l => {
      const yo = l.participantes.find(p => p.negocioId === comprador.id)!;
      return itemsDe(yo, l).flatMap(i => {
        const p = productosDe(l).find(x => x.id === i.productoId);
        return p ? [{ producto: p.nombre, unidad: p.unidad, ...(p.unidadPlural ? { unidadPlural: p.unidadPlural } : {}), lleva: i.cantidad, precio: p.ofertas?.length ? p.precioActual : null, cierraEn: l.cierraEn, abriste: l.iniciadaPor === comprador.id }] : [];
      });
    }), ahora());
  }

  /**
   * "solo 150 coca colas", "quita 20", "salir de la compra de coca cola": cambia lo que lleva en la compra que nombra.
   * Solo cuando la sala no basta (está en varias, o la suya no es la más nueva): la sala cambia la más nueva.
   * Undefined: no es un cambio de cantidad, o lo atiende la sala.
   */
  async function proponerCambioDeCantidad(comprador: Negocio, texto: string): Promise<string | undefined> {
    const dicho = normalizar(texto);
    const n = cantidadDicha(texto);
    const salir = SALIR_DE.test(dicho);
    const modo = salir ? 'salir' : n === null ? null : FIJAR.test(dicho) ? 'fijar' : SUMAR.test(dicho) ? 'sumar' : RESTAR.test(dicho) ? 'restar' : null;
    if (!modo) return undefined;
    const { abiertas, suyas } = await enLasQueEsta(comprador);
    if (!suyas.length || (suyas.length === 1 && suyas[0] === abiertas.at(-1))) return undefined;
    const nombradas = suyas.filter(l => productosDe(l).some(p => nombraProducto(dicho, p.nombre)));
    const l = nombradas.length === 1 ? nombradas[0]! : suyas.length === 1 ? suyas[0]! : null;
    if (!l) return m.cualCompra(suyas.map(x => x.producto));
    const yo = l.participantes.find(p => p.negocioId === comprador.id)!;
    const items = itemsDe(yo, l);
    const p = productosDe(l).find(x => nombraProducto(dicho, x.nombre) && items.some(i => i.productoId === x.id))
      ?? productosDe(l).find(x => x.id === items[0]?.productoId)!;
    const lleva = items.find(i => i.productoId === p.id)?.cantidad ?? 0;
    const nueva = modo === 'salir' ? 0 : modo === 'fijar' ? n! : modo === 'sumar' ? Math.min(CANTIDAD_MAXIMA, lleva + n!) : Math.max(0, lleva - n!);
    const mensaje = m.proponerCambio(p.nombre, p.unidad, p.unidadPlural, lleva, nueva);
    if (actual(comprador.id)?.tipo === 'cambiar_cantidad') tomar(comprador.id);
    alFrente(comprador.id, {
      tipo: 'cambiar_cantidad', licitacionId: l.id, productoId: p.id, producto: p.nombre, unidad: p.unidad,
      ...(p.unidadPlural ? { unidadPlural: p.unidadPlural } : {}), cantidad: nueva, mensaje,
    });
    return mensaje;
  }

  async function proponerConfirmacion(proveedor: Negocio): Promise<string> {
    const { ordenes, negocios } = await red.estadoDeLaRed();
    const nuevas = ordenes.filter(o => o.proveedorId === proveedor.id && o.estado === 'enviada');
    if (nuevas.length === 0) return m.SIN_PEDIDOS;
    const mensaje = m.pedidosNuevos(nuevas, new Map(negocios.map(n => [n.id, n])));
    if (actual(proveedor.id)?.tipo === 'confirmar_ordenes') tomar(proveedor.id);
    alFrente(proveedor.id, { tipo: 'confirmar_ordenes', ordenIds: nuevas.map(o => o.id), mensaje });
    return mensaje;
  }

  /** Ejecuta una acción ya confirmada con un sí. */
  async function ejecutar(negocio: Negocio, p: Pendiente): Promise<string> {
    switch (p.tipo) {
      case 'elegir_producto':
        return m.noEntendi(p.mensaje);
      case 'sumarse': {
        const { licitaciones = [] } = await red.estadoDeLaRed();
        const lleva = licitaciones.find(l => l.id === p.licitacionId)?.participantes.find(x => x.negocioId === negocio.id)
          ?.items?.find(i => i.productoId === p.productoId)?.cantidad ?? 0;
        await red.agregarAlCarrito!(p.licitacionId, { negocioId: negocio.id, productoId: p.productoId, cantidad: lleva + p.cantidad });
        return m.sumadoAOtraCompra(p.producto, lleva + p.cantidad);
      }
      case 'cerrar_antes': {
        let pedidos = 0;
        for (const id of p.licitacionIds) pedidos += (await red.cerrarAntes!(id, negocio.id)).length;
        return m.compraCerradaAntes(p.productos, pedidos);
      }
      case 'elegir_cierre':
        return m.noEntendi(p.mensaje);
      case 'cambiar_cantidad':
        await red.agregarAlCarrito!(p.licitacionId, { negocioId: negocio.id, productoId: p.productoId, cantidad: p.cantidad });
        return m.cantidadCambiada(p.producto, p.unidad, p.unidadPlural, p.cantidad);
      case 'abrir_solicitud': {
        const l = await red.abrirSolicitud!({ compradorId: negocio.id, producto: p.producto, unidad: p.unidad, cantidad: p.cantidad });
        return m.solicitudAbierta(p.producto, p.cantidad, l.cierraEn);
      }
      case 'crear_orden': {
        const orden = await red.crearOrden({
          compradorId: negocio.id, proveedorId: p.proveedor.id, items: [{ producto: p.producto, cantidad: p.cantidad }],
        });
        await encolar(p.proveedor, {
          tipo: 'confirmar_ordenes', ordenIds: [orden.id], mensaje: m.pedidosNuevos([orden], new Map([[negocio.id, negocio]])),
        });
        return m.ordenEnviada(orden, p.proveedor);
      }
      case 'confirmar_ordenes': {
        const confirmadas: OrdenCompra[] = [];
        for (const id of p.ordenIds) confirmadas.push(await red.confirmarOrden(id));
        const negocios = await negociosPorId();
        for (const orden of confirmadas) await avisarFacturaDe(orden, negocios);
        return m.facturasEmitidas(confirmadas, negocios);
      }
      case 'recepcion': {
        const orden = await red.registrarRecepcion(p.ordenId, { conforme: true });
        const proveedor = (await negociosPorId()).get(orden.proveedorId);
        return proveedor ? m.recepcionConforme(proveedor) : 'Listo, quedó recibida conforme.';
      }
      case 'reclamar': {
        const antes = await ordenPorId(p.ordenId);
        const notaAntes = await red.notaDeProveedor(antes.proveedorId);
        const orden = await red.registrarRecepcion(p.ordenId, { faltante: p.faltante });
        const notaDespues = await red.notaDeProveedor(orden.proveedorId);
        const { negocios, ordenes } = await red.estadoDeLaRed();
        const proveedor = negocios.find(n => n.id === orden.proveedorId);
        if (!proveedor) throw new Error('no encontré al proveedor');
        const clientes = new Set(ordenes.filter(o => o.proveedorId === proveedor.id).map(o => o.compradorId)).size;
        const monto = p.faltante * orden.items[0].precioUnitario;
        await encolar(proveedor, {
          tipo: 'nota_credito', ordenId: orden.id, faltante: p.faltante, monto, reclamoEn: ahora(),
          mensaje: m.avisoReclamo(orden, negocio, p.faltante, monto),
        });
        const diasPlazo = PLAZO_RECLAMO_DIAS - Math.floor((ahora().getTime() - p.facturaEn.getTime()) / DIA_MS);
        return m.reclamoRegistrado({ proveedor, diasPlazo, notaAntes, notaDespues, clientes });
      }
      case 'nota_credito': {
        const notaAntes = await red.notaDeProveedor(negocio.id);
        await red.emitirNotaCredito(p.ordenId);
        const notaDespues = await red.notaDeProveedor(negocio.id);
        const orden = await ordenPorId(p.ordenId);
        const comprador = (await negociosPorId()).get(orden.compradorId);
        if (!comprador) throw new Error('no encontré al comprador');
        await avisar(comprador, m.avisoNotaCredito(negocio, p.monto, p.faltante));
        const mismoDia = ahora().toDateString() === p.reclamoEn.toDateString();
        return m.notaCreditoEmitida({ comprador, mismoDia, notaAntes, notaDespues });
      }
      case 'facturar_licitacion':
        if (!sala) throw new Error('la red no tiene compra conjunta');
        return sala.facturar(p.licitacionId, negocio.id);
      case 'proveedor':
        if (!proveedores) throw new Error('la red no tiene proveedores por WhatsApp');
        return proveedores.ejecutar(negocio, p.propuesta);
    }
  }

  async function confirmar(negocio: Negocio): Promise<string> {
    const p = tomar(negocio.id); // se saca antes de ejecutar: idempotencia ante un "sí" repetido
    if (!p) return (await reproponerFacturacion(negocio)) ?? m.NADA_PENDIENTE;
    try {
      return await ejecutar(negocio, p);
    } catch (error) {
      log.error('[agente] falló la acción', p.tipo, error instanceof Error ? error.message : error);
      alFrente(negocio.id, p);
      return m.fallo(error);
    }
  }

  async function responder(negocio: Negocio, intencion: Intencion): Promise<string> {
    const p = actual(negocio.id);
    switch (intencion.tipo) {
      case 'pedir':
        return puedeComprar(negocio) ? proponerPedido(negocio, intencion.producto, intencion.cantidad, intencion.proveedor) : m.AYUDA_PROVEEDOR;
      case 'ver_pedidos':
        return puedeVender(negocio) ? proponerConfirmacion(negocio) : m.AYUDA_COMPRADOR;
      case 'ser_proveedor':
      case 'ofertar':
      case 'crear_producto':
      case 'ver_ofertas':
        return responderComoProveedor(negocio, intencion);
      case 'si':
      case 'conforme':
        if (intencion.tipo === 'conforme' && p?.tipo !== 'recepcion') return p ? m.noEntendi(p.mensaje) : m.NADA_PENDIENTE;
        return confirmar(negocio);
      case 'no':
        if (!p) return m.NADA_PENDIENTE;
        if (p.tipo === 'recepcion') return m.CUANTOS_FALTARON;
        tomar(negocio.id);
        return m.CANCELADO;
      case 'faltante': {
        if (p?.tipo !== 'recepcion' && p?.tipo !== 'reclamar') return p ? m.noEntendi(p.mensaje) : m.NADA_PENDIENTE;
        const orden = await ordenPorId(p.ordenId);
        tomar(negocio.id);
        alFrente(negocio.id, {
          tipo: 'reclamar', ordenId: p.ordenId, faltante: intencion.cantidad, facturaEn: p.facturaEn,
          mensaje: m.proponerReclamo(orden, intencion.cantidad),
        });
        return actual(negocio.id)!.mensaje;
      }
      case 'respuesta':
        return intencion.texto;
      case 'otro':
        if (p) return m.noEntendi(p.mensaje);
        return ayudaDe(negocio);
    }
  }

  const ayudaDe = (n: Negocio) => (puedeVender(n) ? (puedeComprar(n) ? m.AYUDA_COMPRA_Y_VENDE : m.AYUDA_PROVEEDOR) : m.AYUDA_COMPRADOR);

  /** Vender: quien aún no vende parte su registro; quien vende arma la oferta o el producto para confirmar con un sí. */
  async function responderComoProveedor(negocio: Negocio, intencion: Intencion): Promise<string> {
    if (!proveedores) return ayudaDe(negocio);
    if (!puedeVender(negocio)) return proveedores.empezar(negocio.telefono);
    let propuesta: PropuestaProveedor | string;
    switch (intencion.tipo) {
      case 'ofertar': propuesta = await proveedores.proponerOferta(negocio, intencion.precio, intencion.producto); break;
      case 'crear_producto': {
        const r = productoDeLaBiblioteca(negocio, intencion.nombre, { tipo: 'vender', unidad: intencion.unidad, precio: intencion.precio });
        if (typeof r === 'string') return r;
        propuesta = await proveedores.proponerProducto(negocio, r.nombre, r.unidad ?? intencion.unidad, intencion.precio, intencion.stock);
        break;
      }
      case 'ver_ofertas': return proveedores.verOfertas(negocio);
      default: return `Ya vendes en Bando ✓ ${m.AYUDA_PROVEEDOR}`;
    }
    return proponerAlProveedor(negocio, propuesta);
  }

  function proponerAlProveedor(negocio: Negocio, propuesta: PropuestaProveedor | string): string {
    if (typeof propuesta === 'string') return propuesta;
    // Una oferta o un producto nuevo reemplaza a otro sin confirmar, pero no a lo que pregunta la contraparte.
    if (actual(negocio.id)?.tipo === 'proveedor') tomar(negocio.id);
    alFrente(negocio.id, { tipo: 'proveedor', propuesta, mensaje: propuesta.mensaje });
    return propuesta.mensaje;
  }

  /** El proveedor dijo "todavía no" a facturar la compra conjunta y ahora dice que sí: se le vuelve a preguntar. */
  async function reproponerFacturacion(negocio: Negocio): Promise<string | null> {
    const pendiente = puedeVender(negocio) ? sala?.pendienteDeFacturar(negocio.id) : null;
    if (!pendiente) return null;
    const p: Pendiente = { tipo: 'facturar_licitacion', licitacionId: pendiente.licitacionId, mensaje: pendiente.mensaje };
    // Facturada desde el panel, la sala no se entera: no se vuelve a preguntar.
    if (!vigente(p, await red.estadoDeLaRed())) return null;
    alFrente(negocio.id, p);
    return pendiente.mensaje;
  }

  /** Con la capa de IA (server/ia/), el intérprete recibe contexto y puede responder; si no, solo clasifica. */
  async function entender(negocio: Negocio, telefono: string, texto: string, pendiente: string | null): Promise<Intencion> {
    // Un botón apretado ("1", "2") no necesita a Claude: las reglas lo entienden al instante.
    if (!interprete.conversar || /^\d$/.test(texto)) return interprete.interpretar(texto, pendiente);
    const { id, nombre, comuna, rol, vende } = negocio;
    return interprete.conversar({ negocio: { id, nombre, comuna, rol, ...(vende ? { vende } : {}) }, texto, historial: await historialDe(telefono, texto), pendiente });
  }

  async function historialDe(telefono: string, texto: string) {
    const mensajes = whatsapp.history ? await whatsapp.history(telefono, { limit: 11 }).catch(() => []) : [];
    const ultimo = mensajes.at(-1);
    // El mensaje que se está atendiendo ya quedó guardado: no se repite como historia.
    const previos = ultimo?.direction === 'in' && ultimo.text === texto ? mensajes.slice(0, -1) : mensajes;
    return previos.slice(-10).map(msg => ({ de: msg.direction === 'in' ? 'persona' as const : 'bando' as const, texto: msg.text }));
  }

  async function atender(telefono: string, texto: string, contexto: { reply(body: string): Promise<unknown> }) {
    // Las respuestas con opciones salen como botones; el resto, como respuesta normal.
    const ctx = { reply: (body: string) => (whatsapp.send && aInteractivo(body) ? enviar(telefono, body, 'reply') : contexto.reply(body)) };
    // "conectar certificado" funciona en cualquier momento, registrado o no.
    if (opciones.certificados && /\b(conectar (mi )?(sii|certificado)|certificado digital)\b/.test(normalizar(texto))) {
      await ctx.reply(m.enlaceCertificado(opciones.certificados.enlace(telefono)));
      return;
    }
    // Registrándose como proveedor: todo lo que escriba es de ese registro hasta terminar o cancelar.
    if (proveedores?.registrando(telefono)) {
      await ctx.reply(await proveedores.atenderRegistro(telefono, texto));
      return;
    }
    const aviso = (await opciones.avisos?.atender(telefono, texto)) ?? null;
    if (aviso && 'respuesta' in aviso) {
      await ctx.reply(aviso.respuesta);
      return;
    }
    const negocio = (await red.negocioPorTelefono(telefono)) ?? sala?.proveedorPorTelefono(telefono) ?? null;
    if (negocio) await depurar(negocio.id);
    // SÍ a un aviso de compra abierta: se suma con el flujo de siempre de la sala, si no hay otra pregunta en curso.
    if (aviso && sala && !(negocio && actual(negocio.id))) {
      await ctx.reply(await sala.atenderPublico(telefono, 'me sumo', negocio?.nombre ?? aviso.sumarse));
      return;
    }
    if (!negocio) {
      const quiereVender = proveedores && ['ser_proveedor', 'crear_producto'].includes(interpretarConReglas(texto).tipo);
      await ctx.reply(quiereVender ? proveedores!.empezar(telefono) : sala ? await sala.atenderPublico(telefono, texto) : m.NO_REGISTRADO);
      return;
    }
    // "cerrar la compra": quien abrió una compra en grupo la cierra antes (igual que en la web).
    if (red.cerrarAntes && puedeComprar(negocio) && CERRAR_COMPRA.test(normalizar(texto))) {
      await ctx.reply(await proponerCierre(negocio, texto));
      return;
    }
    const antes = actual(negocio.id);
    // Respondió a "¿cuál cierro?" con un botón, el producto o "todas".
    const cierre = antes?.tipo === 'elegir_cierre' ? await elegirCierre(negocio, antes, texto) : null;
    if (cierre) {
      await ctx.reply(cierre);
      return;
    }
    // "mis compras" y cambiar lo que lleva en una de varias compras en grupo (sin otra pregunta en curso).
    if (puedeComprar(negocio) && !antes) {
      const respuesta = MIS_COMPRAS.test(normalizar(texto)) ? await misCompras(negocio)
        : red.agregarAlCarrito ? await proponerCambioDeCantidad(negocio, texto) : undefined;
      if (respuesta) {
        await ctx.reply(respuesta);
        return;
      }
    }
    // A "¿abro la compra con tus 1?" o "¿te sumo con 5?" responde otra cantidad: con un sí, se hace con esa; si no, se vuelve a proponer.
    const otraCantidad = antes?.tipo === 'abrir_solicitud' || antes?.tipo === 'sumarse' ? cantidadDicha(texto) : null;
    if (otraCantidad && (antes?.tipo === 'abrir_solicitud' || antes?.tipo === 'sumarse')) {
      tomar(negocio.id);
      const propuesta = await proponerSolicitud(negocio, antes.producto, antes.tipo === 'abrir_solicitud' ? antes.unidad : 'unidad', otraCantidad);
      await ctx.reply(AFIRMA.test(normalizar(texto)) ? await confirmar(negocio) : propuesta);
      return;
    }
    // Respondió a "¿cuál es?" con un número o el nombre: sigue con ese producto.
    const elegido = antes?.tipo === 'elegir_producto' ? eleccion(antes, texto) : undefined;
    if (antes?.tipo === 'elegir_producto' && elegido) {
      tomar(negocio.id);
      await ctx.reply(await seguirCon(negocio, antes.para, elegido));
      return;
    }
    // "tengo 200 impresoras": un proveedor declara el stock de un producto de su lista.
    const stock = proveedores && puedeVender(negocio) && !antes ? leerStock(texto) : null;
    if (stock) {
      await ctx.reply(await proveedores!.fijarStock(negocio, stock.cantidad, stock.producto));
      return;
    }
    const entendida = await entender(negocio, telefono, texto, antes?.mensaje ?? null);
    // "vendo ... a $15.000, tengo 200": el stock va con el producto aunque el intérprete no lo haya leído.
    const stockDicho = entendida.tipo === 'crear_producto' && entendida.stock === undefined ? stockEnTexto(texto) : undefined;
    const intencion: Intencion = stockDicho !== undefined && entendida.tipo === 'crear_producto' ? { ...entendida, stock: stockDicho } : entendida;
    // Un comprador registrado también arma su pedido en la compra conjunta, si no hay otra cosa en curso.
    // Quien se suma por WhatsApp queda registrado en la red: "sí", "no" o "2 del 3" también son de la sala.
    // Un pedido de un producto de la canasta ("quiero 3 cajas más") es de la sala aunque se lea como pedido.
    const pideDeLaCanasta = sala !== null && intencion.tipo === 'pedir' && (await sala.hablaDeLaCanasta(intencion.producto));
    const deLaSala = sala && !antes && puedeComprar(negocio) && intencion.tipo !== 'faltante' && !DE_PROVEEDOR.has(intencion.tipo)
      && (pideDeLaCanasta || intencion.tipo !== 'pedir');
    // Si la IA ya respondió una pregunta, la sala solo la toma si es una acción suya (no "¿cuántas le compré a X?").
    const paraLaSala = intencion.tipo !== 'respuesta' || (sala !== null && (await sala.entiende(telefono, texto)));
    if (sala && deLaSala && paraLaSala && (pideDeLaCanasta || (await sala.atiende(telefono, negocio.id, texto)))) {
      await ctx.reply(await sala.atenderPublico(telefono, texto, negocio.nombre));
      return;
    }
    const respuesta = await responder(negocio, intencion);
    await ctx.reply(respuesta);
    // Si se resolvió lo que se preguntaba y asomó algo que esperaba en la cola, se pregunta ahora.
    await depurar(negocio.id);
    const siguiente = actual(negocio.id);
    if (siguiente && siguiente !== antes && siguiente.mensaje !== respuesta) await ctx.reply(siguiente.mensaje);
  }

  // Mensajes de un mismo teléfono, en orden y de a uno; teléfonos distintos, en paralelo.
  const filas = new Map<string, Promise<void>>();
  function enFila(telefono: string, tarea: () => Promise<void>): Promise<void> {
    const siguiente = (filas.get(telefono) ?? Promise.resolve()).then(tarea);
    filas.set(telefono, siguiente);
    void siguiente.then(() => { if (filas.get(telefono) === siguiente) filas.delete(telefono); });
    return siguiente;
  }
  // Lo que cada teléfono llevaba a medias antes de un reinicio: se recupera antes de atender el primer mensaje.
  const cargado = Promise.all([sala?.cargar(), proveedores?.cargar(), cargarColas()]).catch(error => log.error('[agente] no se pudieron recuperar los borradores', error));
  const desconectar = whatsapp.onMessage((mensaje, ctx) => {
    const telefono = mensaje.from;
    return enFila(telefono, async () => {
      try {
        await cargado;
        await ctx.markRead({ typing: true });
        // Un botón nuestro llega con su id ("1", "2"): se atiende como si hubiera escrito ese número.
        const boton = mensaje.content.kind === 'reply' && /^\d$/.test(mensaje.content.id) ? mensaje.content.id : null;
        await atender(telefono, boton ?? mensaje.text, ctx);
      } catch (error) {
        log.error(`[agente] falló el mensaje de ${enmascarar(telefono)}:`, error instanceof Error ? error.message : error);
        await ctx.reply(m.ERROR_TEMPORAL);
      }
    });
  });

  return {
    async avisarFactura(ordenId) {
      await avisarFacturaDe(await ordenPorId(ordenId), await negociosPorId());
    },
    certificadoConectado(telefono, rut) {
      return enFila(telefono, async () => {
        const ctx = { reply: (body: string) => enviar(telefono, body, 'reply') };
        try {
          await cargado;
          // Registrándose como proveedor: sigue con el RUT con que factura.
          const comoProveedor = proveedores?.certificadoConectado(telefono, rut);
          if (comoProveedor) return void (await enviar(telefono, comoProveedor, 'agente'));
          await enviar(telefono, m.CERTIFICADO_CONECTADO, 'agente');
          if (sala?.esperaRut(telefono)) await atender(telefono, rut, ctx);
        } catch (error) {
          log.error(`[agente] falló seguir el registro de ${enmascarar(telefono)}:`, error instanceof Error ? error.message : error);
          await ctx.reply(m.ERROR_TEMPORAL);
        }
      });
    },
    desconectar() {
      desconectar();
      sala?.detener();
      proveedores?.detener();
    },
  };
}

function interpreteDesdeEnv(env: NodeJS.ProcessEnv): Interprete {
  if (!env.ANTHROPIC_API_KEY) {
    console.warn('[agente] sin ANTHROPIC_API_KEY: interpreto mensajes con reglas fijas');
    return interpreteDeReglas;
  }
  return crearInterpreteClaude(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || 'claude-sonnet-5-5');
}
