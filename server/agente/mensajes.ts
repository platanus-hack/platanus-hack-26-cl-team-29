// Textos del agente: cortos, estilo WhatsApp, español neutro. Sin lógica de negocio.
import type { LicitacionSala, Negocio, OrdenCompra } from './puerto.ts';

const pesos = new Intl.NumberFormat('es-CL');

export const dinero = (monto: number) => `$${pesos.format(Math.round(monto))}`;
export const nota = (valor: number) => valor.toFixed(1).replace('.', ',');

export const totalOrden = (orden: OrdenCompra) =>
  orden.items.reduce((suma, item) => suma + item.cantidad * item.precioUnitario, 0);

/** "4 sacos de harina, 2 cajas de aceite" */
export const detalle = (orden: OrdenCompra) =>
  orden.items.map(item => `${item.cantidad} ${item.producto}`).join(', ');

/** "sacos" de "sacos de harina": para frases como "decía 4 sacos". */
const unidad = (producto: string) => producto.split(' de ')[0];

const opciones = (...lineas: string[]) => lineas.map((l, i) => `${i + 1}. ${l}`).join('\n');

export const NO_REGISTRADO = 'Hola. No encuentro tu negocio en la red. Pide que lo registren para empezar a usar Dominó.';
export const NADA_PENDIENTE = 'No tengo nada pendiente por confirmar.';
export const CANCELADO = 'Listo, no hice nada.';
export const AYUDA_COMPRADOR = 'Puedo pedir a tus proveedores por ti. Escribe, por ejemplo: "pide 4 sacos de harina".';
export const AYUDA_PROVEEDOR = 'Escribe "pedidos" para ver tus pedidos nuevos.';
export const CUANTOS_FALTARON = 'Cuéntame cuántos faltaron. Por ejemplo: "faltaron 2".';
export const SIN_PROVEEDOR = 'No encontré proveedores en la red para ese pedido.';
export const SIN_PEDIDOS = 'No tienes pedidos nuevos por ahora.';

export const noEntendi = (pregunta: string) => `No te entendí.\n\n${pregunta}`;
export const fallo = (error: unknown) =>
  `No pude completarlo: ${error instanceof Error ? error.message : String(error)}. Si quieres reintentar, responde "sí".`;

export function proponerPedido(cantidad: number, producto: string, proveedor: Negocio, notaProveedor: number): string {
  return `Te propongo pedir ${cantidad} ${producto} a ${proveedor.nombre} (${proveedor.comuna}), nota ${nota(notaProveedor)}. ¿Envío la orden de compra?\n`
    + opciones('Sí, envíala', 'No');
}

export const ordenEnviada = (orden: OrdenCompra, proveedor: Negocio) =>
  `Listo, envié la orden de compra a ${proveedor.nombre}: ${detalle(orden)}, ${dinero(totalOrden(orden))}. Te aviso cuando llegue la factura.`;

export function pedidosNuevos(ordenes: readonly OrdenCompra[], compradores: ReadonlyMap<string, Negocio>): string {
  const total = ordenes.reduce((s, o) => s + totalOrden(o), 0);
  if (ordenes.length === 1) {
    const [orden] = ordenes;
    const comprador = compradores.get(orden.compradorId)?.nombre ?? 'un negocio';
    return `Nuevo pedido de ${comprador}: ${detalle(orden)}, ${dinero(total)}. ¿Lo confirmo y facturo?\n` + opciones('Sí, factura', 'No');
  }
  return `Tienes ${ordenes.length} pedidos nuevos por ${dinero(total)}. ¿Los confirmo y facturo?\n` + opciones('Sí, factura todo', 'No');
}

export function facturasEmitidas(ordenes: readonly OrdenCompra[], compradores: ReadonlyMap<string, Negocio>): string {
  if (ordenes.length === 1) {
    const comprador = compradores.get(ordenes[0].compradorId)?.nombre ?? 'tu cliente';
    return `Listo, emití la factura en el SII con su guía de despacho. Ya le avisé a ${comprador}.`;
  }
  return `Listo, emití ${ordenes.length} facturas en el SII con sus guías de despacho. Ya les avisé a tus clientes.`;
}

