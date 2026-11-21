// EnvioDTE: la carátula y los DTE firmados, con el `SetDTE` firmado por quien envía.
import type { Certificado } from './certificado.ts';
import { firmarElemento } from './firma.ts';
import { normalizarRut } from '../../shared/rut.ts';
import { marcaEnChile } from '../../shared/fecha.ts';

/** El receptor de todo sobre enviado al SII es el SII mismo, también en factura. */
export const RUT_SII = '60803000-K';

export interface EntradaSobre {
  readonly rutEmisor: string;
  /** Fecha de la resolución de certificación (`AAAA-MM-DD`); en certificación `NroResol` es siempre 0. */
  readonly fchResol: string;
  /** Cada `<DTE>` firmado, con su tipo. */
  readonly documentos: readonly { readonly tipo: number; readonly xml: string }[];
  readonly certificado: Certificado;
  readonly ahora: Date;
}

/** `SubTotDTE` va con 33 y 61 primero y el resto por tipo. */
const ORDEN = [33, 61];
const rango = (tipo: number): number => (ORDEN.includes(tipo) ? ORDEN.indexOf(tipo) : ORDEN.length + tipo);

/**
 * Arma el sobre y firma el `SetDTE`. Se declara ISO-8859-1 y se sube en esos bytes, pero los digest se calculan
 * sobre UTF-8, como lo verifica el SII. Cada DTE entra con su texto original: su firma depende del `xmlns` del
 * `<DTE>`, que no se toca. `RutEnvia` es siempre el titular del certificado.
 */
export function armarSobre(e: EntradaSobre): string {
  if (e.documentos.length === 0) throw new Error('El sobre necesita al menos un DTE.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.fchResol)) throw new Error(`FchResol debe ser AAAA-MM-DD (recibido "${e.fchResol}").`);
  const cantidades = new Map<number, number>();
  for (const d of e.documentos) cantidades.set(d.tipo, (cantidades.get(d.tipo) ?? 0) + 1);
  const subTotales = [...cantidades]
    .sort(([a], [b]) => rango(a) - rango(b))
    .map(([tipo, n]) => `<SubTotDTE><TpoDTE>${tipo}</TpoDTE><NroDTE>${n}</NroDTE></SubTotDTE>`)
    .join('');

  const marca = marcaEnChile(e.ahora);
  const id = `SetDoc_${marca.replace(/\D/g, '')}`;
  const caratula =
    `<Caratula version="1.0"><RutEmisor>${normalizarRut(e.rutEmisor)}</RutEmisor>` +
    `<RutEnvia>${normalizarRut(e.certificado.rut)}</RutEnvia><RutReceptor>${RUT_SII}</RutReceptor>` +
    `<FchResol>${e.fchResol}</FchResol><NroResol>0</NroResol><TmstFirmaEnv>${marca}</TmstFirmaEnv>` +
    `${subTotales}</Caratula>`;
  const xml =
    `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<EnvioDTE xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd" version="1.0">` +
    `<SetDTE ID="${id}">${caratula}\n${e.documentos.map(d => d.xml).join('\n')}\n</SetDTE></EnvioDTE>`;
  return firmarElemento(xml, { etiqueta: 'SetDTE', id, padre: 'EnvioDTE', xsiEnSignedInfo: true }, e.certificado);
}
