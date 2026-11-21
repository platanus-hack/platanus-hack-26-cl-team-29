// "La sala compra junta": el público arma su pedido de una canasta de productos escribiendo al número de la demo.
//   desconocido --(mensaje)--> bienvenida con la canasta numerada + "¿cómo se llama tu negocio y qué quieres?"
//               --(nombre y productos, en uno o dos mensajes)--> "¿cuál es el RUT de tu negocio?" (si la red lo pide)
//               --(RUT válido y conocido en el SII)--> se suma (sin efecto legal, no pide sí); su factura sale a ese RUT
//   participante --("agrega 3 bolsas", "quita los guantes", "2 del 3", "mi pedido")--> carrito actualizado
//               --("salir", "vaciar")--> pide un sí corto, porque lo saca de la compra
//   cada baja de precio --> una difusión a todos los participantes (agrupada por ventana, con freno por teléfono);
//                           si bajó por ofertas de proveedores que compiten, dice quién ofertó y quién respondió
//   cierre --> pregunta al proveedor; solo con su sí se facturan todas en el SII
//   cada factura emitida --> el comprador recibe su folio con cada línea
import { totalOrden } from '../../shared/precios.ts';
import type { Interprete } from './intencion.ts';
import { normalizar } from './intencion.ts';
import type { Catalogo, CambioCarrito, DatosCanasta } from './canasta.ts';
import { aplicarCambios, catalogoDe, interpretarCanastaConReglas, itemsDe, productoDeItem, productosDe } from './canasta.ts';
import type { Documento, EventoDeLaRed, ItemCarrito, LicitacionSala, Negocio, OrdenCompra, Red, RedSala, ResultadoCarrito } from './puerto.ts';
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
  /** Máximo por producto y negocio. */
  readonly cantidadMaxima: number;
  /** Bajas de precio dentro de esta ventana salen como una sola difusión. */
  readonly ventanaCascadaMs: number;
  /** Cada cuánto revisar si ya pasó `cierraEn`; 0 desactiva. */
  readonly vigilarCierreMs: number;
  /** "El SII aceptó tu factura" solo si el veredicto llega dentro de este plazo desde el folio; 0 desactiva. */
  readonly avisoAceptadaMs: number;
  /** Link privado para conectar el certificado digital (server/certificados). Sin él, solo se pide el RUT. */
  readonly enlaceCertificado?: (telefono: string) => string;
  /** Deja la pregunta de facturar en la cola de confirmaciones del agente. */
  pedirConfirmacion(proveedor: Negocio, licitacionId: string, mensaje: string): Promise<void>;
}

export interface Sala {
  /** El proveedor de una compra cerrada, si escribe desde un teléfono que la red no conoce. */
  proveedorPorTelefono(telefono: string): Negocio | null;
  /** Si un comprador registrado le habla a la compra conjunta (participa, quiere sumarse o pide productos de la canasta). */
  atiende(telefono: string, negocioId: string, texto: string): Promise<boolean>;
  /**
   * Si el producto de un pedido ("cajas", "bolsas", "guantes") es de la compra conjunta abierta. Así "quiero 3 cajas
   * más" va a la canasta y no a un pedido de catálogo que la red no puede cumplir.
   */
  hablaDeLaCanasta(producto: string): Promise<boolean>;
  /**
   * Si el mensaje es una acción que la sala sabe hacer (sumarse, agregar, quitar, ver el pedido) o responde algo que
   * la sala preguntó. Una pregunta cualquiera ("¿cuántas cajas le compré a Devlas?") no lo es: la contesta la IA.
   */
  entiende(telefono: string, texto: string): Promise<boolean>;
  /** Responde a alguien del público (o a un comprador registrado que quiere sumarse). */
  atenderPublico(telefono: string, texto: string, nombreConocido?: string): Promise<string>;
  /** Ejecuta la facturación ya confirmada por el proveedor. Idempotente. */
  facturar(licitacionId: string): Promise<string>;
  /** Si el proveedor dijo "todavía no" y luego escribe "sí": la pregunta para volver a hacerla. */
  pendienteDeFacturar(negocioId: string): { readonly licitacionId: string; readonly mensaje: string } | null;
  detener(): void;
}

