// Representación impresa de un DTE (33, 52, 61) en PDF, en memoria, según las convenciones del SII: recuadro
// rojo con RUT, tipo y folio arriba a la derecha, unidad del SII bajo el recuadro, receptor, referencias,
// detalle, totales y el timbre electrónico (PDF417 del TED exacto, nivel de seguridad 5, bytes Latin-1).
// El logo del SII no forma parte de la representación impresa.
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import type { DocumentoImpreso, LineaImpresa, ReferenciaImpresa } from './tipos.ts';

const ROJO = '#C8102E';
const TEXTO = '#1A1A1A';
const TENUE = '#6B6B6B';
const BORDE = '#C9C9C9';
const FONDO = '#F2F2F2';
const MARGEN = 40;
const NORMAL = 'Helvetica';
const NEGRITA = 'Helvetica-Bold';

const TITULOS: Record<number, string> = {
  33: 'FACTURA ELECTRÓNICA',
  52: 'GUÍA DE DESPACHO ELECTRÓNICA',
  61: 'NOTA DE CRÉDITO ELECTRÓNICA',
};

const REFERIDOS: Record<string, string> = {
  801: 'Orden de compra',
  33: 'Factura electrónica',
  52: 'Guía de despacho electrónica',
  61: 'Nota de crédito electrónica',
};

const CODIGOS_REFERENCIA: Record<number, string> = { 1: 'anula documento', 2: 'corrige texto', 3: 'corrige montos' };

const TRASLADOS: Record<number, string> = {
  1: 'Operación constituye venta',
  2: 'Venta por efectuar',
  3: 'Consignación',
  4: 'Entrega gratuita',
  5: 'Traslado interno',
  6: 'Otros traslados no venta',
  7: 'Guía de devolución',
  8: 'Traslado para exportación',
  9: 'Venta para exportación',
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "FACTURA ELECTRÓNICA", "GUÍA DE DESPACHO ELECTRÓNICA" o "NOTA DE CRÉDITO ELECTRÓNICA". */
export const nombreDelTipo = (tipo: number): string => TITULOS[tipo] ?? `DOCUMENTO TRIBUTARIO ELECTRÓNICO ${tipo}`;

const enteros = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const decimales = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 6 });
const pesos = (n: number): string => `$ ${enteros.format(n)}`;

/** `76123456-7` → `76.123.456-7`. */
function rutConPuntos(rut: string): string {
  const m = /^(\d+)-([\dkK])$/.exec(rut.replace(/\./g, ''));
  if (!m) return rut;
  return `${m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${m[2]!.toUpperCase()}`;
}

function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
}

function textoReferencia(r: ReferenciaImpresa): string {
  const nombre = REFERIDOS[String(r.tipoDocumento)] ?? `Documento tipo ${r.tipoDocumento}`;
  const motivo = [r.codigo ? CODIGOS_REFERENCIA[r.codigo] : undefined, r.razon].filter(Boolean).join(': ');
  return `${nombre} N° ${r.folio} del ${fechaLarga(r.fecha)}${motivo ? ` (${motivo})` : ''}`;
}

/**
 * Opciones de bwip-js para el timbre: PDF417 con nivel de seguridad 5 (norma del SII) sobre los bytes Latin-1
 * del TED. bwip-js toma cada carácter como un byte, así que el texto no puede tener nada fuera de Latin-1.
 */
export function opcionesTimbre(ted: string) {
  if (/[^\x00-\xFF]/.test(ted)) throw new Error('El TED tiene caracteres fuera de Latin-1: no se puede codificar en el PDF417.');
  return {
    bcid: 'pdf417',
    text: Buffer.from(ted, 'latin1').toString('latin1'),
    binarytext: true,
    eclevel: 5,
    columns: 18,
    rowmult: 3,
    scale: 3,
    paddingwidth: 0,
    paddingheight: 0,
  };
}

/** Dibuja la representación impresa y devuelve el PDF completo. */
export async function generarPdf(d: DocumentoImpreso): Promise<Buffer> {
  const timbre = await bwipjs.toBuffer(opcionesTimbre(d.ted));
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: MARGEN,
    info: {
      Title: `${nombreDelTipo(d.tipo)} N° ${d.folio}`,
      Subject: `Tipo ${d.tipo} folio ${d.folio}`,
      Author: d.emisor.razonSocial,
    },
  });
  const partes: Buffer[] = [];
  doc.on('data', (parte: Buffer) => partes.push(parte));
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  const ancho = doc.page.width - 2 * MARGEN;
  let y = encabezado(doc, d, ancho);
  y = receptor(doc, d, ancho, y + 14);
  if (d.referencias.length > 0) y = referencias(doc, d.referencias, ancho, y + 12);
  y = detalle(doc, d.lineas, ancho, y + 14);
  pie(doc, d, ancho, y + 16, timbre);

  doc.end();
  return listo;
}