export function llegoFactura(orden: OrdenCompra, proveedor: Negocio): string {
  const [item] = orden.items;
  const despachada = item.cantidadDespachada ?? item.cantidad;
  const guia = despachada === item.cantidad
    ? 'La guía de despacho coincide con tu orden de compra.'
    : `Tu orden de compra decía ${item.cantidad} ${unidad(item.producto)}, pero la guía de despacho dice ${despachada}.`;
  return `Llegó la factura de ${proveedor.nombre}. ${detalle(orden)}, ${dinero(totalOrden(orden))}. ${guia} ¿Recibiste todo?\n`
    + opciones('Sí, todo bien', 'No, faltó algo');
}

export const recepcionConforme = (proveedor: Negocio) =>
  `Listo, quedó recibida conforme. Eso suma a la nota de ${proveedor.nombre}.`;

export function proponerReclamo(orden: OrdenCompra, faltante: number): string {
  const [item] = orden.items;
  return `Voy a reclamar la factura en el SII por falta parcial: faltaron ${faltante} de ${item.cantidad} ${unidad(item.producto)}. Es un trámite legal. ¿Lo hago?\n`
    + opciones('Sí, reclámala', 'No');
}

export function reclamoRegistrado(p: {
  proveedor: Negocio; diasPlazo: number; notaAntes: number; notaDespues: number; clientes: number;
}): string {
  const plazo = p.diasPlazo > 0 ? ` Te quedaban ${p.diasPlazo} ${p.diasPlazo === 1 ? 'día' : 'días'} de plazo.` : '';
  const cambio = p.notaDespues < p.notaAntes ? `bajó a ${nota(p.notaDespues)}` : `quedó en ${nota(p.notaDespues)}`;
  return `Listo, la reclamé en el SII por falta parcial.${plazo} ${p.proveedor.nombre} tiene que emitirte una nota de crédito. `
    + `Su nota ${cambio} para los ${p.clientes} negocios que le compran.`;
}

export function avisoReclamo(orden: OrdenCompra, comprador: Negocio, faltante: number, monto: number): string {
  return `${comprador.nombre} reclamó en el SII la factura de ${detalle(orden)}: faltaron ${faltante}. ¿Emito nota de crédito por ${dinero(monto)}?\n`
    + opciones('Sí, emítela', 'No');
}

export function notaCreditoEmitida(p: { comprador: Negocio; mismoDia: boolean; notaAntes: number; notaDespues: number }): string {
  const resuelto = p.mismoDia ? 'Lo resolviste el mismo día: tu' : 'Tu';
  const cambio = p.notaDespues > p.notaAntes
    ? `nota sube de ${nota(p.notaAntes)} a ${nota(p.notaDespues)}`
    : `nota queda en ${nota(p.notaDespues)}`;
  return `Nota de crédito emitida en el SII, amarrada a la factura original. Ya le avisé a ${p.comprador.nombre}. ${resuelto} ${cambio}.`;
}

export const avisoNotaCredito = (proveedor: Negocio, monto: number, faltante: number) =>
  `${proveedor.nombre} emitió la nota de crédito por ${dinero(monto)} por las ${faltante} unidades que faltaron. Quedó amarrada a tu factura en el SII.`;

// --- Compra conjunta de la sala ---

/** "caja" / "cajas" según la cantidad; usa el plural que entrega la red si viene. */
export function unidadDe(l: Pick<LicitacionSala, 'unidad' | 'unidadPlural'>, n: number): string {
  if (n === 1) return l.unidad;
  if (l.unidadPlural) return l.unidadPlural;
  return /[aeiou]$/i.test(l.unidad) ? `${l.unidad}s` : `${l.unidad}es`;
}

const negociosTexto = (n: number) => `${n} ${n === 1 ? 'negocio' : 'negocios'}`;

export const preguntaSala = (l: LicitacionSala) => `¿Cómo se llama tu negocio y cuántas ${unidadDe(l, 2)} quieres?`;

/** " (solo pagarías $32.000)", solo si el grupo ya consiguió un precio mejor. */
const versusSolo = (l: LicitacionSala) => (l.precioActual < l.precioSolo ? ` (solo pagarías ${dinero(l.precioSolo)})` : '');

export function bienvenidaSala(l: LicitacionSala, pregunta: string, urlPublica: string | null): string {
  const n = l.participantes.length;
  const quienes = n === 0 ? 'puedes ser el primero en sumarte' : `ya se ${n === 1 ? 'sumó' : 'sumaron'} ${negociosTexto(n)}`;
  const web = urlPublica ? `\n\nTambién puedes sumarte en ${urlPublica.replace(/\/+$/, '')}/app` : '';
  return `Hola. La sala está comprando ${l.producto} en conjunto. Hoy va en ${dinero(l.precioActual)} por ${l.unidad}${versusSolo(l)} `
    + `y ${quienes}.\n\n${pregunta}${web}`;
}

