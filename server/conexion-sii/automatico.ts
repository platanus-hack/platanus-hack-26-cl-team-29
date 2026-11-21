// Cómo se consigue un CAF sin que el proveedor lo descargue a mano. Orden de remedios del SII:
//   1. Reobtener un rango ya autorizado (no gasta cupo). El listado mezcla rangos con folios ya usados: antes de
//      reobtener se le pregunta al SII (QueryEstDte) por el último folio del rango; si ya está usado, el rango no sirve.
//      Los rangos vencidos (33 y 61 vencen a los 6 meses) se saltan.
//   2. Solo si no hay ninguno, pedir folios nuevos, pocos y dentro del tope que publica el SII (`MAX_AUTOR`):
//      pedir de más agrava el racionamiento.
// Nunca se anulan folios (irreversible, pesa seis meses contra el cupo). Si el timbraje está bloqueado, se muestra el
// mensaje del SII tal cual y no se insiste.
import { primerDiaVencido } from '../sii/index.ts';
import type { CertificadoPortal, RangoFolios } from '../sii-portal/index.ts';
import type { PortalConexion } from './portal.ts';
import { FOLIO_LIBRE, FOLIO_USADO } from './primer-libre.ts';

/** Folios nuevos que se piden cuando no hay nada que reobtener: pocos, para no acumular folios sin usar. */
export const FOLIOS_A_PEDIR = 5;
/** Rangos reobtenibles que se revisan como máximo (los más recientes). */
const RANGOS_A_REVISAR = 5;

export interface CafConseguido {
  xml: string;
  origen: 'reobtenido' | 'pedido';
  desde: number;
  hasta: number;
}

export interface OpcionesConseguir {
  portal: PortalConexion;
  certificado: CertificadoPortal;
  rutEmpresa: string;
  tipo: number;
  /** Estado de un folio en el SII (QueryEstDte): `FAU` libre, `DOK`/`DNK`/anulado usado. */
  consultarFolio: (folio: number) => Promise<string>;
  /** `AAAA-MM-DD` en Chile. */
  hoy: string;
  avisar: (texto: string) => void;
}

const vigente = (r: RangoFolios, hoy: string) => {
  const vence = primerDiaVencido({ tipo: r.tipo, fechaAutorizacion: r.fecha });
  return vence === null || hoy < vence;
};

export async function conseguirCaf(o: OpcionesConseguir): Promise<CafConseguido> {
  const rangos = (await o.portal.reobtenibles(o.certificado, o.rutEmpresa, o.tipo)).filter(r => vigente(r, o.hoy));
  for (const rango of rangos.slice(0, RANGOS_A_REVISAR)) {
    const codigo = await o.consultarFolio(rango.hasta);
    if (FOLIO_USADO.has(codigo)) {
      o.avisar(`rango ${rango.desde}-${rango.hasta} del ${rango.fecha}: el folio ${rango.hasta} ya está en el SII (${codigo}), no sirve`);
      continue;
    }
    if (codigo !== FOLIO_LIBRE) {
      o.avisar(`rango ${rango.desde}-${rango.hasta}: el SII respondió ${codigo} por el folio ${rango.hasta}; se salta`);
      continue;
    }
    o.avisar(`reobteniendo el rango ${rango.desde}-${rango.hasta} del ${rango.fecha}`);
    try {
      const xml = await o.portal.reobtener(o.certificado, o.rutEmpresa, rango);
      return { xml, origen: 'reobtenido', desde: rango.desde, hasta: rango.hasta };
    } catch (error) {
      // Un rango anulado se avisa en esta página; se prueba el siguiente.
      o.avisar(`no se pudo reobtener ${rango.desde}-${rango.hasta}: ${(error as Error).message}`);
    }
  }
  const tope = await o.portal.tope(o.certificado, o.rutEmpresa, o.tipo);
  const cantidad = Math.min(FOLIOS_A_PEDIR, tope.maximo ?? FOLIOS_A_PEDIR);
  if (cantidad < 1) throw new Error(`El SII no autoriza folios nuevos del tipo ${o.tipo} por ahora (máximo autorizado ${tope.maximo}).`);
  o.avisar(`sin rangos para reobtener: se piden ${cantidad} folios nuevos (máximo autorizado ${tope.maximo ?? 'sin tope publicado'}, disponibles ${tope.disponibles ?? 'sin dato'})`);
  const xml = await o.portal.pedir(o.certificado, o.rutEmpresa, o.tipo, cantidad);
  return { xml, origen: 'pedido', desde: 0, hasta: 0 };
}
