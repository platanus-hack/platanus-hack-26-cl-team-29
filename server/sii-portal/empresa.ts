// Lecturas de la empresa en el portal de certificación (maullin), solo lectura:
// - Ficha del contribuyente (`ce_consulta_muestra_e`): razón social, dirección y actividades, tal como el SII las
//   tiene inscritas. Solo existe en maullin.
// - Resolución (`ad_empresa1` y `ad_empresa2`): fecha y número de la resolución que va en la carátula del sobre.
//   Es POR AMBIENTE: maullin entrega la de certificación (número 0 y la fecha de la postulación); mezclarla con otra
//   da `RCT` (CRT-3-19 "Fecha/Numero Resolucion Invalido"). Nunca se usa un valor por defecto.
// Ninguna de estas lecturas llega a `ad_empresa3` ni a `ad_empresa4` (grabar la ficha).
import { ErrorPortal } from './errores.ts';
import { filasDeTabla, leerFormularios, normalizar, textoVisible, formularioHacia } from './html.ts';
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

export interface Resolucion {
  /** `AAAA-MM-DD`. */
  fecha: string;
  numero: number;
  fechaAutorizacion: string | null;
  razonSocial: string | null;
}

export function partirRut(rut: string): [string, string] {
  const [cuerpo = '', dv = ''] = rut.replace(/\./g, '').toUpperCase().split('-');
  return [cuerpo, dv];
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

/** `dd-mm-aaaa` (o `dd/mm/aaaa`) a `aaaa-mm-dd`; null si no es una fecha. */
function fechaIso(texto: string | undefined): string | null {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec((texto ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Lee la resolución de `ad_empresa2` (filas "etiqueta, valor"). Falla con el texto de la página si no la trae. */
export function leerResolucion(html: string): Resolucion {
  const datos = new Map<string, string>();
  for (const celdas of filasDeTabla(html)) {
    if (celdas.length >= 2 && celdas[0]) {
      const etiqueta = normalizar(celdas[0]).replace(/\s*\(\*\)$/, '').replace(/:$/, '');
      if (!datos.has(etiqueta)) datos.set(etiqueta, celdas[1] ?? '');
    }
  }
  const fecha = fechaIso(datos.get('FECHA RESOLUCION'));
  const numero = (datos.get('RESOLUCION') ?? datos.get('NUMERO RESOLUCION') ?? '').replace(/\D/g, '');
  if (!fecha || numero === '') {
    throw new ErrorPortal('RESPUESTA_INESPERADA', 'El SII no entregó la fecha y el número de resolución de la empresa.', { paso: 'ad_empresa2', mensajeSii: textoVisible(html) });
  }
  return {
    fecha,
    numero: Number(numero),
    fechaAutorizacion: fechaIso(datos.get('FECHA AUTORIZACION')),
    razonSocial: datos.get('RAZON SOCIAL') ?? null,
  };
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

/** Resolución de certificación: GET del formulario `ad_empresa1` y POST a su `action` (`ad_empresa2`). */
export async function consultarResolucion(sesion: SesionPortal, rutEmpresa: string): Promise<Resolucion> {
  const [rut, dv] = partirRut(rutEmpresa);
  const url1 = `${PORTAL}/ad_empresa1`;
  const pagina = await sesion.pedir({ paso: 'ad_empresa1', metodo: 'GET', url: url1 });
  const formulario = formularioHacia(leerFormularios(pagina.cuerpo), 'ad_empresa2');
  if (pagina.estado !== 200 || !formulario) {
    throw new ErrorPortal('RESPUESTA_INESPERADA', `El SII no mostró el formulario de datos de la empresa (HTTP ${pagina.estado}).`, { paso: 'ad_empresa1', mensajeSii: textoVisible(pagina.cuerpo) });
  }
  const campos = new Map(formulario.campos);
  campos.set('RUT_EMP', rut);
  campos.set('DV_EMP', dv);
  if (!campos.has('ACEPTAR')) campos.set('ACEPTAR', 'Ingresar');
  const r = await sesion.pedir({
    paso: 'ad_empresa2',
    metodo: 'POST',
    url: new URL(formulario.accion ?? 'ad_empresa2', url1).toString(),
    campos: [...campos],
    referer: url1,
  });
  return leerResolucion(r.cuerpo);
}
