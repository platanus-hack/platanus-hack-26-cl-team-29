// Arma, timbra y firma un DTE (33 factura, 52 guía de despacho, 61 nota de crédito) en el orden del XSD DTE_v10.
import { validarCaf, type Caf } from './caf.ts';
import type { Certificado } from './certificado.ts';
import { firmarElemento } from './firma.ts';
import { timbrar } from './timbre.ts';
import type {
  DocumentoEmitido,
  DocumentoImpreso,
  Emisor,
  EntradaFactura,
  EntradaGuia,
  EntradaNotaCredito,
  Item,
  OrdenCompra,
  Receptor,
  ResultadoEmision,
  ResultadoLote,
} from './tipos.ts';
import { normalizarRut } from '../../shared/rut.ts';
import { fechaEnChile, marcaEnChile } from '../../shared/fecha.ts';
import { escaparTexto, limpiarLatin1 } from './texto.ts';

const TASA_IVA = 19;

/** Una `Referencia` del documento, ya en términos del XSD. */
export interface ReferenciaDte {
  readonly tipoDocumento: number | string;
  readonly folio: string;
  readonly fecha: string;
  readonly codigo?: 1 | 2 | 3;
  readonly razon?: string;
}

export interface EntradaDte {
  readonly tipo: 33 | 52 | 61;
  readonly folio: number;
  readonly fechaEmision: string;
  readonly emisor: Emisor;
  readonly receptor: Receptor;
  readonly items: readonly Item[];
  readonly referencias: readonly ReferenciaDte[];
  /** Solo guía (52). */
  readonly indTraslado?: number;
}

export interface DteFirmado {
  readonly documento: Omit<DocumentoEmitido, 'impreso'>;
  /** `<TED>` exacto del documento, para el PDF417 de la representación impresa. */
  readonly ted: string;
  /** `<DTE>` firmado, sin declaración XML. */
  readonly xml: string;
}

const el = (nombre: string, contenido: string | number): string => `<${nombre}>${contenido}</${nombre}>`;

/** Texto del usuario: limpio a Latin-1, obligatorio y dentro del largo del XSD. Nunca se recorta en silencio. */
function texto(campo: string, valor: string | undefined, largo: number): string {
  const limpio = limpiarLatin1(valor ?? '');
  if (!limpio) throw new Error(`${campo} es obligatorio.`);
  if (limpio.length > largo) throw new Error(`${campo} admite hasta ${largo} caracteres (tiene ${limpio.length}).`);
  return escaparTexto(limpio);
}

const opcional = (nombre: string, campo: string, valor: string | undefined, largo: number): string =>
  valor ? el(nombre, texto(campo, valor, largo)) : '';

/** Número decimal sin notación exponencial y con hasta 6 decimales. */
const numero = (n: number): string => String(Number(n.toFixed(6)));

const fecha = (campo: string, valor: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new Error(`${campo} debe ser AAAA-MM-DD (recibido "${valor}").`);
  return valor;
};

export interface Totales {
  readonly lineas: readonly number[];
  readonly neto: number;
  readonly iva: number;
  readonly total: number;
}

/** `MontoItem` = round(cantidad x precio), `MntNeto` = suma de líneas, `IVA` = round(neto x 19 %), total = neto + IVA. */
export function calcularTotales(items: readonly Item[]): Totales {
  if (items.length === 0) throw new Error('El documento necesita al menos un ítem.');
  const lineas = items.map((item, i) => {
    if (!(item.cantidad > 0) || !(item.precioUnitario > 0)) {
      throw new Error(`Ítem ${i + 1}: cantidad y precio deben ser mayores que cero.`);
    }
    return Math.round(item.cantidad * item.precioUnitario);
  });
  const neto = lineas.reduce((a, b) => a + b, 0);
  const iva = Math.round((neto * TASA_IVA) / 100);
  return { lineas, neto, iva, total: neto + iva };
}

