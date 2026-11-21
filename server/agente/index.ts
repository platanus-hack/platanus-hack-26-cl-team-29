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
import type { Negocio, OrdenCompra, Red } from './puerto.ts';
import { tieneSala } from './puerto.ts';
import { interpreteDeReglas, normalizar } from './intencion.ts';
import { crearInterpreteClaude } from './claude.ts';
import { crearEnvios, enmascarar } from './envios.ts';
import type { Log, WhatsAppDeEnvios } from './envios.ts';
import { crearSala } from './sala.ts';
import type { Sala } from './sala.ts';
import * as m from './mensajes.ts';

export type { Red } from './puerto.ts';

const PLAZO_RECLAMO_DIAS = 8;
const DIA_MS = 24 * 60 * 60 * 1000;

type Pendiente = { readonly mensaje: string } & (
  | { readonly tipo: 'crear_orden'; readonly proveedor: Negocio; readonly producto: string; readonly cantidad: number }
  | { readonly tipo: 'confirmar_ordenes'; readonly ordenIds: readonly string[] }
  | { readonly tipo: 'recepcion'; readonly ordenId: string; readonly facturaEn: Date }
  | { readonly tipo: 'reclamar'; readonly ordenId: string; readonly faltante: number; readonly facturaEn: Date }
  | { readonly tipo: 'nota_credito'; readonly ordenId: string; readonly faltante: number; readonly monto: number; readonly reclamoEn: Date }
  | { readonly tipo: 'facturar_licitacion'; readonly licitacionId: string }
);

export interface OpcionesAgente {
  readonly interprete?: Interprete;
  readonly ahora?: () => Date;
  readonly log?: Log;
  /** Tiempos y límites de la compra conjunta; por defecto los de la demo. */
  readonly sala?: Partial<TiemposSala>;
  readonly env?: NodeJS.ProcessEnv;
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
  cantidadMaxima: 20,
};

export interface Agente {
  /** Para facturas emitidas fuera de WhatsApp (p. ej. desde la pantalla): pregunta al comprador si recibió todo. */
  avisarFactura(ordenId: string): Promise<void>;
  desconectar(): void;
}

type WhatsAppDelAgente = Pick<WhatsApp, 'onMessage'> & WhatsAppDeEnvios & Partial<Pick<WhatsApp, 'history'>>;

