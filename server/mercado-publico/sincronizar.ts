// Una pasada de la API con ticket: trae los días completos que faltan desde el último procesado, filtra alimentos e insumos y guarda.
// Si se corta a mitad, los días ya marcados quedan; la siguiente pasada sigue desde ahí.
import type { AlmacenMercadoPublico } from './almacen.ts';
import type { FuenteOrdenes } from './api.ts';
import { esDeAlimentos, normalizarOrden, type OrdenMP } from './normalizar.ts';

/** Marca del último día completo traído de la API (`AAAA-MM-DD`). */
const MARCA = 'api-ultimo-dia';

export interface OpcionesPasada {
  fuente: FuenteOrdenes;
  almacen: AlmacenMercadoPublico;
  /** Hoy en Chile, `AAAA-MM-DD`. Hoy no se procesa: todavía entran órdenes. */
  hoy: string;
  /** La primera vez, cuántos días hacia atrás se traen. */
  diasIniciales: number;
  /** Tope de órdenes (detalles) por día, para no gastar el cupo diario del ticket. */
  maxPorDia: number;
  /** Cada día que trae órdenes nuevas, apenas quedan guardadas (para avisar en vivo). */
  alGuardar?: (nuevas: OrdenMP[]) => void;
}

export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Días completos que faltan: desde el siguiente al último procesado hasta ayer. */
export function diasPendientes(ultimo: string | null, hoy: string, diasIniciales: number): string[] {
  const dias: string[] = [];
  for (let d = ultimo ? sumarDias(ultimo, 1) : sumarDias(hoy, -diasIniciales); d < hoy; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

async function ordenesDelDia(o: OpcionesPasada, dia: string): Promise<OrdenMP[]> {
  const resumenes = (await o.fuente.ordenesDelDia(dia)).filter(r => esDeAlimentos(r.Nombre)).slice(0, o.maxPorDia);
  const ordenes: OrdenMP[] = [];
  for (const r of resumenes) {
    const detalle = await o.fuente.orden(r.Codigo);
    const orden = detalle && normalizarOrden(detalle, dia);
    if (orden) ordenes.push(orden);
  }
  return ordenes;
}

/** Devuelve las órdenes nuevas que guardó. */
export async function pasada(o: OpcionesPasada): Promise<OrdenMP[]> {
  const nuevas: OrdenMP[] = [];
  for (const dia of diasPendientes(await o.almacen.marca(MARCA), o.hoy, o.diasIniciales)) {
    const delDia = await o.almacen.guardar(await ordenesDelDia(o, dia));
    await o.almacen.fijarMarca(MARCA, dia);
    if (delDia.length) o.alGuardar?.(delDia);
    nuevas.push(...delDia);
  }
  return nuevas;
}