type Doc = PDFKit.PDFDocument;

/** Emisor a la izquierda, recuadro rojo a la derecha. Devuelve la `y` donde termina. */
function encabezado(doc: Doc, d: DocumentoImpreso, ancho: number): number {
  const anchoRecuadro = 220;
  const xRecuadro = MARGEN + ancho - anchoRecuadro;
  const interior = anchoRecuadro - 20;

  // Recuadro: se mide el texto primero para saber su alto.
  const lineas: [string, number][] = [
    [`R.U.T.: ${rutConPuntos(d.emisor.rut)}`, 12],
    [nombreDelTipo(d.tipo), 12],
    [`N° ${d.folio}`, 12],
  ];
  doc.font(NEGRITA);
  const alto = lineas.reduce((s, [t, tam]) => s + doc.fontSize(tam).heightOfString(t, { width: interior, align: 'center' }) + 6, 18);
  doc.save().lineWidth(2.5).strokeColor(ROJO).rect(xRecuadro, MARGEN, anchoRecuadro, alto).stroke().restore();
  let yr = MARGEN + 12;
  doc.fillColor(ROJO);
  for (const [t, tam] of lineas) {
    doc.fontSize(tam).text(t, xRecuadro + 10, yr, { width: interior, align: 'center' });
    yr = doc.y + 6;
  }
  const oficina = `S.I.I. - ${(d.oficinaSii ?? 'SANTIAGO').toUpperCase()}`;
  doc.fontSize(10).text(oficina, xRecuadro, MARGEN + alto + 6, { width: anchoRecuadro, align: 'center' });
  const finRecuadro = doc.y;

  // Emisor.
  const anchoEmisor = xRecuadro - MARGEN - 20;
  doc.fillColor(TEXTO).font(NEGRITA).fontSize(14).text(d.emisor.razonSocial, MARGEN, MARGEN, { width: anchoEmisor });
  doc.moveDown(0.3).font(NORMAL).fontSize(9.5);
  for (const t of [d.emisor.giro, d.emisor.direccion, [d.emisor.comuna, d.emisor.ciudad].filter(Boolean).join(', ')]) {
    if (t) doc.text(t, { width: anchoEmisor });
  }
  doc.moveDown(0.6).font(NEGRITA).text('Fecha de emisión: ', { continued: true }).font(NORMAL).text(fechaLarga(d.fechaEmision));
  return Math.max(doc.y, finRecuadro);
}

function receptor(doc: Doc, d: DocumentoImpreso, ancho: number, y: number): number {
  const r = d.receptor;
  const filas: [string, string][] = [
    ['Señor(es)', r.razonSocial],
    ['R.U.T.', rutConPuntos(r.rut)],
    ['Giro', r.giro],
    ['Dirección', r.direccion],
    ['Comuna', [r.comuna, r.ciudad].filter(Boolean).join(', ')],
  ];
  if (d.tipo === 52) filas.push(['Traslado', TRASLADOS[d.indTraslado ?? 1] ?? String(d.indTraslado)]);
  const etiqueta = 70;
  const valor = ancho - 24 - etiqueta;
  doc.fontSize(9.5);
  const altos = filas.map(([, v]) => doc.font(NORMAL).heightOfString(v || '-', { width: valor }) + 3);
  const alto = altos.reduce((a, b) => a + b, 0) + 16;
  doc.save().lineWidth(0.8).strokeColor(BORDE).roundedRect(MARGEN, y, ancho, alto, 4).stroke().restore();
  let yf = y + 8;
  filas.forEach(([e, v], i) => {
    doc.fillColor(TENUE).font(NEGRITA).text(e, MARGEN + 12, yf, { width: etiqueta });
    doc.fillColor(TEXTO).font(NORMAL).text(v || '-', MARGEN + 12 + etiqueta, yf, { width: valor });
    yf += altos[i]!;
  });
  return y + alto;
}

function referencias(doc: Doc, lista: readonly ReferenciaImpresa[], ancho: number, y: number): number {
  doc.fillColor(TEXTO).font(NEGRITA).fontSize(9.5).text('Referencias', MARGEN, y, { width: ancho });
  doc.font(NORMAL).fontSize(9);
  for (const r of lista) doc.text(textoReferencia(r), MARGEN, doc.y + 2, { width: ancho });
  return doc.y;
}

