// De dónde salen los XML de las facturas de un proveedor. Conseguirlos es tarea del equipo:
// - `ejemplo`: el historial simulado de la demo (sin variables de entorno, como el resto de las implementaciones falsas).
// - `archivos`: los XML que nos entregó su facturador (obligado a entregarlos) o que llegaron a su casilla de
//   intercambio, cargados por la ruta de operación. Leer la casilla directamente queda para después.
import type { OrigenCatalogo } from '../../shared/catalogo.ts';
import { xmlsDeEjemplo } from './ejemplo.ts';

export interface OrigenXml {
  origen: OrigenCatalogo;
  xmls(): Promise<readonly (Buffer | string)[]>;
}

export const origenEjemplo = (rutEmisor?: string, hoy: () => Date = () => new Date()): OrigenXml =>
  ({ origen: 'ejemplo', xmls: async () => xmlsDeEjemplo(hoy(), rutEmisor) });

export const origenArchivos = (archivos: readonly (Buffer | string)[]): OrigenXml => ({ origen: 'archivos', xmls: async () => archivos });
