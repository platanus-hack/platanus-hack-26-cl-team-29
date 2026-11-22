// Textos del agente: cortos, estilo WhatsApp, español neutro. Sin lógica de negocio.
import type { ItemCarrito, LicitacionSala, Negocio, OrdenCompra, ProductoCompra } from './puerto.ts';
import { dinero, miles, nota } from '../../shared/formato.ts';
import { horaEnChile } from '../../shared/fecha.ts';
import { formatearRut } from '../../shared/rut.ts';
import type { Tramo } from '../../shared/precios.ts';
import { totalOrden } from '../../shared/precios.ts';
import { contar, cuantos, mayuscula, pluralDe, segun } from '../../shared/texto.ts';
import { cortoDe, productosDe } from './canasta.ts';


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
export const AYUDA_PROVEEDOR = 'Escribe "pedidos" para ver tus pedidos nuevos. En la compra conjunta: "oferto $25.000 por rollos", '
  + '"vendo café molido 1 kg a $12.000 la bolsa" para sumar un producto, o "mis ofertas".';
/** Quien compra y también vende. */
export const AYUDA_COMPRA_Y_VENDE = `${AYUDA_PROVEEDOR}\nPara comprar en la compra conjunta, escribe lo que quieres. Ej: "3 cajas de rollos".`;
export const CUANTOS_FALTARON = 'Cuéntame cuántos faltaron. Por ejemplo: "faltaron 2".';
export const SIN_PROVEEDOR = 'No encontré proveedores en la red para ese pedido.';
export const proveedorNoEncontrado = (nombre: string, disponibles: readonly string[]) =>
  `No encontré a "${nombre}" entre los proveedores de la red. Puedo pedirle a: ${disponibles.join(', ')}.`;
export const SIN_PEDIDOS = 'No tienes pedidos nuevos por ahora.';

export const noEntendi = (pregunta: string) => `No te entendí.\n\n${pregunta}`;
export const fallo = (error: unknown) =>
  `No pude completarlo: ${error instanceof Error ? error.message : String(error)}. Si quieres reintentar, responde "sí".`;

export const elegirProducto = (escrito: string, parecidos: readonly { nombre: string; unidad: string }[], puedeCrear = true) =>
  `En Bando ya hay productos parecidos a "${escrito}". ¿Cuál es?\n`
  + opciones(...parecidos.map(p => `${p.nombre} (por ${p.unidad})`), ...(puedeCrear ? [`Otro: crear "${escrito}"`] : []));
export const nadieLoVende = (escrito: string) =>
  `Ningún proveedor vende "${escrito}" en Bando todavía. Cuando alguno lo agregue a su lista, podrás comprarlo en grupo.`;
export const proponerSumarse = (p: ProductoCompra, cantidad: number, cierraEn: string) =>
  `Hay una compra en grupo abierta de "${p.nombre}"${p.precioActual > 0 ? `, hoy a ${dinero(p.precioActual)} por ${p.unidad}` : ', esperando ofertas de proveedores'}. `
  + `Cierra a las ${horaEnChile(Date.parse(cierraEn))}. ¿Te sumo con ${contar(cantidad, p.unidad, p.unidadPlural)}?\n` + opciones('Sí, súmame', 'No');
export const sumadoAOtraCompra = (producto: string, total: number) =>
  `Listo, vas con ${total} en la compra en grupo de "${producto}". Mientras más negocios se suman, más baja el precio.`;
/** Ofrece abrir una compra en grupo; con `hoy` (lo que dan las listas), cuántos lo venden y a cuánto sale su cantidad. */
export const proponerSolicitud = (producto: string, cantidad: number, unidad: string, hoy?: { proveedores: number; precio: number }) =>
  (hoy
    ? `"${producto}": ${contar(hoy.proveedores, 'proveedor', 'proveedores')} ${segun(hoy.proveedores, 'lo vende', 'lo venden')} en Bando. `
      + `Con tus ${miles(cantidad)}, hoy sale a ${dinero(hoy.precio)} por ${unidad}. ¿Abro una compra en grupo? `
      + 'Si se suman otros negocios, el precio puede bajar para todos. Cierra en 24 horas.\n'
    : `¿Abro una compra en grupo de "${producto}" con tus ${miles(cantidad)}? `
      + 'Otros negocios se suman, los proveedores ofertan y gana el mejor precio para todo el grupo. Cierra en 24 horas.\n')
  + opciones('Sí, ábrela', 'No');
