// TED (Timbre Electrónico del DTE): el `DD` con los datos clave del documento, firmado con la llave del CAF.
import { sign } from 'node:crypto';
import type { Caf } from './caf.ts';
import { escaparTexto, normalizarRut, plegarTed } from './texto.ts';

export interface DatosTimbre {
  readonly tipo: number;
  readonly folio: number;
  readonly fechaEmision: string;
  readonly rutEmisor: string;
  readonly rutReceptor: string;
  readonly razonSocialReceptor: string;
  readonly montoTotal: number;
  readonly primerItem: string;
  /** `TSTED`, hora de Chile `AAAA-MM-DDTHH:MM:SS`. */
  readonly marca: string;
}

/**
 * `RE` y `RR` van sin ceros de relleno (el SII compara `RE` con el del CAF). `RSR` e `IT1` van plegados a ASCII y
 * recortados a 40. `FRMT` firma los bytes exactos del `DD` en Latin-1: reescribir una entidad después lo rompe.
 */
export function timbrar(datos: DatosTimbre, caf: Caf): string {
  const dd = armarDd(datos, caf.xml, true);
  const frmt = sign('sha1', Buffer.from(dd, 'latin1'), caf.llave).toString('base64');
  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${frmt}</FRMT></TED>`;
}

/**
 * TED con la misma forma que el real pero sin CAF ni firma: lo usa la implementación falsa para que la
 * representación impresa tenga un timbre que mostrar. Dice SIMULADO donde iría la firma y no vale ante el SII.
 */
export function timbrarSimulado(datos: DatosTimbre): string {
  const caf =
    `<CAF version="1.0"><DA><RE>${normalizarRut(datos.rutEmisor)}</RE><RS>SIMULADO</RS><TD>${datos.tipo}</TD>` +
    `<RNG><D>${datos.folio}</D><H>${datos.folio}</H></RNG><FA>${datos.fechaEmision}</FA><IDK>0</IDK></DA>` +
    `<FRMA algoritmo="SHA1withRSA">SIMULADO</FRMA></CAF>`;
  return `<TED version="1.0">${armarDd(datos, caf, false)}<FRMT algoritmo="SHA1withRSA">SIMULADO</FRMT></TED>`;
}

function armarDd(datos: DatosTimbre, cafXml: string, estricto: boolean): string {
  const rsr = escaparTexto(plegarTed(datos.razonSocialReceptor)) || (estricto ? '' : 'RECEPTOR');
  const it1 = escaparTexto(plegarTed(datos.primerItem)) || (estricto ? '' : 'ITEM');
  if (!rsr || !it1) throw new Error('La razón social del receptor y el primer ítem necesitan caracteres ASCII para el TED.');
  return (
    `<DD><RE>${normalizarRut(datos.rutEmisor)}</RE><TD>${datos.tipo}</TD><F>${datos.folio}</F>` +
    `<FE>${datos.fechaEmision}</FE><RR>${normalizarRut(datos.rutReceptor)}</RR><RSR>${rsr}</RSR>` +
    `<MNT>${datos.montoTotal}</MNT><IT1>${it1}</IT1>${cafXml}<TSTED>${datos.marca}</TSTED></DD>`
  );
}
