// Lo que "Conectar mi SII" necesita del portal web del SII, sobre el componente de sesión única (server/sii-portal).
// Cada operación toma la sesión del certificado (sin login si ya hay una guardada) y la suelta al terminar.
import {
  consultarFicha, consultarResolucion, consultarTope, INTERVALO_FOLIOS_MS, listarReobtenibles, pedirCaf, reobtenerCaf,
  type CertificadoPortal, type FichaEmpresa, type PortalSii, type RangoFolios, type Resolucion, type TopeFolios,
} from '../sii-portal/index.ts';

export interface PortalConexion {
  ficha(certificado: CertificadoPortal, rutEmpresa: string): Promise<FichaEmpresa>;
  resolucion(certificado: CertificadoPortal, rutEmpresa: string): Promise<Resolucion>;
  /** Rangos ya autorizados que se pueden volver a descargar, los más recientes primero. Solo lectura. */
  reobtenibles(certificado: CertificadoPortal, rutEmpresa: string, tipo: number): Promise<RangoFolios[]>;
  /** XML del CAF de un rango ya autorizado (no gasta cupo). */
  reobtener(certificado: CertificadoPortal, rutEmpresa: string, rango: RangoFolios): Promise<string>;
  tope(certificado: CertificadoPortal, rutEmpresa: string, tipo: number): Promise<TopeFolios>;
  /** XML del CAF de folios nuevos (consume cupo del SII). */
  pedir(certificado: CertificadoPortal, rutEmpresa: string, tipo: number, cantidad: number): Promise<string>;
}

export function crearPortalConexion(portal: PortalSii): PortalConexion {
  const folios = { ritmoMs: INTERVALO_FOLIOS_MS };
  return {
    ficha: (c, rut) => portal.conSesion(c, 'ficha', s => consultarFicha(s, rut)),
    resolucion: (c, rut) => portal.conSesion(c, 'resolucion', s => consultarResolucion(s, rut)),
    reobtenibles: (c, rut, tipo) => portal.conSesion(c, `reobtenibles_${tipo}`, s => listarReobtenibles(s, rut, tipo), folios),
    reobtener: (c, rut, rango) => portal.conSesion(c, `reobtener_${rango.tipo}`, s => reobtenerCaf(s, rut, rango), { ...folios, escritura: true }),
    tope: (c, rut, tipo) => portal.conSesion(c, `tope_${tipo}`, s => consultarTope(s, rut, tipo), folios),
    pedir: (c, rut, tipo, cantidad) => portal.conSesion(c, `pedir_${tipo}`, s => pedirCaf(s, rut, tipo, cantidad), { ...folios, escritura: true }),
  };
}