export const SIN_COMPRA_PARA_CERRAR = 'No tienes compras en grupo abiertas iniciadas por ti. Solo quien inicia una compra en grupo la puede cerrar antes.';
export const cualCerrar = (productos: readonly string[]) =>
  `Tienes ${contar(productos.length, 'compra en grupo abierta', 'compras en grupo abiertas')}: ${productos.map(p => `"${p}"`).join(', ')}. `
  + `Escribe, por ejemplo, "cerrar compra de ${productos[0]}".`;
export const todaviaNoSeCierra = (producto: string, minimo?: number, unidades?: number) =>
  minimo && unidades !== undefined && unidades < minimo
    ? `Todavía no puedes cerrar "${producto}": el proveedor que gana pide un mínimo de ${miles(minimo)} y van ${miles(unidades)}.`
    : `Todavía no puedes cerrar "${producto}": ningún proveedor ha ofertado aún.`;
export const proponerCierre = (producto: string, negocios: number, unidades: number, precio: number, unidad: string) =>
  `¿Cierro ahora la compra en grupo de "${producto}"? Van ${contar(negocios, 'negocio')} con ${miles(unidades)} en total, `
  + `a ${dinero(precio)} por ${unidad}. El proveedor que gana recibe los pedidos.\n` + opciones('Sí, ciérrala', 'No');
export const compraCerradaAntes = (producto: string, pedidos: number) =>
  `Listo, cerraste la compra en grupo de "${producto}". El proveedor recibió ${contar(pedidos, 'pedido')} para confirmar y facturar.`;
export const solicitudAbierta = (producto: string, cantidad: number, cierraEn: string) =>
  `Listo, abriste una compra en grupo de "${producto}" con tus ${cantidad}. Cierra mañana a las ${horaEnChile(Date.parse(cierraEn))}. `
  + 'Les avisamos a los negocios de la red para que se sumen.';
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
  const plazo = p.diasPlazo > 0 ? ` Te quedaban ${contar(p.diasPlazo, 'día')} de plazo.` : '';
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
  return segun(n, p.unidad, pluralDe(p.unidad, p.unidadPlural));
}

/** "la caja" / "el rollo": la gente escribe en femenino o masculino según la unidad. */
/** "la caja", "la unidad", "el rollo". */
const articulo = (p: Pick<ProductoCompra, 'unidad'>) => (/(a|d)$/i.test(p.unidad) ? 'la' : 'el');

/** "4 cajas de rollos" */
export const itemTexto = (p: ProductoCompra, cantidad: number) => `${cantidad} ${unidadDe(p, cantidad)} de ${cortoDe(p)}`;
/** Un número suelto que bajaría lo que lleva: ¿queda en ese número o lo suma? Las opciones salen como botones. */
export const dudaCantidad = (p: ProductoCompra, cantidad: number, lleva: number) =>
  `Llevas ${itemTexto(p, lleva)}. ¿Quedas en ${cantidad} o sumo ${cantidad} (${lleva + cantidad} en total)?\n`
  + opciones(`Quedar en ${cantidad}`, `Sumar (${lleva + cantidad})`);

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
  // Una compra sin ofertas todavía no tiene precio: no se muestra $0.
  if (lineas.some(x => !(x.p.precioActual > 0))) return 'El precio lo ponen los proveedores al ofertar: al cerrar pagas el mejor para el grupo.';
  const total = lineas.reduce((s, x) => s + x.cantidad * x.p.precioActual, 0);
  const ahorro = lineas.reduce((s, x) => s + x.cantidad * Math.max(0, x.p.precioSolo - x.p.precioActual), 0);
  return `Total ${dinero(total)}${ahorro > 0 ? `, ahorras ${dinero(ahorro)}` : ''}.`;
}