function encabezado(e: EntradaDte, totales: Totales): string {
  const { emisor, receptor } = e;
  const idDoc =
    el('TipoDTE', e.tipo) + el('Folio', e.folio) + el('FchEmis', fecha('fechaEmision', e.fechaEmision)) +
    (e.tipo === 52 ? el('IndTraslado', e.indTraslado ?? 1) : '');
  const xmlEmisor =
    el('RUTEmisor', normalizarRut(emisor.rut)) + el('RznSoc', texto('emisor.razonSocial', emisor.razonSocial, 100)) +
    el('GiroEmis', texto('emisor.giro', emisor.giro, 80)) + el('Acteco', emisor.acteco) +
    el('DirOrigen', texto('emisor.direccion', emisor.direccion, 70)) +
    el('CmnaOrigen', texto('emisor.comuna', emisor.comuna, 20)) +
    opcional('CiudadOrigen', 'emisor.ciudad', emisor.ciudad, 20);
  const xmlReceptor =
    el('RUTRecep', normalizarRut(receptor.rut)) +
    el('RznSocRecep', texto('receptor.razonSocial', receptor.razonSocial, 100)) +
    el('GiroRecep', texto('receptor.giro', receptor.giro, 40)) +
    el('DirRecep', texto('receptor.direccion', receptor.direccion, 70)) +
    el('CmnaRecep', texto('receptor.comuna', receptor.comuna, 20)) +
    opcional('CiudadRecep', 'receptor.ciudad', receptor.ciudad, 20);
  const xmlTotales =
    el('MntNeto', totales.neto) + el('TasaIVA', TASA_IVA) + el('IVA', totales.iva) + el('MntTotal', totales.total);
  return el('Encabezado', el('IdDoc', idDoc) + el('Emisor', xmlEmisor) + el('Receptor', xmlReceptor) + el('Totales', xmlTotales));
}

const detalle = (item: Item, i: number, monto: number): string =>
  el(
    'Detalle',
    el('NroLinDet', i + 1) + el('NmbItem', texto(`items[${i}].nombre`, item.nombre, 80)) +
      el('QtyItem', numero(item.cantidad)) + opcional('UnmdItem', `items[${i}].unidad`, item.unidad, 4) +
      el('PrcItem', numero(item.precioUnitario)) + el('MontoItem', monto),
  );

const referencia = (r: ReferenciaDte, i: number): string =>
  el(
    'Referencia',
    el('NroLinRef', i + 1) + el('TpoDocRef', r.tipoDocumento) + el('FolioRef', texto('referencia.folio', r.folio, 18)) +
      el('FchRef', fecha('referencia.fecha', r.fecha)) + (r.codigo ? el('CodRef', r.codigo) : '') +
      opcional('RazonRef', 'referencia.razon', r.razon, 90),
  );

/**
 * Cada hijo directo de `Documento` (encabezado, cada `Detalle`, cada `Referencia`, el TED) va en su propia línea:
 * el SII rechaza líneas de más de unos 4090 caracteres. El texto se limpia a Latin-1 antes de firmar.
 */
export function armarDte(e: EntradaDte, caf: Caf, certificado: Certificado, ahora: Date): DteFirmado {
  validarCaf(caf, e.tipo, e.emisor.rut, e.folio, fechaEnChile(ahora));
  const totales = calcularTotales(e.items);
  const id = `DTE_T${e.tipo}F${e.folio}`;
  const marca = marcaEnChile(ahora);
  const ted = timbrar(
    {
      tipo: e.tipo,
      folio: e.folio,
      fechaEmision: e.fechaEmision,
      rutEmisor: e.emisor.rut,
      rutReceptor: e.receptor.rut,
      razonSocialReceptor: limpiarLatin1(e.receptor.razonSocial),
      montoTotal: totales.total,
      primerItem: limpiarLatin1(e.items[0]?.nombre ?? ''),
      marca,
    },
    caf,
  );
  const lineas = [
    `<DTE xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1.0">` +
      `<Documento ID="${id}">${encabezado(e, totales)}`,
    ...e.items.map((item, i) => detalle(item, i, totales.lineas[i] ?? 0)),
    ...e.referencias.map(referencia),
    ted,
    `${el('TmstFirma', marca)}</Documento></DTE>`,
  ];
  const xml = firmarElemento(
    lineas.join('\n'),
    { etiqueta: 'Documento', id, padre: 'DTE', xsiEnSignedInfo: false },
    certificado,
  );
  return {
    xml,
    ted,
    documento: {
      tipo: e.tipo,
      folio: e.folio,
      fechaEmision: e.fechaEmision,
      rutEmisor: normalizarRut(e.emisor.rut),
      rutReceptor: normalizarRut(e.receptor.rut),
      montoNeto: totales.neto,
      iva: totales.iva,
      montoTotal: totales.total,
    },
  };
}

