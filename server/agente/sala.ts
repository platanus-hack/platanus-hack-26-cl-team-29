// "La sala compra junta": el público se suma a una compra conjunta escribiendo al número de la demo.
//   desconocido --(mensaje)--> bienvenida + "¿cómo se llama tu negocio y cuántas cajas?"
//               --(nombre y cantidad, en uno o dos mensajes)--> se suma (sin efecto legal, no pide sí)
//   cada baja de precio --> difusión a todos los participantes (agrupada y con freno por teléfono);
//                           si bajó por ofertas de proveedores que compiten, dice quién ofertó y quién respondió
//   cierre --> pregunta al proveedor; solo con su sí se facturan todas en el SII
//   cada factura emitida --> el comprador recibe su folio
import type { Interprete, DatosSala, UnidadSala } from './intencion.ts';
import { interpretarSalaConReglas } from './intencion.ts';
import type { Documento, EventoDeLaRed, LicitacionSala, Negocio, OrdenCompra, Red, RedSala } from './puerto.ts';
import type { Envios, Log } from './envios.ts';
import { claveTelefono, enmascarar } from './envios.ts';
import * as m from './mensajes.ts';

export interface OpcionesSala {
  readonly interprete: Interprete;
  readonly envios: Envios;
  readonly log: Log;
  /** Teléfono del proveedor si la red no lo resuelve (DEMO_TELEFONO_PROVEEDOR). */
  readonly telefonoProveedor: string | null;
  /** Para "También puedes sumarte en <url>/app" (PUBLIC_URL). */
  readonly urlPublica: string | null;
  readonly cantidadMaxima: number;
  /** Bajas de precio dentro de esta ventana salen como una sola difusión (la última). */
  readonly ventanaCascadaMs: number;
  /** Cada cuánto revisar si ya pasó `cierraEn`; 0 desactiva. */
  readonly vigilarCierreMs: number;
  /** "El SII aceptó tu factura" solo si el veredicto llega dentro de este plazo desde el folio; 0 desactiva. */
  readonly avisoAceptadaMs: number;
  /** Deja la pregunta de facturar en la cola de confirmaciones del agente. */
  pedirConfirmacion(proveedor: Negocio, licitacionId: string, mensaje: string): Promise<void>;
}

export interface Sala {
  /** El proveedor de una compra cerrada, si escribe desde un teléfono que la red no conoce. */
  proveedorPorTelefono(telefono: string): Negocio | null;
  participa(telefono: string): boolean;
  /** Responde a alguien del público (o a un comprador registrado que quiere sumarse). */
  atenderPublico(telefono: string, texto: string, nombreConocido?: string): Promise<string>;
  /** Ejecuta la facturación ya confirmada por el proveedor. Idempotente. */
  facturar(licitacionId: string): Promise<string>;
  /** Si el proveedor dijo "todavía no" y luego escribe "sí": la pregunta para volver a hacerla. */
  pendienteDeFacturar(negocioId: string): { readonly licitacionId: string; readonly mensaje: string } | null;
  detener(): void;
}

interface Participacion { telefono: string; nombre: string; cantidad: number; licitacionId: string }
interface Borrador { nombre?: string; cantidad?: number; pregunta: string }
interface OrdenDeSala { orden: OrdenCompra; precioSolo: number; licitacion: LicitacionSala; telefono: string | null }