interface Participacion { telefono: string; nombre: string; items: readonly ItemCarrito[]; licitacionId: string }
interface Borrador {
  nombre?: string;
  items: readonly ItemCarrito[];
  /** Un número sin producto, esperando que diga de cuál. */
  suelta?: Omit<CambioCarrito, 'productoId'>;
  /** Se le preguntó cuántas de este producto. */
  productoId?: string;
  /** RUT ya consultado en el SII (forma "12345678-5") y su razón social. */
  rut?: string;
  razonSocial?: string;
  /** Se le preguntó el RUT: un mensaje solo con números se lee como RUT. */
  esperandoRut?: boolean;
  /** Eligió "No (demo)": se suma sin RUT y su factura va al receptor de prueba. */
  demo?: boolean;
  pregunta: string;
}

/** Palabras que dejan claro que un número es el nuevo total, aunque baje lo que lleva. */
const FIJAR_EXPLICITO = /\b(deja|dejame|dejalo|cambia|cambiame|mejor|pon|ponme|solo|solamente|total|totales|totals|quedo|quedar|ahora)\b/;

/** Un RUT dentro de un mensaje, con o sin puntos y guion ("12.345.678-5", "12345678-5", "123456785"). */
const PATRON_RUT = /\b\d{1,2}(?:\.?\d{3}){2}\s*-?\s*[\dkK]\b/;
const SOLO_RUT = /^[\d.\s-]+[kK]?$/;
const esErrorDeRut = (e: unknown): e is Error =>
  e instanceof Error && ['datos_invalidos', 'sii_no_disponible'].includes(String((e as { codigo?: unknown }).codigo));
interface OrdenDeSala { orden: OrdenCompra; licitacion: LicitacionSala; telefono: string | null }

