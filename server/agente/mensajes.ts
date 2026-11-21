// Textos del agente: cortos, estilo WhatsApp, español neutro. Sin lógica de negocio.
import type { ItemCarrito, LicitacionSala, Negocio, OrdenCompra, ProductoCompra } from './puerto.ts';
import { cortoDe, pluralDe, productosDe } from './canasta.ts';

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

/**
 * Un bloque de 4 a 10 líneas numeradas ("1. Rollos, $32.000 por caja"), para mandarlo como lista desplegable de
 * WhatsApp: el título es lo que va antes de la coma y la descripción, el resto. `null` si no hay un bloque así.
 */
export function separarLista(texto: string): { cuerpo: string; filas: { titulo: string; descripcion: string }[] } | null {
  const lineas = texto.split('\n');
  const inicio = lineas.findIndex(l => /^\s*1\. /.test(l));
  if (inicio < 0) return null;
  let fin = inicio;
  while (fin < lineas.length && new RegExp(`^\\s*${fin - inicio + 1}\\. `).test(lineas[fin]!)) fin++;
  const bloque = lineas.slice(inicio, fin);
  if (bloque.length < 4 || bloque.length > 10) return null;
  const recortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
  const filas = bloque.map(l => {
    const sinNumero = l.replace(/^\s*\d+\. /, '').trim();
    const coma = sinNumero.indexOf(',');
    const titulo = coma > 0 ? sinNumero.slice(0, coma) : sinNumero;
    return { titulo: recortar(titulo.trim(), 24), descripcion: coma > 0 ? recortar(sinNumero.slice(coma + 1).trim(), 72) : '' };
  });
  const cuerpo = [...lineas.slice(0, inicio), ...lineas.slice(fin)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cuerpo ? { cuerpo, filas } : null;
}

/** Título de un botón de WhatsApp: máximo 20 caracteres. */
const TITULO_BOTON_MAX = 20;

/**
 * Las opciones con que termina un mensaje ("1. Sí, envíala\n2. No"), para mandarlas como botones de WhatsApp.
 * `null` si no termina en 2 o 3 opciones cortas: una lista de productos con precios sigue siendo texto.
 */
export function separarOpciones(texto: string): { cuerpo: string; opciones: string[] } | null {
  const lineas = texto.trimEnd().split('\n');
  const finales: string[] = [];
  while (lineas.length > 0 && /^\d+\. /.test(lineas.at(-1)!)) finales.unshift(lineas.pop()!);
  if (finales.length < 2 || finales.length > 3 || lineas.join('').trim() === '') return null;
  const titulos = finales.map((l, i) => (l.startsWith(`${i + 1}. `) ? l.slice(`${i + 1}. `.length).trim() : ''));
  if (titulos.some(t => !t || t.length > TITULO_BOTON_MAX)) return null;
  return { cuerpo: lineas.join('\n').trim(), opciones: titulos };
}

export const NO_REGISTRADO = 'Hola. No encuentro tu negocio en la red. Pide que lo registren para empezar a usar Bando.';
export const NADA_PENDIENTE = 'No tengo nada pendiente por confirmar.';
export const CANCELADO = 'Listo, no hice nada.';
export const AYUDA_COMPRADOR = 'Puedo pedir a tus proveedores por ti. Escribe, por ejemplo: "pide 4 sacos de harina".';
export const AYUDA_PROVEEDOR = 'Escribe "pedidos" para ver tus pedidos nuevos.';
export const CUANTOS_FALTARON = 'Cuéntame cuántos faltaron. Por ejemplo: "faltaron 2".';
export const SIN_PROVEEDOR = 'No encontré proveedores en la red para ese pedido.';
export const proveedorNoEncontrado = (nombre: string, disponibles: readonly string[]) =>
  `No encontré a "${nombre}" entre los proveedores de la red. Puedo pedirle a: ${disponibles.join(', ')}.`;
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

// --- Compra conjunta de la sala (canasta de varios productos) ---

/** "caja" / "cajas" según la cantidad; usa el plural que entrega la red si viene. */
export function unidadDe(p: Pick<ProductoCompra, 'unidad' | 'unidadPlural'>, n: number): string {
  return n === 1 ? p.unidad : pluralDe(p.unidad, p.unidadPlural);
}

const negociosTexto = (n: number) => `${n} ${n === 1 ? 'negocio' : 'negocios'}`;
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "la caja" / "el rollo": la gente escribe en femenino o masculino según la unidad. */
const articulo = (p: Pick<ProductoCompra, 'unidad'>) => (/a$/i.test(p.unidad) ? 'la' : 'el');
const cuantas = (p: Pick<ProductoCompra, 'unidad'>) => (/a$/i.test(p.unidad) ? 'Cuántas' : 'Cuántos');

/** "4 cajas de rollos" */
export const itemTexto = (p: ProductoCompra, cantidad: number) => `${cantidad} ${unidadDe(p, cantidad)} de ${cortoDe(p)}`;

function lineasDe(items: readonly ItemCarrito[], l: LicitacionSala): { p: ProductoCompra; cantidad: number }[] {
  const productos = productosDe(l);
  return items.flatMap(i => {
    const p = productos.find(x => x.id === i.productoId);
    return p ? [{ p, cantidad: i.cantidad }] : [];
  });
}

const listaItems = (items: readonly ItemCarrito[], l: LicitacionSala) =>
  lineasDe(items, l).map(x => itemTexto(x.p, x.cantidad)).join(', ');

/** "Total $133.400, ahorras $8.400." */
function totalYAhorro(items: readonly ItemCarrito[], l: LicitacionSala): string {
  const lineas = lineasDe(items, l);
  const total = lineas.reduce((s, x) => s + x.cantidad * x.p.precioActual, 0);
  const ahorro = lineas.reduce((s, x) => s + x.cantidad * Math.max(0, x.p.precioSolo - x.p.precioActual), 0);
  return `Total ${dinero(total)}${ahorro > 0 ? `, ahorras ${dinero(ahorro)}` : ''}.`;
}

/** El tramo más cercano entre lo que lleva (o de toda la canasta si no lleva nada): "Faltan 3 cajas de rollos para bajar a $27.900." */
function siguienteTramo(items: readonly ItemCarrito[], l: LicitacionSala): string {
  const mios = new Set(items.map(i => i.productoId));
  const conTramo = productosDe(l).filter(p => p.siguienteTramo && (mios.size === 0 || mios.has(p.id)));
  const [p] = conTramo.sort((a, b) => a.siguienteTramo!.faltan - b.siguienteTramo!.faltan);
  if (!p) return 'Ya está en el mejor precio.';
  const { faltan, precioUnitario } = p.siguienteTramo!;
  return `${faltan === 1 ? 'Falta' : 'Faltan'} ${itemTexto(p, faltan)} para bajar a ${dinero(precioUnitario)}.`;
}

/** "Ej: 4 cajas de rollos y 2 de etiquetas" */
function ejemplo(l: LicitacionSala): string {
  const [a, b] = productosDe(l);
  return b ? `Ej: ${itemTexto(a, 4)} y 2 de ${cortoDe(b)}` : `Ej: 4 ${unidadDe(a, 4)}`;
}

/** "1. Rollos, $29.900 por caja (bajó de $32.000)" */
const listaNumerada = (l: LicitacionSala) => productosDe(l).map((p, i) =>
  `${i + 1}. ${mayuscula(cortoDe(p))}, ${dinero(p.precioActual)} por ${p.unidad}`
  + (p.precioActual < p.precioSolo ? ` (bajó de ${dinero(p.precioSolo)})` : '')).join('\n');

export const preguntaSala = (l: LicitacionSala) => `¿Cómo se llama tu negocio y qué quieres? ${ejemplo(l)}`;

export function bienvenidaSala(l: LicitacionSala, pregunta: string, urlPublica: string | null): string {
  const n = l.participantes.length;
  const quienes = n === 0 ? 'Puedes ser el primero.' : `Ya ${n === 1 ? 'va' : 'van'} ${negociosTexto(n)}.`;
  const web = urlPublica ? `\n\nTambién puedes sumarte en ${urlPublica.replace(/\/+$/, '')}/app` : '';
  // La pregunta va al final: si trae opciones ("1. Conectar certificado…"), salen como botones de WhatsApp.
  return `Hola. La sala compra en conjunto: mientras más negocios, más baja el precio. ${quienes}\n${listaNumerada(l)}${web}\n\n${pregunta}`;
}

export const listaProductos = (l: LicitacionSala) => `Precios de hoy:\n${listaNumerada(l)}\n\nEscribe lo que quieres. ${ejemplo(l)}`;
export const pedirCarritoSala = (nombre: string, l: LicitacionSala) => `Perfecto, ${nombre}. ¿Qué quieres? ${ejemplo(l)}`;
export const pedirNombreSala = (items: readonly ItemCarrito[], l: LicitacionSala) =>
  `Anotado: ${listaItems(items, l)}. ¿Cómo se llama tu negocio?`;
/** Se pide una vez, antes de sumarse: sin RUT válido no hay factura. */
export const pedirRut = (nombre?: string) =>
  `${nombre ? `${nombre}, ¿cuál` : '¿Cuál'} es el RUT de tu negocio? Tu factura sale a tu nombre en el SII (ambiente de certificación). Ej: 12.345.678-5`;
export const rutConError = (mensaje: string) => `${mensaje}

¿Cuál es el RUT de tu negocio?`;
export const facturaA = (razonSocial: string) => `Tu factura saldrá a nombre de ${razonSocial}.`;
/** La pregunta del RUT cuando se puede conectar el certificado: tres salidas, una de ellas explícita para la demo. */
export const pedirRutOCertificado = (nombre?: string) =>
  `${nombre ? `${nombre}, para` : 'Para'} que tu factura salga a tu nombre en el SII, conecta tu certificado digital `
  + '(te mando un link privado: la clave no pasa por WhatsApp) o escribe el RUT de tu negocio.\n\n'
  + 'Para la demo puedes saltarlo: tu factura sale a un receptor de prueba en el ambiente de certificación del SII.\n'
  + opciones('Conectar certificado', 'No (demo)');
export const enlaceCertificado = (url: string) =>
  `Conecta tu certificado aquí (link privado, de un solo uso, vence en 15 minutos):\n${url}\n\n`
  + 'Cuando termines, sigo tu registro por acá. También puedes escribir el RUT de tu negocio.';
export const MODO_DEMO = 'Listo, modo demo: tu factura sale a un receptor de prueba en el ambiente de certificación del SII.';
export const CERTIFICADO_CONECTADO = 'Certificado conectado ✓ Tu RUT sale de él: no tienes que escribirlo.';
export const preguntarCantidad = (p: ProductoCompra) => `¿${cuantas(p)} ${unidadDe(p, 2)} de ${cortoDe(p)} quieres?`;
export const preguntarProducto = (cantidad: number, l: LicitacionSala) =>
  `¿${cantidad} de cuál?\n${productosDe(l).map((p, i) => `${i + 1}. ${mayuscula(cortoDe(p))}`).join('\n')}\nEj: "${cantidad} de ${cortoDe(productosDe(l)[0])}" o "${cantidad} del 1".`;
export const cantidadFueraDeRango = (maximo: number) =>
  `Cada negocio puede pedir entre 1 y ${maximo} por producto. Escribe la cantidad de nuevo.`;

/** Tras cada cambio, en 3 líneas: el carrito, total y ahorro, y el tramo más cercano. */
export const carritoActualizado = (nombre: string, items: readonly ItemCarrito[], l: LicitacionSala, actualizado: boolean) =>
  `Listo, ${nombre} ${actualizado ? 'ahora va' : 'entra'} con ${listaItems(items, l)}.\n${totalYAhorro(items, l)}\n${siguienteTramo(items, l)}`;

/** "mi pedido": cada línea con su precio. */
export function resumenCarrito(nombre: string, items: readonly ItemCarrito[], l: LicitacionSala): string {
  const lineas = lineasDe(items, l).map(x => `${itemTexto(x.p, x.cantidad)} a ${dinero(x.p.precioActual)}: ${dinero(x.cantidad * x.p.precioActual)}`);
  const ultimo = productosDe(l).at(-1)!;
  return `Tu pedido, ${nombre}:\n${lineas.join('\n')}\n${totalYAhorro(items, l)} ${siguienteTramo(items, l)}\n`
    + `Para cambiarlo, escribe por ejemplo "agrega 2 de ${cortoDe(ultimo)}" o "quita ${cortoDe(ultimo)}".`;
}

export const confirmarSalida = (porVaciar: boolean) =>
  `${porVaciar ? 'Así tu pedido queda vacío y sales de la compra.' : 'Vas a salir de la compra y se borra tu pedido.'} ¿Te saco?\n`
  + opciones('Sí, sácame', 'No');
export const SALISTE = 'Listo, saliste de la compra conjunta. Si cambias de opinión, escribe lo que quieres.';
export const sigues = (items: readonly ItemCarrito[], l: LicitacionSala) =>
  `Perfecto, sigues en la compra con ${listaItems(items, l)}.`;
export const noParticipas = (l: LicitacionSala) => `Aún no estás en la compra conjunta. ${preguntaSala(l)}`;

/** Una oferta de un proveedor que compite por la compra conjunta. */
export interface OfertaSala { readonly proveedorNombre: string; readonly precioUnitario: number; readonly productoId?: string }

export interface BajaDePrecio { readonly producto: ProductoCompra; readonly precio: number; readonly ofertas: readonly OfertaSala[] }

/**
 * Una difusión para todas las bajas de la ventana. Sin ofertas: "¡Bajó la caja de rollos a $27.900! Ya son 3 negocios.";
 * con ofertas, cuenta por qué bajó: "X ofertó $P. Y respondió $Q. La caja de rollos ya va en $Q."
 */
export function bajoPrecio(bajas: readonly BajaDePrecio[], negocios: number): string {
  const ya = `Ya son ${negociosTexto(negocios)}.`;
  const cosa = (b: BajaDePrecio) => `${articulo(b.producto)} ${b.producto.unidad} de ${cortoDe(b.producto)}`;
  const porOferta = bajas.filter(b => b.ofertas.length > 0).map(b => {
    const porque = b.ofertas.map((o, k) => `${o.proveedorNombre} ${k === 0 ? 'ofertó' : 'respondió'} ${dinero(o.precioUnitario)}.`).join(' ');
    return `${porque} ${mayuscula(cosa(b))} ya va en ${dinero(b.precio)}.`;
  });
  const porTramo = bajas.filter(b => b.ofertas.length === 0);
  const tramo = porTramo.length === 0 ? []
    : porTramo.length === 1 ? [`¡Bajó ${cosa(porTramo[0])} a ${dinero(porTramo[0].precio)}! ${ya}`]
    : [`¡Bajaron los precios! ${mayuscula(porTramo.map(b => `${cosa(b)} a ${dinero(b.precio)}`).join(', '))}. ${ya}`];
  return [...porOferta, ...tramo].join('\n');
}

export function cierreAlProveedor(r: { negocios: number; lineas: readonly string[]; total: number }): string {
  return `Cerró la compra conjunta: ${negociosTexto(r.negocios)}, ${r.lineas.join(', ')}. `
    + `Total ${dinero(r.total)}. ¿Las facturo todas en el SII?\n` + opciones('Sí, factura todo', 'Todavía no');
}

export const facturasDeLaSala = (cantidad: number) =>
  `Listo, emití ${cantidad} ${cantidad === 1 ? 'factura' : 'facturas'} en el SII en un solo envío. Cada negocio recibe su folio por aquí.`;

export const folioAlComprador = (p: { folio: number; lineas: readonly string[]; total: number; ahorro: number; pdf?: string | null }) =>
  `Tu factura folio ${p.folio} fue emitida en el SII: ${p.lineas.join(', ')}. Total ${dinero(p.total)}.`
  + (p.ahorro > 0 ? ` Ahorraste ${dinero(p.ahorro)}.` : '')
  + (p.pdf ? `\nDescárgala: ${p.pdf}` : '');

export const leyendaPdf = (folio: number) => `Factura folio ${folio}`;

export const siiAcepto = (folio: number) => `El SII aceptó tu factura folio ${folio}.`;

export const SIN_COMPRA_ABIERTA = 'En este momento no hay una compra conjunta abierta.';
export const COMPRA_CERRADA = 'La compra conjunta ya cerró. Te escribo por aquí con tu folio apenas salga tu factura.';
export const YA_FACTURADA = 'Esas facturas ya están emitidas en el SII.';
export const ERROR_TEMPORAL = 'Tuve un problema con tu mensaje. Intenta de nuevo en un momento.';
