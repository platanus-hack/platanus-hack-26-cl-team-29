// Lee las facturas de venta de un XML del SII (un DTE suelto o un EnvioDTE con varios) y devuelve solo sus líneas de
// detalle: producto, unidad, cantidad, precio y fecha. El receptor (RUT, razón social, dirección) no se lee.
import type { Element } from '@xmldom/xmldom';
import { parsearXml } from '../sii/c14n.ts';
import { validarRut } from '../../shared/rut.ts';
import type { LineaVendida } from '../../shared/catalogo.ts';

/** Factura afecta (33) y exenta (34): las ventas. Guías (52) y notas (56, 61) se omiten para no contar dos veces. */
const VENTAS = [33, 34];

export interface FacturaLeida {
  tipo: number;
  folio: number;
  rutEmisor: string;
  fecha: string;
  lineas: LineaVendida[];
}

export interface Lectura {
  facturas: FacturaLeida[];
  /** Documentos que no son facturas de venta (guías, notas de crédito o débito). */
  omitidos: number;
}

/** El XML del SII suele venir en ISO-8859-1: se decodifica según su declaración. */
export function decodificarXml(bytes: Buffer | string): string {
  if (typeof bytes === 'string') return bytes;
  const cabecera = bytes.subarray(0, 200).toString('latin1');
  return /encoding=["']ISO-8859-1["']/i.test(cabecera) ? bytes.toString('latin1') : bytes.toString('utf8');
}

/** Abreviaturas de unidad que usan los facturadores, en la palabra con que se vende en la red. */
const UNIDADES: Readonly<Record<string, string>> = { un: 'unidad', und: 'unidad', unid: 'unidad', u: 'unidad', cj: 'caja', caj: 'caja', pq: 'paquete', paq: 'paquete', rl: 'rollo' };
const unidadDe = (texto: string): string => {
  const u = texto.toLowerCase().replace(/\.$/, '');
  return UNIDADES[u] ?? (u || 'unidad');
};

const hijo = (padre: Element | null | undefined, nombre: string): Element | null =>
  (padre?.getElementsByTagName(nombre).item(0) as Element | null) ?? null;
const texto = (padre: Element | null | undefined, nombre: string): string => (hijo(padre, nombre)?.textContent ?? '').trim();
const numero = (padre: Element | null | undefined, nombre: string): number => Number(texto(padre, nombre).replace(',', '.'));

function lineaDe(d: Element, fecha: string): LineaVendida | null {
  const nombre = texto(d, 'NmbItem').replace(/\s+/g, ' ');
  const cantidad = numero(d, 'QtyItem') || 1;
  const monto = numero(d, 'MontoItem');
  const precio = monto > 0 ? monto / cantidad : numero(d, 'PrcItem');
  if (!nombre || !(cantidad > 0) || !(precio > 0)) return null;
  const codigo = texto(hijo(d, 'CdgItem'), 'VlrCodigo');
  return {
    ...(codigo ? { codigo } : {}), nombre, unidad: unidadDe(texto(d, 'UnmdItem')),
    cantidad, precioUnitario: Math.round(precio), fecha,
  };
}

/** Las facturas de venta de un XML. Un XML mal formado lanza. */
export function leerFacturas(bytes: Buffer | string): Lectura {
  const raiz = parsearXml(decodificarXml(bytes));
  const docs = raiz.getElementsByTagName('Documento');
  const lectura: Lectura = { facturas: [], omitidos: 0 };
  for (let i = 0; i < docs.length; i++) {
    const doc = docs.item(i)!;
    const id = hijo(doc, 'IdDoc');
    const tipo = numero(id, 'TipoDTE');
    if (!VENTAS.includes(tipo)) {
      lectura.omitidos++;
      continue;
    }
    const fecha = texto(id, 'FchEmis');
    const detalles = doc.getElementsByTagName('Detalle');
    const lineas: LineaVendida[] = [];
    for (let j = 0; j < detalles.length; j++) {
      const l = lineaDe(detalles.item(j)!, fecha);
      if (l) lineas.push(l);
    }
    const rutEmisor = validarRut(texto(hijo(doc, 'Emisor'), 'RUTEmisor')) ?? '';
    lectura.facturas.push({ tipo, folio: numero(id, 'Folio'), rutEmisor, fecha, lineas });
  }
  return lectura;
}