export function crearSala(red: Red & RedSala, o: OpcionesSala): Sala {
  const participantes = new Map<string, Participacion>();
  const borradores = new Map<string, Borrador>();
  /** Teléfonos a los que se les preguntó si salen de la compra. */
  const salidas = new Set<string>();
  /** Un número suelto que bajaría lo que lleva: se le preguntó si queda en ese número o lo suma. */
  const dudas = new Map<string, { productoId: string; cantidad: number }>();
  const proveedores = new Map<string, Negocio>();
  const ordenesDeSala = new Map<string, OrdenDeSala>();
  const porFacturar = new Map<string, { licitacionId: string; mensaje: string }>();
  const cerradasAvisadas = new Set<string>();
  const facturadas = new Map<string, Promise<string>>();
  const foliosAvisados = new Map<string, { telefono: string; en: number; folio: number }>();
  let ultimaConocida: LicitacionSala | null = null;
  /** Bajas de la ventana en curso: producto ('' = el único) -> precio nuevo. Se queda la última de cada uno. */
  let bajas: { licitacionId: string; precios: Map<string, number> } | null = null;
  /** Ofertas de proveedores desde la última difusión: explican por qué bajó (las últimas 3 por producto). */
  let ofertasRecientes: (m.OfertaSala & { licitacionId: string })[] = [];
  let timerCascada: ReturnType<typeof setTimeout> | null = null;

  async function abierta(): Promise<LicitacionSala | null> {
    const l = await red.licitacionAbierta();
    if (l) ultimaConocida = l;
    return l;
  }

  async function leer(texto: string, pregunta: string, cat: Catalogo): Promise<DatosCanasta> {
    const reglas = interpretarCanastaConReglas(texto, cat);
    if (reglas.claro || !o.interprete.interpretarCanasta) return reglas;
    return o.interprete.interpretarCanasta(texto, pregunta, cat);
  }

  /** Su carrito según la red (la verdad, también tras un reinicio o si lo cambió en la web); si no, lo que sabe este proceso. */
  async function participacionDe(telefono: string, l: LicitacionSala): Promise<Participacion | null> {
    const clave = claveTelefono(telefono);
    let p = l.participantes.find(x => x.telefono && claveTelefono(x.telefono) === clave);
    if (!p) {
      const negocio = await red.negocioPorTelefono(telefono);
      if (negocio) p = l.participantes.find(x => x.negocioId === negocio.id);
    }
    if (p) return { telefono, nombre: p.nombre, items: itemsDe(p, l), licitacionId: l.id };
    const local = participantes.get(clave);
    return local?.licitacionId === l.id ? local : null;
  }

  /** Red sin canasta: un solo producto por `unirseALicitacion`. */
  async function guardarEnRed(telefono: string, nombre: string, items: readonly ItemCarrito[], l: LicitacionSala, rut?: string): Promise<ResultadoCarrito> {
    if (red.actualizarCarrito) return red.actualizarCarrito(l.id, { telefono, nombre, items, ...(rut ? { rut } : {}) });
    const r = await red.unirseALicitacion(l.id, { telefono, nombre, cantidad: items[0].cantidad });
    return { licitacion: r.licitacion, participante: r.participante };
  }

  async function guardar(telefono: string, nombre: string, items: readonly ItemCarrito[], l: LicitacionSala, actualizado: boolean, rut?: string): Promise<string> {
    const clave = claveTelefono(telefono);
    let r: ResultadoCarrito;
    try {
      r = await guardarEnRed(telefono, nombre, items, l, rut);
    } catch (error) {
      if (!(await abierta())) return m.SIN_COMPRA_ABIERTA;
      throw error;
    }
    participantes.set(clave, { telefono, nombre, items, licitacionId: l.id });
    borradores.delete(clave);
    ultimaConocida = r.licitacion;
    const detalle = items.map(i => `${i.productoId}:${i.cantidad}`).join(', ');
    o.log.info(`[sala] ${enmascarar(telefono)} ${actualizado ? 'cambió a' : 'se sumó con'} ${detalle}; ${r.licitacion.participantes.length} negocios`);
    return m.carritoActualizado(nombre, items, r.licitacion, actualizado);
  }

  async function salir(telefono: string, l: LicitacionSala): Promise<string> {
    if (red.salirDeLicitacion) await red.salirDeLicitacion(l.id, { telefono });
    else if (red.actualizarCarrito) await red.actualizarCarrito(l.id, { telefono, items: [] });
    else throw new Error('la red no permite salir de la compra');
    const clave = claveTelefono(telefono);
    participantes.delete(clave);
    borradores.delete(clave);
    o.log.info(`[sala] ${enmascarar(telefono)} salió de la compra conjunta`);
    return m.SALISTE;
  }

  /** Con el certificado disponible, la pregunta del RUT ofrece conectarlo o seguir en modo demo. */
  const preguntaRut = (nombre?: string) => (o.enlaceCertificado ? m.pedirRutOCertificado(nombre) : m.pedirRut(nombre));

  async function atenderPublico(telefono: string, texto: string, nombreConocido?: string): Promise<string> {
    const clave = claveTelefono(telefono);
    const l = await abierta();
    if (!l) return participantes.has(clave) ? m.COMPRA_CERRADA : m.SIN_COMPRA_ABIERTA;
    const productos = productosDe(l);
    const yo = await participacionDe(telefono, l);
    const borrador = yo ? undefined : borradores.get(clave);
    const confirmandoSalida = salidas.delete(clave);
    const duda = dudas.get(clave);
    dudas.delete(clave);
    if (duda && yo) {
      const t = normalizar(texto);
      // 1 = queda en ese número, 2 = lo suma. Otra cosa: se olvida la pregunta y se atiende como siempre.
      if (t === '1' || t === '2') {
        const items = aplicarCambios(yo.items, [{ productoId: duda.productoId, cantidad: duda.cantidad, modo: t === '1' ? 'fijar' : 'sumar' }]);
        return guardar(telefono, yo.nombre, items, l, true);
      }
    }
    const pregunta = confirmandoSalida ? m.confirmarSalida(false)
      : yo ? m.resumenCarrito(yo.nombre, yo.items, l) : borrador?.pregunta ?? m.preguntaSala(l);

    // Respuesta a "conecta tu certificado o escribe tu RUT": 1 = el link, 2 = modo demo. Va antes del RUT porque
    // "1" o "2" también se leerían como un RUT inválido.
    if (borrador?.esperandoRut && o.enlaceCertificado) {
      const t = normalizar(texto);
      if (t === '1' || /\b(conectar|certificado)\b/.test(t)) return m.enlaceCertificado(o.enlaceCertificado(telefono));
      if (t === '2' || t === 'no' || /\b(demo|saltar|saltarlo|omitir)\b/.test(t)) {
        const demo: Borrador = { ...borrador, esperandoRut: false, demo: true };
        o.log.info(`[sala] ${enmascarar(telefono)} sigue en modo demo, sin RUT`);
        if (demo.nombre && demo.items.length) return `${m.MODO_DEMO}\n\n${await guardar(telefono, demo.nombre, demo.items, l, false)}`;
        borradores.set(clave, { ...demo, pregunta: m.preguntaSala(l) });
        return `${m.MODO_DEMO}\n\n${m.preguntaSala(l)}`;
      }
    }

    // El RUT, antes de sumarse: se saca del mensaje (sus números no son cantidades) y se consulta en el SII.
    let delRut: { rut: string; razonSocial: string } | undefined;
    let mensaje = texto;
    if (!yo && red.consultarRut) {
      const dicho = PATRON_RUT.exec(texto)?.[0] ?? (borrador?.esperandoRut && SOLO_RUT.test(texto.trim()) ? texto.trim() : undefined);
      if (dicho) {
        mensaje = texto.replace(dicho, ' ').replace(/\b(?:mi|el)?\s*rut\b(?:\s+es)?\s*:?/gi, ' ').trim();
        try {
          delRut = await red.consultarRut(dicho);
          o.log.info(`[sala] ${enmascarar(telefono)} dio un RUT válido`);
        } catch (e) {
          if (!esErrorDeRut(e)) throw e;
          borradores.set(clave, { ...(borrador ?? { items: [] }), esperandoRut: true, pregunta: preguntaRut(borrador?.nombre ?? nombreConocido) });
          return m.rutConError(e.message);
        }
      }
    }
    const cat = catalogoDe(l, o.cantidadMaxima);
    const d = mensaje ? await leer(mensaje, pregunta, cat) : interpretarCanastaConReglas('', cat);

    if (confirmandoSalida && yo) {
      const t = normalizar(texto);
      if (d.accion === 'si' || t === '1') return salir(telefono, l);
      if (d.accion === 'no' || t === '2') return m.sigues(yo.items, l);
      // Otra cosa: se olvida la pregunta y se atiende el mensaje como siempre.
    }
    if (d.accion === 'lista') return m.listaProductos(l);
    if (d.accion === 'ver') return yo ? m.resumenCarrito(yo.nombre, yo.items, l) : m.noParticipas(l);
    if (d.accion === 'salir') {
      if (!yo) return m.noParticipas(l);
      salidas.add(clave);
      return m.confirmarSalida(false);
    }

    /** Con el RUT recién dado, primero a quién sale la factura. */
    const conRut = (respuesta: string) => (delRut ? `${m.facturaA(delRut.razonSocial)}\n\n${respuesta}` : respuesta);
    /** Responde con la pregunta y la recuerda; al primer contacto, con la bienvenida. */
    const preguntar = (b: Borrador) => {
      if (yo) return b.pregunta;
      borradores.set(clave, b);
      if (!borrador) o.log.info(`[sala] ${enmascarar(telefono)} llegó a la compra conjunta`);
      return conRut(borrador ? b.pregunta : m.bienvenidaSala(l, b.pregunta, o.urlPublica));
    };
    const base = yo?.items ?? borrador?.items ?? [];
    const nombre = yo?.nombre ?? d.nombre ?? borrador?.nombre ?? nombreConocido;
    const rut = delRut?.rut ?? borrador?.rut;
    const razonSocial = delRut?.razonSocial ?? borrador?.razonSocial;
    const conocido = { ...(rut ? { rut } : {}), ...(razonSocial ? { razonSocial } : {}) };
    const guardado = { ...(nombre ? { nombre } : {}), items: base, ...conocido, ...(borrador?.demo ? { demo: true } : {}) };
    /** Se suma a la compra; si la red pide RUT y todavía no lo tiene, lo pregunta primero. */
    const sumar = async (nombre: string, items: readonly ItemCarrito[]) => {
      if (red.consultarRut && !rut && !borrador?.demo && !(await red.negocioPorTelefono(telefono))?.rut) {
        return preguntar({ ...guardado, nombre, items, esperandoRut: true, pregunta: preguntaRut(nombre) });
      }
      return conRut(await guardar(telefono, nombre, items, l, false, rut));
    };
    if (d.fueraDeRango) return preguntar({ ...guardado, pregunta: m.cantidadFueraDeRango(o.cantidadMaxima) });

    const cambios = [...d.cambios];
    if (d.suelta) {
      // "mejor 6": del producto que se le preguntó, del único que lleva o del único que hay.
      const id = borrador?.productoId ?? (base.length === 1 ? base[0].productoId : productos.length === 1 ? productos[0].id : undefined);
      const lleva = base.find(i => i.productoId === id)?.cantidad ?? 0;
      // Un número suelto que bajaría lo que ya lleva, sin "deja", "cambia", "mejor" ni "en total": se pregunta
      // ("ya dale, cómprale las 4" con 6 en el carrito no es quedar en 4).
      if (id && yo && d.suelta.modo === 'fijar' && d.suelta.cantidad < lleva && !FIJAR_EXPLICITO.test(normalizar(texto))) {
        dudas.set(clave, { productoId: id, cantidad: d.suelta.cantidad });
        return m.dudaCantidad(productos.find(p => p.id === id)!, d.suelta.cantidad, lleva);
      }
      if (id) cambios.push({ productoId: id, ...d.suelta });
      else if (cambios.length === 0) return preguntar({ ...guardado, suelta: d.suelta, pregunta: m.preguntarProducto(d.suelta.cantidad, l) });
    }
    if (d.sinCantidad) {
      const p = productos.find(x => x.id === d.sinCantidad!.productoId)!;
      if (borrador?.suelta) cambios.push({ productoId: p.id, ...borrador.suelta });
      else if (cambios.length === 0) return preguntar({ ...guardado, productoId: p.id, pregunta: m.preguntarCantidad(p) });
    }
    const items = aplicarCambios(base, cambios, d.soloEstos);
    if (items.some(i => i.cantidad > o.cantidadMaxima)) return preguntar({ ...guardado, pregunta: m.cantidadFueraDeRango(o.cantidadMaxima) });

    if (cambios.length === 0) {
      if (yo) return m.resumenCarrito(yo.nombre, yo.items, l);
      if (nombre && base.length) return sumar(nombre, base);
      return preguntar({ ...guardado, pregunta: nombre ? m.pedirCarritoSala(nombre, l) : m.preguntaSala(l) });
    }
    if (items.length === 0) {
      if (!yo) return preguntar({ ...guardado, items: [], pregunta: m.preguntaSala(l) });
      salidas.add(clave);
      return m.confirmarSalida(true);
    }
    if (!nombre) return preguntar({ items, ...conocido, pregunta: m.pedirNombreSala(items, l) });
    return yo ? guardar(telefono, nombre, items, l, true) : sumar(nombre, items);
  }

  async function hablaDeLaCanasta(producto: string): Promise<boolean> {
    const l = await abierta();
    if (!l) return false;
    const dichas = new Set(normalizar(producto).split(' ').filter(p => p.length > 2));
    return productosDe(l).some(p =>
      [p.unidad, p.unidadPlural ?? '', p.id, ...normalizar(p.nombre).split(' ')].some(x => x.length > 2 && dichas.has(normalizar(x))));
  }

  async function entiende(telefono: string, texto: string): Promise<boolean> {
    const clave = claveTelefono(telefono);
    if (borradores.has(clave) || salidas.has(clave)) return true;
    if (/\bsum(o|ar|arme|arnos|amos)\b/.test(normalizar(texto))) return true;
    const l = await abierta();
    if (!l) return false;
    const d = interpretarCanastaConReglas(texto, catalogoDe(l, o.cantidadMaxima));
    return d.cambios.length > 0 || d.accion !== undefined || d.suelta !== undefined;
  }

  async function atiende(telefono: string, negocioId: string, texto: string): Promise<boolean> {
    const clave = claveTelefono(telefono);
    if (participantes.has(clave) || borradores.has(clave) || salidas.has(clave)) return true;
    if (/\bsum(o|ar|arme|arnos|amos)\b/.test(normalizar(texto))) return true;
    const l = await abierta();
    if (!l) return false;
    if (l.participantes.some(p => p.negocioId === negocioId)) return true;
    const d = interpretarCanastaConReglas(texto, catalogoDe(l, o.cantidadMaxima));
    return d.cambios.length > 0 || d.accion === 'lista';
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
    const ventana = bajas;
    const ofertas = ofertasRecientes;
    bajas = null;
    ofertasRecientes = [];
    if (!ventana) return;
    const l = await abierta();
    if (!l || l.id !== ventana.licitacionId) return; // ya cerró: la baja no importa
    const productos = productosDe(l);
    const idDe = (id?: string) => id || productos[0].id;
    const lista = [...ventana.precios].flatMap(([id, precio]) => {
      const producto = productos.find(p => p.id === idDe(id));
      if (!producto) return [];
      const porque = ofertas.filter(x => x.licitacionId === l.id && idDe(x.productoId) === producto.id).slice(-3);
      return [{ producto, precio, ofertas: porque }];
    });
    if (lista.length === 0) return;
    await o.envios.difundir(await telefonosDe(l), m.bajoPrecio(lista, l.participantes.length), 'baja de precio');
  }

  function alBajarPrecio(datos: { licitacionId: string; productoId?: string; precioNuevo: number }) {
    if (!bajas || bajas.licitacionId !== datos.licitacionId) bajas = { licitacionId: datos.licitacionId, precios: new Map() };
    bajas.precios.set(datos.productoId ?? '', datos.precioNuevo);
    if (timerCascada) return;
    timerCascada = setTimeout(() => { difundirBaja().catch(e => o.log.error('[sala] falló la difusión', mensajeDe(e))); }, o.ventanaCascadaMs);
    timerCascada.unref?.();
  }

  function alOfertar(datos: { licitacionId?: string; productoId?: string; oferta?: Partial<m.OfertaSala>; mejor?: boolean }) {
    const { licitacionId, oferta, mejor } = datos;
    if (!mejor || !licitacionId || !oferta?.proveedorNombre || typeof oferta.precioUnitario !== 'number') return;
    const productoId = datos.productoId ?? oferta.productoId;
    ofertasRecientes.push({
      licitacionId, proveedorNombre: oferta.proveedorNombre, precioUnitario: oferta.precioUnitario, ...(productoId ? { productoId } : {}),
    });
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

  /** "4 cajas de rollos" de una línea de orden, con el producto de la canasta si se reconoce. */
  function lineaDe(item: OrdenCompra['items'][number], l: LicitacionSala): string {
    const p = productoDeItem(item, productosDe(l));
    return p ? m.itemTexto(p, item.cantidad) : `${item.cantidad} ${item.producto}`;
  }

  async function alCerrar(datos: { licitacion: LicitacionSala; ordenes?: readonly OrdenCompra[] }) {
    const l: LicitacionSala = { ...(ultimaConocida ?? {}), ...datos.licitacion } as LicitacionSala;
    if (cerradasAvisadas.has(l.id)) return;
    cerradasAvisadas.add(l.id);
    const ordenes = datos.ordenes ?? [];
    const productos = productosDe(l);
    const telefonoPorNegocio = new Map(l.participantes?.flatMap(p => (p.negocioId && p.telefono ? [[p.negocioId, p.telefono]] : [])) ?? []);
    for (const orden of ordenes) {
      const telefono = telefonoPorNegocio.get(orden.compradorId) ?? (await red.telefonoDeNegocio(orden.compradorId));
      ordenesDeSala.set(orden.id, { orden, licitacion: l, telefono });
    }
    // Unidades por producto de toda la compra, en el orden de la canasta.
    const porProducto = new Map<string, OrdenCompra['items'][number]>();
    for (const item of ordenes.flatMap(x => x.items)) {
      const clave = productoDeItem(item, productos)?.id ?? item.producto;
      const antes = porProducto.get(clave);
      porProducto.set(clave, { ...item, cantidad: (antes?.cantidad ?? 0) + item.cantidad });
    }
    const lineas = ordenes.length
      ? [...porProducto.values()].map(i => lineaDe(i, l))
      : productos.filter(p => p.totalUnidades > 0).map(p => m.itemTexto(p, p.totalUnidades));
    const total = ordenes.reduce((s, x) => s + totalOrden(x), 0) || productos.reduce((s, p) => s + p.totalUnidades * p.precioActual, 0);
    const negocios = ordenes.length || l.participantes.length;
    o.log.info(`[sala] cerró ${l.id}: ${negocios} negocios, ${lineas.join(', ')}`);
    const proveedorId = l.proveedorId ?? ordenes[0]?.proveedorId;
    const proveedor = proveedorId ? await proveedorDe(proveedorId) : null;
    if (!proveedor) {
      o.log.warn(`[sala] no sé a qué teléfono pedirle el sí al proveedor de ${l.id}`);
      return;
    }
    const mensaje = m.cierreAlProveedor({ negocios, lineas, total });
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
    const { orden, licitacion } = deSala;
    const productos = productosDe(licitacion);
    const ahorro = orden.items.reduce((suma, i) => {
      const p = productoDeItem(i, productos);
      return suma + (p ? i.cantidad * Math.max(0, p.precioSolo - i.precioUnitario) : 0);
    }, 0);
    foliosAvisados.set(documento.id, { telefono, en: Date.now(), folio: documento.folio });
    const pdf = await enlacePdf(documento);
    await o.envios.enviar(telefono, m.folioAlComprador({
      folio: documento.folio, lineas: orden.items.map(i => lineaDe(i, licitacion)), total: totalOrden(orden), ahorro, pdf,
    }), `folio ${documento.folio}`);
    if (pdf) {
      await o.envios.enviarDocumento(telefono, {
        link: pdf, filename: `factura-${documento.folio}.pdf`, caption: m.leyendaPdf(documento.folio),
      }, `pdf ${documento.folio}`);
    }
  }

  /** Sin PDF el folio igual sale: el enlace es un extra. */
  async function enlacePdf(documento: Documento): Promise<string | null> {
    try {
      return (await red.enlacePdf?.(documento)) ?? null;
    } catch (e) {
      o.log.warn(`[sala] no pude obtener el PDF del folio ${documento.folio}:`, mensajeDe(e));
      return null;
    }
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
    salidas.clear();
    proveedores.clear();
    ordenesDeSala.clear();
    porFacturar.clear();
    cerradasAvisadas.clear();
    facturadas.clear();
    foliosAvisados.clear();
    bajas = null;
    ofertasRecientes = [];
  }

  function alEvento(evento: EventoDeLaRed): Promise<void> | void {
    const datos = (evento.datos ?? {}) as Record<string, unknown>;
    switch (evento.tipo) {
      case 'licitacion.precio_bajo': return alBajarPrecio(datos as { licitacionId: string; productoId?: string; precioNuevo: number });
      case 'licitacion.oferta': return alOfertar(datos as { licitacionId?: string; productoId?: string; oferta?: m.OfertaSala; mejor?: boolean });
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
    atiende,
    hablaDeLaCanasta,
    entiende,
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