/** El tramo más cercano entre lo que lleva (o de toda la canasta si no lleva nada): "Faltan 3 cajas de rollos para bajar a $27.900." */
function siguienteTramo(items: readonly ItemCarrito[], l: LicitacionSala): string {
  const mios = new Set(items.map(i => i.productoId));
  const conTramo = productosDe(l).filter(p => p.siguienteTramo && (mios.size === 0 || mios.has(p.id)));
  const [p] = conTramo.sort((a, b) => a.siguienteTramo!.faltan - b.siguienteTramo!.faltan);
  if (!p && productosDe(l).some(x => !(x.precioActual > 0))) return 'Esperando ofertas de proveedores.';
  if (!p) return 'Ya está en el mejor precio.';
  const { faltan, precioUnitario } = p.siguienteTramo!;
  return `${segun(faltan, 'Falta', 'Faltan')} ${itemTexto(p, faltan)} para bajar a ${dinero(precioUnitario)}.`;
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
  const quienes = n === 0 ? 'Puedes ser el primero.' : `Ya ${segun(n, 'va', 'van')} ${contar(n, 'negocio')}.`;
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
/**
 * Primer mensaje de un número sin registrar: elegir cómo registrarse antes de ver productos. El certificado da más
 * (emitir y revisar facturas en el SII); RUT y dirección basta para comprar. Sin certificado disponible, solo lo segundo.
 */
export const elegirRegistro = (conCertificado: boolean, conVender = false) =>
  'Hola, soy Bando. La sala compra en conjunto y el precio baja para todos.\n\n'
  + 'Para sumarte necesito los datos de tu factura. ¿Cómo quieres registrarte?\n'
  + (conCertificado
    ? '• Certificado digital: además de comprar, emites y revisas tus facturas en el SII desde aquí.\n'
      + '• RUT y dirección: solo para comprar.\n'
      + (conVender ? '• Vender: ofreces tus productos a la sala y facturas con tu certificado. También puedes comprar.\n' : '')
      + opciones('Certificado digital', 'RUT y dirección', ...(conVender ? ['Vender'] : []))
    : 'Escribe el RUT de tu negocio. Ej: 12.345.678-5');
export const enlaceCertificadoRegistro = (url: string) =>
  `Conecta tu certificado aquí (link privado, de un solo uso, vence en 15 minutos):\n${url}\n\n`
  + 'La clave no pasa por WhatsApp. Cuando termines, sigo tu registro por acá. Si prefieres, escribe el RUT de tu negocio.';
/** Sin razón social (el SII no confirmó el RUT): la factura sale a su RUT con el nombre de su negocio. */
export const registroListo = (razonSocial: string | undefined, d: { direccion: string; comuna: string }) =>
  `Listo, quedaste registrado ✓ Tu factura sale ${razonSocial ? `a nombre de ${razonSocial}` : 'a tu RUT'}, ${d.direccion}, ${d.comuna}.`;
export const RUT_SIN_CONFIRMAR = 'No pude confirmar tu RUT en el SII en este momento, pero seguimos: '
  + 'tu factura sale a ese RUT con el nombre de tu negocio y la dirección que me des.';

/** La dirección del SII para su RUT: confirmarla o escribir otra. Las opciones salen como botones. */
export const confirmarDireccion = (d: { direccion: string; comuna: string }) =>
  `¿Tu factura va a ${d.direccion}, ${d.comuna}?\n` + opciones('Sí, es esa', 'Es otra');
export const pedirDireccion = () =>
  '¿Cuál es la dirección de tu negocio para la factura? Escribe calle, número y comuna. Ej: Av. Grecia 1234, Ñuñoa';
export const pedirComuna = () => '¿En qué comuna? Ej: Ñuñoa';
export const direccionNoEntendida = () =>
  'No entendí la dirección. Escribe calle, número (o "s/n") y comuna, separados por una coma. Ej: Av. Grecia 1234, Ñuñoa';
export const enlaceCertificado = (url: string) =>
  `Conecta tu certificado aquí (link privado, de un solo uso, vence en 15 minutos):\n${url}\n\n`
  + 'La clave no pasa por WhatsApp. Cuando termines, te aviso por acá.';
export const CERTIFICADO_CONECTADO = 'Certificado conectado ✓ Ya podemos emitir y revisar tus facturas en el SII a tu nombre.';
export const preguntarCantidad = (p: ProductoCompra) => `¿${cuantos(unidadDe(p, 2))} ${unidadDe(p, 2)} de ${cortoDe(p)} quieres?`;
export const preguntarProducto = (cantidad: number, l: LicitacionSala) =>
  `¿${cantidad} de cuál?\n${productosDe(l).map((p, i) => `${i + 1}. ${mayuscula(cortoDe(p))}`).join('\n')}\nEj: "${cantidad} de ${cortoDe(productosDe(l)[0])}" o "${cantidad} del 1".`;
export const cantidadFueraDeRango = (maximo: number) =>
  `Esa cantidad es demasiado grande (más de ${miles(maximo)}). Escribe la cantidad de nuevo.`;

/** Tras cada cambio, en 3 líneas: el carrito, total y ahorro, y el tramo más cercano. */
export const carritoActualizado = (nombre: string, items: readonly ItemCarrito[], l: LicitacionSala, actualizado: boolean) =>
  `Listo, ${nombre} ${actualizado ? 'ahora va' : 'entra'} con ${listaItems(items, l)}.\n${totalYAhorro(items, l)}\n${siguienteTramo(items, l)}`;

/** "mi pedido": cada línea con su precio. */
export function resumenCarrito(nombre: string, items: readonly ItemCarrito[], l: LicitacionSala): string {
  const lineas = lineasDe(items, l).map(x => (x.p.precioActual > 0
    ? `${itemTexto(x.p, x.cantidad)} a ${dinero(x.p.precioActual)}: ${dinero(x.cantidad * x.p.precioActual)}`
    : `${itemTexto(x.p, x.cantidad)}, esperando ofertas`));
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
  const ya = `Ya son ${contar(negocios, 'negocio')}.`;
  const cosa = (b: BajaDePrecio) => `${articulo(b.producto)} ${b.producto.unidad} de ${cortoDe(b.producto)}`;
  const porOferta = bajas.filter(b => b.ofertas.length > 0).map(b => {
    // Con tramos, el precio base de la oferta no es el del grupo: entonces se dice quién ofertó, sin su precio base.
    const conPrecio = b.ofertas.at(-1)!.precioUnitario === b.precio;
    const porque = b.ofertas.map((o, k) => `${o.proveedorNombre} ${k === 0 ? 'ofertó' : 'respondió'}${conPrecio ? ` ${dinero(o.precioUnitario)}` : ''}.`).join(' ');
    return `${porque} ${mayuscula(cosa(b))} ya va en ${dinero(b.precio)}.`;
  });
  const porTramo = bajas.filter(b => b.ofertas.length === 0);
  const tramo = porTramo.length === 0 ? []
    : porTramo.length === 1 ? [`¡Bajó ${cosa(porTramo[0])} a ${dinero(porTramo[0].precio)}! ${ya}`]
    : [`¡Bajaron los precios! ${mayuscula(porTramo.map(b => `${cosa(b)} a ${dinero(b.precio)}`).join(', '))}. ${ya}`];
  return [...porOferta, ...tramo].join('\n');
}

export function cierreAlProveedor(r: { negocios: number; lineas: readonly string[]; total: number }): string {
  return `Cerró la compra conjunta: ${contar(r.negocios, 'negocio')}, ${r.lineas.join(', ')}. `
    + `Total ${dinero(r.total)}. ¿Las facturo todas en el SII?\n` + opciones('Sí, factura todo', 'Todavía no');
}

export const facturasDeLaSala = (cantidad: number) =>
  `Listo, emití ${contar(cantidad, 'factura')} en el SII en un solo envío. Cada negocio recibe su folio por aquí.`;

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

// --- Proveedores por WhatsApp (server/agente/proveedor.ts) ---

/** La salida de prueba sin certificado (DEMO_PROVEEDOR_SIN_CERTIFICADO=1). */
const PRUEBA_SIN_CERTIFICADO = '\n\nPrueba sin certificado: escribe el RUT de tu negocio y sigues sin él. Tus facturas saldrán simuladas.';
export const registroProveedor = (url: string, sinCertificado = false) =>
  'Para vender en Bando necesitas tu certificado digital: con él emites tus facturas en el SII (ambiente de certificación). '
  + `Súbelo aquí (link privado, de un solo uso, vence en 15 minutos):\n${url}\n\n`
  + 'La clave no pasa por WhatsApp. Cuando termines, sigo tu registro por acá. Para no seguir, escribe "cancelar".'
  + (sinCertificado ? PRUEBA_SIN_CERTIFICADO : '');
export const esperandoCertificado = (url: string, sinCertificado = false) =>
  `Te espero con tu certificado digital. Si el link anterior venció, usa este:\n${url}\n\nPara no seguir, escribe "cancelar".`
  + (sinCertificado ? PRUEBA_SIN_CERTIFICADO : '');
export const SIN_CERTIFICADO_SIMULADAS = 'Quedaste sin certificado (prueba): tus facturas saldrán simuladas, no van al SII.';
export const REGISTRO_PROVEEDOR_CANCELADO = 'Listo, no seguimos con tu registro de proveedor. Si cambias de opinión, escribe "quiero vender".';
export const preguntarEmpresa = (rutTitular: string) =>
  `Certificado conectado ✓ ¿Con qué RUT facturas?\n• Tu RUT: ${formatearRut(rutTitular)}\n• O el de una empresa en que estás autorizado en el SII.\n`
  + opciones('Mi RUT', 'Otra empresa');
export const PEDIR_RUT_EMPRESA = 'Escribe el RUT de la empresa con que facturas. Ej: 76.123.456-7';
export const proveedorRegistrado = (nombre: string, conectandoSii: boolean) =>
  `Listo, ${nombre} ya vende en Bando ✓ ${conectandoSii ? 'Estoy conectando tu SII (datos, resolución y folios); te aviso cuando esté listo.' : ''}\n\n`
  + 'Para sumar un producto a la compra conjunta: "vendo café molido 1 kg a $12.000 la bolsa". '
  + 'Para ofertar por uno que ya está: "oferto $25.000 por rollos". También puedes seguir comprando.';
export const SII_LISTO = 'Tu SII quedó conectado ✓ Tus facturas de la compra conjunta saldrán a tu nombre en el SII.';
export const siiNoConectado = (detalle: string | null) =>
  `No pude terminar de conectar tu SII${detalle ? `: ${detalle}` : '.'} Mientras, tus facturas saldrán simuladas. `
  + 'Puedes volver a intentarlo escribiendo "conectar certificado".';

export const elegirProductoParaOfertar = (productos: readonly ProductoCompra[], ejemplo: (p: ProductoCompra) => string) =>
  `¿Por cuál producto? Los de la compra conjunta:\n${productos.map(p => `• ${p.nombre}: hoy ${dinero(p.precioActual)} por ${p.unidad}`).join('\n')}\n`
  + `Escribe por ejemplo "${ejemplo(productos[0]!)}".`;
export const proponerOferta = (p: ProductoCompra, precio: number) =>
  `¿Ofertas ${dinero(precio)} por ${p.unidad} de ${cortoDe(p)}? Hoy el grupo paga ${dinero(p.precioActual)}`
  + `${p.totalUnidades > 0 ? ` y lleva ${contar(p.totalUnidades, p.unidad, p.unidadPlural)}` : ''}.\n`
  + opciones('Sí, ofertar', 'No');
export const ofertaHecha = (p: ProductoCompra, precio: number, ganando: boolean) =>
  `Listo, ofertaste ${dinero(precio)} por ${p.unidad} de ${cortoDe(p)}. `
  + (ganando ? 'Vas ganando ✓ Te aviso si alguien te supera.' : `El mejor precio sigue en ${dinero(p.precioActual)}.`);
export const teSuperaron = (p: ProductoCompra, quien: string, precio: number) =>
  `${quien} ofertó ${dinero(precio)} por ${p.unidad} de ${cortoDe(p)} y ya no vas ganando. `
  + `Para responder, escribe por ejemplo "oferto ${dinero(Math.max(precio - 100, 1))} por ${cortoDe(p)}".`;
export const productoYaExiste = (nombre: string) =>
  `"${nombre}" ya está en la compra conjunta. Para competir, oferta por él: "oferto $X por ${nombre.toLowerCase()}".`;
export const proponerProducto = (nombre: string, unidad: string, tramos: readonly Tramo[]) =>
  `¿Sumo "${nombre}" a la compra conjunta a ${dinero(tramos[0]!.precioUnitario)} por ${unidad}? `
  + `Baja solo con el volumen del grupo: ${tramos.slice(1).map(t => `${dinero(t.precioUnitario)} desde ${t.desde}`).join(', ')}. `
  + 'Otros proveedores pueden ofertar por él.\n' + opciones('Sí, súmalo', 'No');
export const proponerAgregarProducto = (nombre: string, unidad: string, tramos: readonly Tramo[]) =>
  `¿Agrego "${nombre}" a tus productos a ${dinero(tramos[0]!.precioUnitario)} por ${unidad}? `
  + `Precio por cantidad sugerido: ${tramos.slice(1).map(t => `${dinero(t.precioUnitario)} desde ${t.desde}`).join(', ')}. `
  + 'Lo cambias cuando quieras en tu panel web, en Productos.\n' + opciones('Sí, agrégalo', 'No');
export const productoAgregado = (nombre: string) =>
  `Listo, "${nombre}" quedó en tus productos. Con él compites en los pedidos en grupo que lo pidan.`;
export const productoCreado = (p: ProductoCompra) =>
  `Listo, "${p.nombre}" ya está en la compra conjunta a ${dinero(p.precioActual)} por ${p.unidad}. La sala lo ve en vivo.`;
export function estadoDeOfertas(mias: readonly { producto: ProductoCompra; propia: number; ganando: boolean }[], productos: readonly ProductoCompra[]): string {
  if (mias.length === 0) {
    return `Aún no ofertas en la compra conjunta. Productos:\n${productos.map(p => `• ${p.nombre}: hoy ${dinero(p.precioActual)}`).join('\n')}\n`
      + 'Escribe por ejemplo "oferto $25.000 por rollos".';
  }
  return `Tus ofertas:\n${mias.map(x => `• ${x.producto.nombre}: ${dinero(x.propia)} por ${x.producto.unidad} · `
    + (x.ganando ? 'vas ganando ✓' : `el mejor va en ${dinero(x.producto.precioActual)}`)).join('\n')}`;
}