export interface OpcionesImpreso {
  readonly ted: string;
  readonly resolucion: DocumentoImpreso['resolucion'];
  readonly simulado: boolean;
  readonly oficinaSii?: string;
}

/** Datos de la representación impresa de un DTE ya armado (o simulado), con los mismos totales del XML. */
export function datosImpresos(e: EntradaDte, opciones: OpcionesImpreso): DocumentoImpreso {
  const totales = calcularTotales(e.items);
  return {
    tipo: e.tipo,
    folio: e.folio,
    fechaEmision: e.fechaEmision,
    emisor: e.emisor,
    receptor: e.receptor,
    lineas: e.items.map((item, i) => ({
      nombre: limpiarLatin1(item.nombre),
      cantidad: item.cantidad,
      ...(item.unidad ? { unidad: item.unidad } : {}),
      precioUnitario: item.precioUnitario,
      monto: totales.lineas[i] ?? 0,
    })),
    referencias: e.referencias.map(r => ({
      tipoDocumento: r.tipoDocumento, folio: r.folio, fecha: r.fecha,
      ...(r.codigo ? { codigo: r.codigo } : {}), ...(r.razon ? { razon: r.razon } : {}),
    })),
    neto: totales.neto,
    tasaIva: TASA_IVA,
    iva: totales.iva,
    total: totales.total,
    ...(e.tipo === 52 ? { indTraslado: e.indTraslado ?? 1 } : {}),
    ted: opciones.ted,
    resolucion: opciones.resolucion,
    ...(opciones.oficinaSii ? { oficinaSii: opciones.oficinaSii } : {}),
    simulado: opciones.simulado,
  };
}

/** Referencias y datos del DTE que salen de cada tipo de entrada. Lo comparten la implementación real y la falsa. */
export const aDte = {
  factura: (e: EntradaFactura): Omit<EntradaDte, 'emisor'> => ({
    ...base(33, e),
    referencias: [
      ...(e.ordenCompra ? [ordenCompra(e.ordenCompra)] : []),
      ...(e.guias ?? []).map(g => ({ tipoDocumento: 52, folio: String(g.folio), fecha: g.fecha })),
    ],
  }),
  guia: (e: EntradaGuia): Omit<EntradaDte, 'emisor'> => ({
    ...base(52, e),
    indTraslado: e.motivoTraslado,
    referencias: e.ordenCompra ? [ordenCompra(e.ordenCompra)] : [],
  }),
  notaCredito: (e: EntradaNotaCredito): Omit<EntradaDte, 'emisor'> => ({
    ...base(61, e),
    referencias: [
      {
        tipoDocumento: 33,
        folio: String(e.factura.folio),
        fecha: e.factura.fecha,
        codigo: 3,
        razon: e.razon ?? 'Falta parcial de mercaderia',
      },
    ],
  }),
};

const base = (tipo: 33 | 52 | 61, e: EntradaFactura | EntradaGuia | EntradaNotaCredito) => ({
  tipo,
  folio: e.folio,
  fechaEmision: e.fechaEmision ?? fechaEnChile(new Date()),
  receptor: e.receptor,
  items: e.items,
});

/**
 * Las cuatro formas de emitir sobre un emisor de lotes (real o falso). Un documento suelto va solo en su sobre:
 * así un rechazo o un corte afecta a un solo folio.
 */
export function emisiones(emitirLote: (entradas: readonly Omit<EntradaDte, 'emisor'>[]) => Promise<ResultadoLote>) {
  async function emitir(entrada: Omit<EntradaDte, 'emisor'>): Promise<ResultadoEmision> {
    const { documentos, envio, sobreXml } = await emitirLote([entrada]);
    return { documento: documentos[0]!, envio, sobreXml };
  }
  return {
    emitirFactura: (e: EntradaFactura) => emitir(aDte.factura(e)),
    emitirFacturas: (entradas: readonly EntradaFactura[]) => emitirLote(entradas.map(aDte.factura)),
    emitirGuia: (e: EntradaGuia) => emitir(aDte.guia(e)),
    emitirNotaCredito: (e: EntradaNotaCredito) => emitir(aDte.notaCredito(e)),
  };
}

const ordenCompra = (oc: OrdenCompra): ReferenciaDte => ({
  tipoDocumento: 801,
  folio: oc.folio,
  fecha: oc.fecha,
});
