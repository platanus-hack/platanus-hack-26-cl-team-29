// El SII que usa la red, elegido en cada emisión: el real con la conexión hecha desde el panel si está completa; si
// no, el falso. Es la única fuente de configuración del SII (no hay variables SII_* en el servidor), así que conectar
// el SII desde el panel no requiere reiniciar nada.
// Folios: antes de facturar un lote se asegura que alcancen (reponiendo primero, sin enviar nada si no alcanzan) y
// después de cada emisión se repone en segundo plano si quedaron bajo el mínimo.
import type { CambioEstadoSii, PuertoSii, SiiReal } from '../red/index.ts';
import { receptoresDe } from '../red/index.ts';
import type { TipoDocumento } from '../../shared/documentos.ts';
import type { ConexionSii, ConfiguracionEmision } from './conexion.ts';

export interface OpcionesConmutable {
  falso: PuertoSii;
  conexion: ConexionSii;
  /** Arma el SII real con la configuración de la conexión. */
  crearReal: (configuracion: ConfiguracionEmision) => SiiReal;
}

/** Estado RCT de QueryEstUp ("Rechazado por Error en Carátula"). */
export const esRechazoDeCaratula = (detalle: string | undefined): boolean => /<(?:[\w-]+:)?ESTADO>\s*RCT\s*<\//i.test(detalle ?? '');

export function crearSiiConmutable({ falso, conexion, crearReal }: OpcionesConmutable): PuertoSii {
  const oyentes = new Set<(cambio: CambioEstadoSii) => void>();
  const avisar = (cambio: CambioEstadoSii) => { for (const o of oyentes) o(cambio); };
  let real: { version: number; sii: SiiReal } | null = null;

  /** El SII real de la conexión completa (una instancia por versión de la conexión) o null. */
  async function actual(): Promise<SiiReal | null> {
    const version = conexion.version();
    if (real?.version === version) return real.sii;
    const configuracion = await conexion.configuracion();
    if (!configuracion) return null;
    // Los folios viven en el almacén compartido, no en la instancia.
    const sii = crearReal(configuracion);
    sii.alCambiarEstado?.(cambio => {
      // RCT: la carátula (resolución) está mal. Se marca para no seguir enviando con ella; el folio queda libre en el SII.
      if (cambio.estadoSii === 'rechazado' && esRechazoDeCaratula(cambio.detalle)) void conexion.marcarRechazoCaratula();
      avisar(cambio);
    });
    real = { version, sii };
    return sii;
  }

  /** Emite y, con el SII real, repone en segundo plano los folios del tipo si quedaron bajo el mínimo. */
  async function emitir<T>(tipo: TipoDocumento, fn: (sii: PuertoSii) => Promise<T>): Promise<T> {
    const sii = await actual();
    if (!sii) return fn(falso);
    try {
      return await fn(sii);
    } finally {
      conexion.folios.enFondo(tipo);
    }
  }

  return {
    alCambiarEstado: oyente => { oyentes.add(oyente); },
    emitirFactura: d => emitir(33, sii => sii.emitirFactura(d)),
    // Antes del lote, en este orden y sin tocar el SII si algo falla: cada comprador con RUT verificado, y folios
    // para todos (se reponen primero; si aun así no alcanzan, falla con el texto del SII).
    emitirFacturas: async d => {
      if (await actual()) {
        receptoresDe(d);
        await conexion.folios.asegurar(33, d.length);
      }
      return emitir(33, sii => sii.emitirFacturas(d));
    },
    emitirGuia: d => emitir(52, sii => sii.emitirGuia(d)),
    emitirNotaCredito: d => emitir(61, sii => sii.emitirNotaCredito(d)),
    registrarReclamo: async d => ((await actual()) ?? falso).registrarReclamo(d),
  };
}
