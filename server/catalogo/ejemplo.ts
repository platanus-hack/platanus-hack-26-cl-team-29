// Origen simulado de la demo: arma los XML que entregaría el facturador del proveedor (un EnvioDTE por mes), con
// receptores ficticios. Pasa por el mismo lector que los XML reales, así la demo prueba el camino completo.
import { escaparTexto } from '../sii/texto.ts';
import { historialDeEjemplo, type VentaDeEjemplo } from '../../shared/catalogo.ts';
import { digitoVerificador } from '../../shared/rut.ts';

/** RUT ficticio con su dígito verificador correcto. */
const rutFicticio = (cuerpo: number): string => `${cuerpo}-${digitoVerificador(String(cuerpo))}`;
const RUT_EMISOR_FICTICIO = rutFicticio(76_543_210);

function documento(v: VentaDeEjemplo, rutEmisor: string): string {
  const receptor = 77_000_000 + (v.folio % 23) * 1_117;
  const neto = v.lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  const iva = Math.round(neto * 0.19);
  const detalles = v.lineas.map((l, i) => `
      <Detalle><NroLinDet>${i + 1}</NroLinDet><CdgItem><TpoCodigo>INT1</TpoCodigo><VlrCodigo>${escaparTexto(l.codigo ?? '')}</VlrCodigo></CdgItem>`
    + `<NmbItem>${escaparTexto(l.nombre)}</NmbItem><QtyItem>${l.cantidad}</QtyItem><UnmdItem>${escaparTexto(l.unidad.toUpperCase())}</UnmdItem>`
    + `<PrcItem>${l.precioUnitario}</PrcItem><MontoItem>${l.cantidad * l.precioUnitario}</MontoItem></Detalle>`).join('');
  return `
  <DTE version="1.0"><Documento ID="F${v.folio}T33">
    <Encabezado>
      <IdDoc><TipoDTE>33</TipoDTE><Folio>${v.folio}</Folio><FchEmis>${v.fecha}</FchEmis></IdDoc>
      <Emisor><RUTEmisor>${rutEmisor}</RUTEmisor><RznSoc>Proveedor de ejemplo</RznSoc></Emisor>
      <Receptor><RUTRecep>${rutFicticio(receptor)}</RUTRecep><RznSocRecep>Comercial de ejemplo ${v.folio % 23} SpA</RznSocRecep></Receptor>
      <Totales><MntNeto>${neto}</MntNeto><TasaIVA>19</TasaIVA><IVA>${iva}</IVA><MntTotal>${neto + iva}</MntTotal></Totales>
    </Encabezado>${detalles}
  </Documento></DTE>`;
}

/** Los XML del historial de ejemplo hasta `hoy`, un EnvioDTE por mes. Con el RUT del proveedor si se conoce. */
export function xmlsDeEjemplo(hoy: Date, rutEmisor = RUT_EMISOR_FICTICIO): string[] {
  const porMes = new Map<string, VentaDeEjemplo[]>();
  for (const v of historialDeEjemplo(hoy)) porMes.set(v.fecha.slice(0, 7), [...(porMes.get(v.fecha.slice(0, 7)) ?? []), v]);
  return [...porMes.values()].map(ventas => `<?xml version="1.0" encoding="UTF-8"?>
<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0"><SetDTE ID="SetDoc">${ventas.map(v => documento(v, rutEmisor)).join('')}
</SetDTE></EnvioDTE>`);
}
