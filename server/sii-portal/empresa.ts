// Ficha del contribuyente en el portal de certificación (maullin, `ce_consulta_muestra_e`), solo lectura: razón
// social, dirección y actividades, tal como el SII las tiene inscritas. Solo existe en maullin. La resolución se lee
// de la app nueva de www2c (mantenedor.ts).
import { partirRut } from '../../shared/rut.ts';
import { ErrorPortal } from './errores.ts';
import { filasDeTabla, normalizar, textoVisible } from './html.ts';
import type { SesionPortal } from './portal.ts';

const PORTAL = 'https://maullin.sii.cl/cvc_cgi/dte';

export interface Empresa {
  razonSocial: string;
  giro: string;
  acteco: number;
  direccion: string;
  comuna: string;
  ciudad?: string;
}

export interface FichaEmpresa extends Empresa {
  rut: string;
  /** Todas las actividades inscritas, por si el proveedor quiere elegir otra como giro. */
  actividades: { codigo: number; descripcion: string }[];
}


/**
 * La dirección viene en una celda ("CALLE 123, Villa/Pob. X, Ciudad Y, Comuna Z"). Las etiquetas son texto del SII, no
 * del dato: pegadas en `DirOrigen` pasan el largo del XSD y el SII rechaza el envío. Se separan desde el final.
 */
export function separarDomicilio(celda: string): { direccion: string; comuna: string; ciudad?: string } {
  let resto = celda;
  const partes: Record<string, string> = {};
  const patrones: [string, RegExp][] = [['comuna', /,?\s*Comuna\s+([^,]+)$/i], ['ciudad', /,?\s*Ciudad\s+([^,]+)$/i], ['villa', /,?\s*Villa\/Pob\.?\s+([^,]+)$/i]];
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const [campo, re] of patrones) {
      const m = re.exec(resto);
      if (m && partes[campo] === undefined) {
        partes[campo] = (m[1] ?? '').trim();
        resto = resto.slice(0, m.index);
        cambio = true;
      }
    }
  }
  const direccion = [resto.replace(/,\s*$/, '').trim(), partes.villa].filter(Boolean).join(', ');
  return { direccion, comuna: partes.comuna ?? '', ...(partes.ciudad ? { ciudad: partes.ciudad } : {}) };
}

/** Lee la página `ce_consulta_muestra_e`. Falla con el texto de la página si no trae la ficha. */
export function leerFicha(html: string): FichaEmpresa {
  const datos = new Map<string, string>();
  const actividades: FichaEmpresa['actividades'] = [];
  for (const celdas of filasDeTabla(html)) {
    if (celdas.length === 2 && celdas[0]) datos.set(normalizar(celdas[0]), celdas[1] ?? '');
    else if (celdas.length === 3 && /^\d{6}$/.test((celdas[0] ?? '').replace(/\s/g, ''))) {
      actividades.push({ codigo: Number((celdas[0] ?? '').replace(/\s/g, '')), descripcion: celdas[1] ?? '' });
    }
  }
  const rut = datos.get('DATOS DEL CONTRIBUYENTE RUT');
  const razonSocial = datos.get('NOMBRE O RAZON SOCIAL');
  const domicilio = datos.get('DIRECCION DE LA EMPRESA');
  if (!rut || !razonSocial || !domicilio) {
    throw new ErrorPortal('RESPUESTA_INESPERADA', 'El SII no entregó la ficha de la empresa.', { paso: 'ce_consulta_muestra_e', mensajeSii: textoVisible(html) });
  }
  const principal = actividades[0];
  return { rut, razonSocial, giro: principal?.descripcion ?? '', acteco: principal?.codigo ?? 0, ...separarDomicilio(domicilio), actividades };
}

/** Ficha del contribuyente para armar los DTE. */
export async function consultarFicha(sesion: SesionPortal, rutEmpresa: string): Promise<FichaEmpresa> {
  const [rut, dv] = partirRut(rutEmpresa);
  const r = await sesion.pedir({
    paso: 'ce_consulta_muestra_e',
    metodo: 'POST',
    url: `${PORTAL}/ce_consulta_muestra_e`,
    campos: [['RUT_EMP', rut], ['DV_EMP', dv], ['ACEPTAR', 'CONSULTAR']],
    referer: `${PORTAL}/ad_empresa2`,
  });
  return leerFicha(r.cuerpo);
}