/** Tabla de detalle; si no cabe, sigue en otra página con el encabezado de la tabla repetido. */
function detalle(doc: Doc, lineas: readonly LineaImpresa[], ancho: number, y: number): number {
  const columnas = { cantidad: 70, precio: 95, total: 95 };
  const anchoDescripcion = ancho - columnas.cantidad - columnas.precio - columnas.total;
  const x = {
    descripcion: MARGEN,
    cantidad: MARGEN + anchoDescripcion,
    precio: MARGEN + anchoDescripcion + columnas.cantidad,
    total: MARGEN + anchoDescripcion + columnas.cantidad + columnas.precio,
  };
  const relleno = 6;
  const limite = () => doc.page.height - MARGEN - 20;

  const cabecera = (yc: number): number => {
    doc.save().fillColor(FONDO).rect(MARGEN, yc, ancho, 20).fill().restore();
    doc.fillColor(TEXTO).font(NEGRITA).fontSize(9);
    doc.text('Descripción', x.descripcion + relleno, yc + 6, { width: anchoDescripcion - 2 * relleno });
    doc.text('Cantidad', x.cantidad, yc + 6, { width: columnas.cantidad - relleno, align: 'right' });
    doc.text('Precio unitario', x.precio, yc + 6, { width: columnas.precio - relleno, align: 'right' });
    doc.text('Total', x.total, yc + 6, { width: columnas.total - relleno, align: 'right' });
    return yc + 20;
  };

  let yf = cabecera(y);
  doc.font(NORMAL).fontSize(9);
  for (const l of lineas) {
    const cantidad = `${decimales.format(l.cantidad)}${l.unidad ? ` ${l.unidad}` : ''}`;
    const alto = doc.font(NORMAL).heightOfString(l.nombre, { width: anchoDescripcion - 2 * relleno }) + 2 * relleno;
    if (yf + alto > limite()) {
      doc.addPage();
      yf = cabecera(MARGEN);
      doc.font(NORMAL).fontSize(9);
    }
    doc.fillColor(TEXTO);
    doc.text(l.nombre, x.descripcion + relleno, yf + relleno, { width: anchoDescripcion - 2 * relleno });
    doc.text(cantidad, x.cantidad, yf + relleno, { width: columnas.cantidad - relleno, align: 'right' });
    doc.text(pesos(l.precioUnitario), x.precio, yf + relleno, { width: columnas.precio - relleno, align: 'right' });
    doc.text(pesos(l.monto), x.total, yf + relleno, { width: columnas.total - relleno, align: 'right' });
    yf += alto;
    doc.save().lineWidth(0.5).strokeColor(BORDE).moveTo(MARGEN, yf).lineTo(MARGEN + ancho, yf).stroke().restore();
  }
  return yf;
}

/** Timbre a la izquierda y totales a la derecha, más la leyenda de certificación. */
function pie(doc: Doc, d: DocumentoImpreso, ancho: number, y: number, timbre: Buffer): void {
  const anchoTimbre = 230;
  const altoPie = 175;
  if (y + altoPie > doc.page.height - MARGEN) {
    doc.addPage();
    y = MARGEN;
  }

  // Totales.
  const anchoTotales = 220;
  const xTotales = MARGEN + ancho - anchoTotales;
  const filas: [string, string, boolean][] = [
    ['Monto neto', pesos(d.neto), false],
    [`IVA ${d.tasaIva}%`, pesos(d.iva), false],
    ['Total', pesos(d.total), true],
  ];
  let yt = y;
  for (const [etiqueta, valor, fuerte] of filas) {
    if (fuerte) doc.save().fillColor(FONDO).rect(xTotales, yt, anchoTotales, 22).fill().restore();
    doc.fillColor(TEXTO).font(fuerte ? NEGRITA : NORMAL).fontSize(fuerte ? 11 : 9.5);
    doc.text(etiqueta, xTotales + 8, yt + 6, { width: 100 });
    doc.text(valor, xTotales + 100, yt + 6, { width: anchoTotales - 108, align: 'right' });
    yt += 22;
  }

  // Timbre electrónico.
  // El alto sale de la cabecera del PNG (ancho en el byte 16, alto en el 20).
  const altoTimbre = (anchoTimbre * timbre.readUInt32BE(20)) / timbre.readUInt32BE(16);
  doc.image(timbre, MARGEN, y, { width: anchoTimbre });
  let yl = y + altoTimbre + 6;
  const leyenda = (texto: string, fuente: string, tam: number, color = TEXTO) => {
    doc.fillColor(color).font(fuente).fontSize(tam).text(texto, MARGEN, yl, { width: anchoTimbre, align: 'center' });
    yl = doc.y + 1;
  };
  leyenda('Timbre Electrónico SII', NEGRITA, 8.5);
  leyenda(`Res. ${d.resolucion.numero} de ${d.resolucion.fecha.slice(0, 4)}`, NORMAL, 8);
  leyenda('Verifique documento: www.sii.cl', NORMAL, 8);
  if (d.simulado) leyenda('Timbre simulado (modo demo): no es válido ante el SII', NEGRITA, 8, ROJO);

  const aviso = 'Documento emitido en ambiente de certificación del SII';
  doc.fillColor(TENUE).font(NORMAL).fontSize(7.5).text(aviso, MARGEN, Math.max(yl, yt) + 14, { width: ancho, align: 'center' });
}