export const pedirCantidadSala = (nombre: string, l: LicitacionSala) => `Perfecto, ${nombre}. ¿Cuántas ${unidadDe(l, 2)} quieres?`;
export const pedirNombreSala = (cantidad: number, l: LicitacionSala) =>
  `Anotado: ${cantidad} ${unidadDe(l, cantidad)}. ¿Cómo se llama tu negocio?`;
export const preguntarUnidadSala = (l: LicitacionSala) =>
  `Aquí se compra por ${l.unidad}. ¿Cuántas ${unidadDe(l, 2)} quieres?`;
export const cantidadFueraDeRango = (maximo: number, l: LicitacionSala) =>
  `Cada negocio puede sumar entre 1 y ${maximo} ${unidadDe(l, maximo)}. ¿Cuántas quieres?`;

/** "Hoy va en $X (solo pagarías $Y). Faltan N cajas para bajar a $Z: invita a otro." */
function precioYFaltante(l: LicitacionSala): string {
  const siguiente = l.siguienteTramo
    ? `Faltan ${l.siguienteTramo.faltan} ${unidadDe(l, l.siguienteTramo.faltan)} para bajar a ${dinero(l.siguienteTramo.precioUnitario)}: invita a otro.`
    : 'Ya está en el mejor precio.';
  return `Hoy va en ${dinero(l.precioActual)}${versusSolo(l)}. ${siguiente}`;
}

export const unidoSala = (nombre: string, cantidad: number, l: LicitacionSala, actualizado: boolean) =>
  `Listo, ${nombre} ${actualizado ? 'ahora va' : 'entra'} con ${cantidad} ${unidadDe(l, cantidad)}. ${precioYFaltante(l)}`;

export const estadoParticipante = (nombre: string, cantidad: number, l: LicitacionSala) =>
  `${nombre} va con ${cantidad} ${unidadDe(l, cantidad)}. ${precioYFaltante(l)} Para cambiar la cantidad, escribe el número.`;

export const bajoPrecio = (precio: number, l: LicitacionSala) =>
  `¡Bajó a ${dinero(precio)} por ${l.unidad}! Ya son ${negociosTexto(l.participantes.length)}.`;

export function cierreAlProveedor(r: { negocios: number; unidades: number; precio: number; total: number }, l: LicitacionSala): string {
  return `Cerró la compra conjunta: ${negociosTexto(r.negocios)}, ${r.unidades} ${unidadDe(l, r.unidades)} a ${dinero(r.precio)}. `
    + `Total ${dinero(r.total)}. ¿Las facturo todas en el SII?\n` + opciones('Sí, factura todo', 'Todavía no');
}

export const facturasDeLaSala = (cantidad: number) =>
  `Listo, emití ${cantidad} ${cantidad === 1 ? 'factura' : 'facturas'} en el SII en un solo envío. Cada negocio recibe su folio por aquí.`;

export function folioAlComprador(p: { folio: number; cantidad: number; precio: number; precioSolo: number }, l: Pick<LicitacionSala, 'unidad' | 'unidadPlural'>): string {
  const total = p.cantidad * p.precio;
  const ahorro = p.cantidad * (p.precioSolo - p.precio);
  return `Tu factura folio ${p.folio} fue emitida en el SII: ${p.cantidad} ${unidadDe(l, p.cantidad)} a ${dinero(p.precio)}, total ${dinero(total)}.`
    + (ahorro > 0 ? ` Ahorraste ${dinero(ahorro)}.` : '');
}

export const siiAcepto = (folio: number) => `El SII aceptó tu factura folio ${folio}.`;

export const SIN_COMPRA_ABIERTA = 'En este momento no hay una compra conjunta abierta.';
export const COMPRA_CERRADA = 'La compra conjunta ya cerró. Te escribo por aquí con tu folio apenas salga tu factura.';
export const YA_FACTURADA = 'Esas facturas ya están emitidas en el SII.';
export const ERROR_TEMPORAL = 'Tuve un problema con tu mensaje. Intenta de nuevo en un momento.';