export function crearSala(red: Red & RedSala, o: OpcionesSala): Sala {
  const participantes = new Map<string, Participacion>();
  const borradores = new Map<string, Borrador>();
  const proveedores = new Map<string, Negocio>();
  const ordenesDeSala = new Map<string, OrdenDeSala>();
  const porFacturar = new Map<string, { licitacionId: string; mensaje: string }>();
  const cerradasAvisadas = new Set<string>();
  const facturadas = new Map<string, Promise<string>>();
  const foliosAvisados = new Map<string, { telefono: string; en: number; folio: number }>();
  let ultimaConocida: LicitacionSala | null = null;
  let ultimaBaja: { licitacionId: string; precioNuevo: number } | null = null;
  /** Ofertas de proveedores desde la última difusión: explican por qué bajó (las últimas 3). */
  let ofertasRecientes: (m.OfertaSala & { licitacionId: string })[] = [];
  let timerCascada: ReturnType<typeof setTimeout> | null = null;

  async function abierta(): Promise<LicitacionSala | null> {
    const l = await red.licitacionAbierta();
    if (l) ultimaConocida = l;
    return l;
  }

  const unidad = (l: LicitacionSala): UnidadSala => ({ singular: l.unidad, plural: m.unidadDe(l, 2), maximo: o.cantidadMaxima });

  async function leer(texto: string, pregunta: string, l: LicitacionSala): Promise<DatosSala> {
    const reglas = interpretarSalaConReglas(texto, unidad(l));
    if (reglas.claro || !o.interprete.interpretarSala) return reglas;
    return o.interprete.interpretarSala(texto, pregunta, unidad(l));
  }

  async function sumar(telefono: string, nombre: string, cantidad: number, l: LicitacionSala): Promise<string> {
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > o.cantidadMaxima) {
      const pregunta = m.cantidadFueraDeRango(o.cantidadMaxima, l);
      borradores.set(claveTelefono(telefono), { nombre, pregunta });
      return pregunta;
    }
    const clave = claveTelefono(telefono);
    const antes = participantes.get(clave);
    let r;
    try {
      r = await red.unirseALicitacion(l.id, { telefono, nombre, cantidad });
    } catch (error) {
      if (!(await abierta())) return m.SIN_COMPRA_ABIERTA;
      throw error;
    }
    participantes.set(clave, { telefono, nombre, cantidad, licitacionId: l.id });
    borradores.delete(clave);
    ultimaConocida = r.licitacion;
    o.log.info(`[sala] ${enmascarar(telefono)} ${antes ? 'cambió a' : 'se sumó con'} ${cantidad}; total ${r.licitacion.totalUnidades} a ${r.precioActual}`);
    return m.unidoSala(nombre, cantidad, r.licitacion, Boolean(antes && antes.licitacionId === l.id));
  }

  async function atenderPublico(telefono: string, texto: string, nombreConocido?: string): Promise<string> {
    const clave = claveTelefono(telefono);
    const yo = participantes.get(clave);
    const l = await abierta();
    if (!l) return yo ? m.COMPRA_CERRADA : m.SIN_COMPRA_ABIERTA;

    if (yo && yo.licitacionId === l.id) {
      const datos = await leer(texto, m.estadoParticipante(yo.nombre, yo.cantidad, l), l);
      if (datos.dudaUnidad) return m.preguntarUnidadSala(l);
      if (datos.cantidad === undefined) return m.estadoParticipante(yo.nombre, yo.cantidad, l);
      return sumar(telefono, datos.nombre ?? yo.nombre, datos.cantidad, l);
    }

    const borrador = borradores.get(clave);
    const datos = await leer(texto, borrador?.pregunta ?? m.preguntaSala(l), l);
    const nombre = datos.nombre ?? borrador?.nombre ?? nombreConocido;
    const cantidad = datos.cantidad ?? borrador?.cantidad;
    if (nombre && cantidad !== undefined) return sumar(telefono, nombre, cantidad, l);

    const pregunta = datos.dudaUnidad ? m.preguntarUnidadSala(l)
      : nombre ? m.pedirCantidadSala(nombre, l)
      : cantidad !== undefined ? m.pedirNombreSala(cantidad, l)
      : m.preguntaSala(l);
    borradores.set(clave, { ...(nombre ? { nombre } : {}), ...(cantidad !== undefined ? { cantidad } : {}), pregunta });
    if (!borrador) o.log.info(`[sala] ${enmascarar(telefono)} llegó a la compra conjunta`);
    return borrador ? pregunta : m.bienvenidaSala(l, pregunta, o.urlPublica);
  }

  // --- Cascada de precios ---

  /** Los que se sumaron por este agente y, tras un reinicio, los que la red conoce por su negocio. */
  async function telefonosDe(l: LicitacionSala): Promise<string[]> {
    const conocidos = [...participantes.values()].filter(p => p.licitacionId === l.id).map(p => p.telefono);
    const desdeRed = await Promise.all(l.participantes.map(async p =>
      p.telefono ?? (p.negocioId ? await red.telefonoDeNegocio(p.negocioId) : null)));
    return [...conocidos, ...desdeRed.filter((t): t is string => Boolean(t))];
  }

  async function difundirBaja() {
    timerCascada = null;
    const baja = ultimaBaja;
    const ofertas = ofertasRecientes;
    ultimaBaja = null;
    ofertasRecientes = [];
    if (!baja) return;
    const l = await abierta();
    if (!l || l.id !== baja.licitacionId) return; // ya cerró: la baja no importa
    const porque = ofertas.filter(x => x.licitacionId === l.id).slice(-3);
    await o.envios.difundir(await telefonosDe(l), m.bajoPrecio(baja.precioNuevo, l, porque), 'baja de precio');
  }

  function alBajarPrecio(datos: { licitacionId: string; precioNuevo: number }) {
    ultimaBaja = { licitacionId: datos.licitacionId, precioNuevo: datos.precioNuevo };
    if (timerCascada) return;
    timerCascada = setTimeout(() => { difundirBaja().catch(e => o.log.error('[sala] falló la difusión', mensajeDe(e))); }, o.ventanaCascadaMs);
    timerCascada.unref?.();
  }

  function alOfertar(datos: { licitacionId?: string; oferta?: Partial<m.OfertaSala>; mejor?: boolean }) {
    const { licitacionId, oferta, mejor } = datos;
    if (!mejor || !licitacionId || !oferta?.proveedorNombre || typeof oferta.precioUnitario !== 'number') return;
    ofertasRecientes.push({ licitacionId, proveedorNombre: oferta.proveedorNombre, precioUnitario: oferta.precioUnitario });
  }

  // --- Cierre y facturación ---

  async function proveedorDe(proveedorId: string): Promise<Negocio | null> {
    const negocio = (await red.estadoDeLaRed()).negocios.find(n => n.id === proveedorId);
    const telefono = (await red.telefonoDeNegocio(proveedorId)) ?? o.telefonoProveedor ?? negocio?.telefono;
    if (!telefono) return null;
    const proveedor: Negocio = negocio
      ? { ...negocio, telefono }
      : { id: proveedorId, nombre: 'Proveedor', comuna: '', rol: 'proveedor', telefono };
    proveedores.set(claveTelefono(telefono), proveedor);
    return proveedor;
  }

  async function alCerrar(datos: { licitacion: LicitacionSala; ordenes?: readonly OrdenCompra[] }) {
    const l: LicitacionSala = { ...(ultimaConocida ?? {}), ...datos.licitacion } as LicitacionSala;
    if (cerradasAvisadas.has(l.id)) return;
    cerradasAvisadas.add(l.id);
    const ordenes = datos.ordenes ?? [];
    const telefonoPorNegocio = new Map(l.participantes?.flatMap(p => (p.negocioId && p.telefono ? [[p.negocioId, p.telefono]] : [])) ?? []);
    for (const orden of ordenes) {
      const telefono = telefonoPorNegocio.get(orden.compradorId) ?? (await red.telefonoDeNegocio(orden.compradorId));
      ordenesDeSala.set(orden.id, { orden, precioSolo: l.precioSolo, licitacion: l, telefono });
    }
    const unidades = ordenes.reduce((s, x) => s + x.items.reduce((a, i) => a + i.cantidad, 0), 0) || l.totalUnidades;
    const precio = ordenes[0]?.items[0]?.precioUnitario ?? l.precioActual;
    const total = ordenes.reduce((s, x) => s + m.totalOrden(x), 0) || unidades * precio;
    const resumen = { negocios: ordenes.length || l.participantes.length, unidades, precio, total };
    o.log.info(`[sala] cerró ${l.id}: ${resumen.negocios} negocios, ${unidades} unidades a ${precio}`);
    const proveedorId = l.proveedorId ?? ordenes[0]?.proveedorId;
    const proveedor = proveedorId ? await proveedorDe(proveedorId) : null;
    if (!proveedor) {
      o.log.warn(`[sala] no sé a qué teléfono pedirle el sí al proveedor de ${l.id}`);
      return;
    }
    const mensaje = m.cierreAlProveedor(resumen, l);
    porFacturar.set(proveedor.id, { licitacionId: l.id, mensaje });
    await o.pedirConfirmacion(proveedor, l.id, mensaje);
  }

  function facturar(licitacionId: string): Promise<string> {
    const enCurso = facturadas.get(licitacionId);
    if (enCurso) return enCurso.then(() => m.YA_FACTURADA);
    const tarea = (async () => {
      const documentos = await red.confirmarOrdenesDeLicitacion(licitacionId);
      for (const [id, p] of porFacturar) if (p.licitacionId === licitacionId) porFacturar.delete(id);
      const facturas = Array.isArray(documentos) ? documentos.filter(d => d.tipo === 33).length : 0;
      o.log.info(`[sala] ${licitacionId} facturada: ${facturas} facturas`);
      return m.facturasDeLaSala(facturas);
    })();
    facturadas.set(licitacionId, tarea);
    // Si falla, se puede reintentar con otro sí (la pendiente vuelve a la cola del agente).
    tarea.catch(() => facturadas.delete(licitacionId));
    return tarea;
  }

  // --- Folio a cada comprador ---

  async function alEmitirDocumento(documento: Documento) {
    if (documento.tipo !== 33) return;
    const deSala = ordenesDeSala.get(documento.ordenId);
    if (!deSala || foliosAvisados.has(documento.id)) return;
    const telefono = deSala.telefono ?? (await red.telefonoDeNegocio(deSala.orden.compradorId));
    if (!telefono) return;
    const [item] = deSala.orden.items;
    foliosAvisados.set(documento.id, { telefono, en: Date.now(), folio: documento.folio });
    await o.envios.enviar(telefono, m.folioAlComprador({
      folio: documento.folio, cantidad: item.cantidad, precio: item.precioUnitario, precioSolo: deSala.precioSolo,
    }, deSala.licitacion), `folio ${documento.folio}`);
  }

  async function alActualizarDocumento(documento: Documento) {
    const aviso = foliosAvisados.get(documento.id);
    if (!aviso || o.avisoAceptadaMs <= 0 || !/acept/i.test(documento.estadoSii)) return;
    foliosAvisados.delete(documento.id); // una vez por documento
    if (Date.now() - aviso.en > o.avisoAceptadaMs) return;
    await o.envios.enviar(aviso.telefono, m.siiAcepto(aviso.folio), `aceptada ${aviso.folio}`);
  }

  function reiniciar() {
    participantes.clear();
    borradores.clear();
    proveedores.clear();
    ordenesDeSala.clear();
    porFacturar.clear();
    cerradasAvisadas.clear();
    facturadas.clear();
    foliosAvisados.clear();
    ultimaBaja = null;
    ofertasRecientes = [];
  }

  function alEvento(evento: EventoDeLaRed): Promise<void> | void {
    const datos = (evento.datos ?? {}) as Record<string, unknown>;
    switch (evento.tipo) {
      case 'licitacion.precio_bajo': return alBajarPrecio(datos as { licitacionId: string; precioNuevo: number });
      case 'licitacion.oferta': return alOfertar(datos as { licitacionId?: string; oferta?: m.OfertaSala; mejor?: boolean });
      case 'licitacion.cerrada': return alCerrar(datos as { licitacion: LicitacionSala; ordenes?: OrdenCompra[] });
      case 'documento.emitido': return alEmitirDocumento(datos.documento as Documento);
      case 'documento.actualizado': return alActualizarDocumento(datos.documento as Documento);
      case 'red.reiniciada': return reiniciar();
    }
  }

  const dejarDeEscuchar = red.escuchar(evento => {
    try {
      Promise.resolve(alEvento(evento)).catch(e => o.log.error(`[sala] falló ${evento.tipo}:`, mensajeDe(e)));
    } catch (e) {
      o.log.error(`[sala] falló ${evento.tipo}:`, mensajeDe(e));
    }
  });

  // Si el dominio no cierra solo al llegar `cierraEn`, lo cierra el agente.
  let revisando = false;
  const vigilancia = o.vigilarCierreMs > 0 ? setInterval(async () => {
    if (revisando) return;
    revisando = true;
    try {
      const l = await abierta();
      if (l && Date.parse(l.cierraEn) <= Date.now()) await red.cerrarLicitacion(l.id);
    } catch (e) {
      o.log.warn('[sala] no pude cerrar la compra conjunta:', mensajeDe(e));
    } finally {
      revisando = false;
    }
  }, o.vigilarCierreMs) : null;
  vigilancia?.unref?.();

  return {
    proveedorPorTelefono: telefono => proveedores.get(claveTelefono(telefono)) ?? null,
    participa: telefono => participantes.has(claveTelefono(telefono)) || borradores.has(claveTelefono(telefono)),
    atenderPublico,
    facturar,
    pendienteDeFacturar: negocioId => porFacturar.get(negocioId) ?? null,
    detener() {
      dejarDeEscuchar();
      if (vigilancia) clearInterval(vigilancia);
      if (timerCascada) clearTimeout(timerCascada);
      o.envios.detener();
    },
  };
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
