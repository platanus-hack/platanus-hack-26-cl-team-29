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
  const rsr = escaparTexto(plegarTed(datos.razonSocialReceptor));
  const it1 = escaparTexto(plegarTed(datos.primerItem));
  if (!rsr || !it1) throw new Error('La razón social del receptor y el primer ítem necesitan caracteres ASCII para el TED.');
  const dd =
    `<DD><RE>${normalizarRut(datos.rutEmisor)}</RE><TD>${datos.tipo}</TD><F>${datos.folio}</F>` +
    `<FE>${datos.fechaEmision}</FE><RR>${normalizarRut(datos.rutReceptor)}</RR><RSR>${rsr}</RSR>` +
    `<MNT>${datos.montoTotal}</MNT><IT1>${it1}</IT1>${caf.xml}<TSTED>${datos.marca}</TSTED></DD>`;
  const frmt = sign('sha1', Buffer.from(dd, 'latin1'), caf.llave).toString('base64');
  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${frmt}</FRMT></TED>`;
}