export function conectarAgente(whatsapp: WhatsAppDelAgente, red: Red, opciones: OpcionesAgente = {}): Agente {
  const env = opciones.env ?? process.env;
  const interprete = opciones.interprete ?? interpreteDesdeEnv(env);
  const ahora = opciones.ahora ?? (() => new Date());
  const log = opciones.log ?? console;
  /** Cola de acciones pendientes por negocio; la primera es la que se está preguntando. */
  const colas = new Map<string, Pendiente[]>();

  const actual = (negocioId: string) => colas.get(negocioId)?.[0] ?? null;
  const tomar = (negocioId: string) => colas.get(negocioId)?.shift() ?? null;
  const alFrente = (negocioId: string, p: Pendiente) => colas.set(negocioId, [p, ...(colas.get(negocioId) ?? [])]);

  /** Pendiente iniciada por la contraparte: se pregunta ahora si no hay otra en curso, o al terminar la actual. */
  async function encolar(negocio: Negocio, p: Pendiente) {
    const cola = colas.get(negocio.id) ?? [];
    cola.push(p);
    colas.set(negocio.id, cola);
    if (cola.length === 1) await whatsapp.sendText(negocio.telefono, p.mensaje);
  }

  const sala: Sala | null = tieneSala(red) ? crearSalaDelAgente(red, opciones.sala ?? {}) : null;

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
      pedirConfirmacion: (proveedor, licitacionId, mensaje) => encolar(proveedor, { tipo: 'facturar_licitacion', licitacionId, mensaje }),
    });
  }

  async function avisar(negocio: Negocio, texto: string) {
    await whatsapp.sendText(negocio.telefono, texto);
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

  async function avisarFacturaDe(orden: OrdenCompra, negocios: ReadonlyMap<string, Negocio>) {
    const comprador = negocios.get(orden.compradorId);
    const proveedor = negocios.get(orden.proveedorId);
    if (!comprador || !proveedor) return;
    await encolar(comprador, { tipo: 'recepcion', ordenId: orden.id, facturaEn: ahora(), mensaje: m.llegoFactura(orden, proveedor) });
  }

  async function proponerPedido(comprador: Negocio, producto: string, cantidad: number, elegido?: string): Promise<string> {
    const { negocios } = await red.estadoDeLaRed();
    const candidatos = await Promise.all(
      negocios.filter(n => n.rol === 'proveedor').map(async n => ({ n, nota: await red.notaDeProveedor(n.id) })),
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
        return sala.facturar(p.licitacionId);
    }
  }

  async function confirmar(negocio: Negocio): Promise<string> {
    const p = tomar(negocio.id); // se saca antes de ejecutar: idempotencia ante un "sí" repetido
    if (!p) return reproponerFacturacion(negocio) ?? m.NADA_PENDIENTE;
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
        return negocio.rol === 'comprador' ? proponerPedido(negocio, intencion.producto, intencion.cantidad, intencion.proveedor) : m.AYUDA_PROVEEDOR;
      case 'ver_pedidos':
        return negocio.rol === 'proveedor' ? proponerConfirmacion(negocio) : m.AYUDA_COMPRADOR;
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
        return negocio.rol === 'comprador' ? m.AYUDA_COMPRADOR : m.AYUDA_PROVEEDOR;
    }
  }

  /** El proveedor dijo "todavía no" a facturar la compra conjunta y ahora dice que sí: se le vuelve a preguntar. */
  function reproponerFacturacion(negocio: Negocio): string | null {
    const pendiente = negocio.rol === 'proveedor' ? sala?.pendienteDeFacturar(negocio.id) : null;
    if (!pendiente) return null;
    alFrente(negocio.id, { tipo: 'facturar_licitacion', licitacionId: pendiente.licitacionId, mensaje: pendiente.mensaje });
    return pendiente.mensaje;
  }

  /** Con la capa de IA (server/ia/), el intérprete recibe contexto y puede responder; si no, solo clasifica. */
  async function entender(negocio: Negocio, telefono: string, texto: string, pendiente: string | null): Promise<Intencion> {
    if (!interprete.conversar) return interprete.interpretar(texto, pendiente);
    const { id, nombre, comuna, rol } = negocio;
    return interprete.conversar({ negocio: { id, nombre, comuna, rol }, texto, historial: await historialDe(telefono, texto), pendiente });
  }

  async function historialDe(telefono: string, texto: string) {
    const mensajes = whatsapp.history ? await whatsapp.history(telefono, { limit: 11 }).catch(() => []) : [];
    const ultimo = mensajes.at(-1);
    // El mensaje que se está atendiendo ya quedó guardado: no se repite como historia.
    const previos = ultimo?.direction === 'in' && ultimo.text === texto ? mensajes.slice(0, -1) : mensajes;
    return previos.slice(-10).map(msg => ({ de: msg.direction === 'in' ? 'persona' as const : 'bando' as const, texto: msg.text }));
  }

  async function atender(telefono: string, texto: string, ctx: { reply(body: string): Promise<unknown> }) {
    const negocio = (await red.negocioPorTelefono(telefono)) ?? sala?.proveedorPorTelefono(telefono) ?? null;
    if (!negocio) {
      await ctx.reply(sala ? await sala.atenderPublico(telefono, texto) : m.NO_REGISTRADO);
      return;
    }
    const antes = actual(negocio.id);
    const intencion = await entender(negocio, telefono, texto, antes?.mensaje ?? null);
    // Un comprador registrado también arma su pedido en la compra conjunta, si no hay otra cosa en curso.
    // Quien se suma por WhatsApp queda registrado en la red: "sí", "no" o "2 del 3" también son de la sala.
    // Un pedido de un producto de la canasta ("quiero 3 cajas más") es de la sala aunque se lea como pedido.
    const pideDeLaCanasta = sala !== null && intencion.tipo === 'pedir' && (await sala.hablaDeLaCanasta(intencion.producto));
    const deLaSala = sala && !antes && negocio.rol === 'comprador' && intencion.tipo !== 'faltante'
      && (pideDeLaCanasta || intencion.tipo !== 'pedir');
    if (sala && deLaSala && (pideDeLaCanasta || (await sala.atiende(telefono, negocio.id, texto)))) {
      await ctx.reply(await sala.atenderPublico(telefono, texto, negocio.nombre));
      return;
    }
    const respuesta = await responder(negocio, intencion);
    await ctx.reply(respuesta);
    // Si se resolvió lo que se preguntaba y asomó algo que esperaba en la cola, se pregunta ahora.
    const siguiente = actual(negocio.id);
    if (siguiente && siguiente !== antes && siguiente.mensaje !== respuesta) await ctx.reply(siguiente.mensaje);
  }

  // Mensajes de un mismo teléfono, en orden y de a uno; teléfonos distintos, en paralelo.
  const filas = new Map<string, Promise<void>>();
  const desconectar = whatsapp.onMessage((mensaje, ctx) => {
    const telefono = mensaje.from;
    const siguiente = (filas.get(telefono) ?? Promise.resolve()).then(async () => {
      try {
        await ctx.markRead({ typing: true });
        await atender(telefono, mensaje.text, ctx);
      } catch (error) {
        log.error(`[agente] falló el mensaje de ${enmascarar(telefono)}:`, error instanceof Error ? error.message : error);
        await ctx.reply(m.ERROR_TEMPORAL);
      }
    });
    filas.set(telefono, siguiente);
    void siguiente.then(() => { if (filas.get(telefono) === siguiente) filas.delete(telefono); });
    return siguiente;
  });

  return {
    async avisarFactura(ordenId) {
      await avisarFacturaDe(await ordenPorId(ordenId), await negociosPorId());
    },
    desconectar() {
      desconectar();
      sala?.detener();
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
