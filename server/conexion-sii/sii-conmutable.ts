// El SII que usa la red, elegido en cada emisión según quién emite: el real con la conexión de ese proveedor (la que
// hizo con su certificado por WhatsApp, o la del panel) si está completa; si no, el falso. Es la única fuente de
// configuración del SII (no hay variables SII_* en el servidor), así que conectar el SII no requiere reiniciar nada.
// Folios: antes de facturar un lote se asegura que alcancen (reponiendo primero, sin enviar nada si no alcanzan) y
// después de cada emisión se repone en segundo plano si quedaron bajo el mínimo.
import type { CambioEstadoSii, DatosEmision, Negocio, PuertoSii, SiiReal } from '../red/index.ts';
import { receptoresDe } from '../red/index.ts';
import type { TipoDocumento } from '../../shared/documentos.ts';
import type { ConexionSii, ConfiguracionEmision } from './conexion.ts';

export interface OpcionesConmutable {
  falso: PuertoSii;
  /** La conexión con que emite ese proveedor (la suya por RUT o la del panel); null si no tiene. */
  conexionDe: (emisor: Negocio | undefined) => Promise<ConexionSii | null>;
  /** Arma el SII real de una conexión con su configuración (y sus folios). */
  crearReal: (configuracion: ConfiguracionEmision, conexion: ConexionSii) => SiiReal;
}

/** Estado RCT de QueryEstUp ("Rechazado por Error en Carátula"). */
export const esRechazoDeCaratula = (detalle: string | undefined): boolean => /<(?:[\w-]+:)?ESTADO>\s*RCT\s*<\//i.test(detalle ?? '');

export function crearSiiConmutable({ falso, conexionDe, crearReal }: OpcionesConmutable): PuertoSii {
  const oyentes = new Set<(cambio: CambioEstadoSii) => void>();
  const avisar = (cambio: CambioEstadoSii) => { for (const o of oyentes) o(cambio); };
  /** El SII real de cada conexión, una instancia por versión de la conexión. */
  const reales = new Map<ConexionSii, { version: number; sii: SiiReal }>();

  /** La conexión del emisor y su SII real si está completa; sin ella, null (se usa el falso). */
  async function actual(emisor: Negocio | undefined): Promise<{ conexion: ConexionSii; sii: SiiReal } | null> {
    const conexion = await conexionDe(emisor);
    if (!conexion) return null;
    const version = conexion.version();
    const real = reales.get(conexion);
    if (real?.version === version) return { conexion, sii: real.sii };
    const configuracion = await conexion.configuracion();
    if (!configuracion) return null;
    // Los folios viven en el almacén del emisor, no en la instancia.
    const sii = crearReal(configuracion, conexion);
    sii.alCambiarEstado?.(cambio => {
      // RCT: la carátula (resolución) está mal. Se marca para no seguir enviando con ella; el folio queda libre en el SII.
      if (cambio.estadoSii === 'rechazado' && esRechazoDeCaratula(cambio.detalle)) void conexion.marcarRechazoCaratula();
      avisar(cambio);
    });
    reales.set(conexion, { version, sii });
    return { conexion, sii };
  }

  /** Emite y, con el SII real, repone en segundo plano los folios del tipo si quedaron bajo el mínimo. */
  async function emitir<T>(tipo: TipoDocumento, emisor: Negocio | undefined, fn: (sii: PuertoSii) => Promise<T>): Promise<T> {
    const real = await actual(emisor);
    if (!real) return fn(falso);
    try {
      return await fn(real.sii);
    } finally {
      real.conexion.folios.enFondo(tipo);
    }
  }

  /** Un sobre es de un solo emisor: cada proveedor factura con su RUT y sus folios. */
  function emisorDelSobre(d: readonly DatosEmision[]): Negocio | undefined {
    const emisor = d[0]?.emisor;
    if (d.some(x => x.emisor.id !== emisor?.id)) throw new Error('[sii] un sobre de facturas lleva un solo emisor');
    return emisor;
  }

  return {
    alCambiarEstado: oyente => { oyentes.add(oyente); },
    // Con SII real completo (certificado, resolución y folios) factura de verdad; sin él solo tendría el falso.
    puedeFacturar: async emisor => (await actual(emisor)) !== null,
    emitirFactura: d => emitir(33, d.emisor, sii => sii.emitirFactura(d)),
    // Antes del lote, en este orden y sin tocar el SII si algo falla: cada comprador con RUT verificado, y folios
    // para todos (se reponen primero; si aun así no alcanzan, falla con el texto del SII).
    emitirFacturas: async d => {
      const emisor = emisorDelSobre(d);
      const real = await actual(emisor);
      if (real) {
        receptoresDe(d);
        await real.conexion.folios.asegurar(33, d.length);
      }
      return emitir(33, emisor, sii => sii.emitirFacturas(d));
    },
    emitirGuia: d => emitir(52, d.emisor, sii => sii.emitirGuia(d)),
    emitirNotaCredito: d => emitir(61, d.emisor, sii => sii.emitirNotaCredito(d)),
    registrarReclamo: async d => ((await actual(d.emisor))?.sii ?? falso).registrarReclamo(d),
  };
}
