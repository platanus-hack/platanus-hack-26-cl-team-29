// El SII que usa la red, elegido en cada emisión: la conexión hecha desde la app si está completa; si no, el SII
// configurado por variables de entorno; si tampoco hay, el falso. Así conectar el SII desde el panel no requiere
// reiniciar el servidor.
import type { CambioEstadoSii, PuertoSii, SiiReal } from '../red/index.ts';
import type { ConexionSii } from './conexion.ts';

export interface OpcionesConmutable {
  falso: PuertoSii;
  /** SII real por variables de entorno (SII_PFX_BASE64), si existe. */
  respaldo?: PuertoSii;
  conexion: ConexionSii;
  /** Arma el SII real con las variables de la conexión. */
  crearReal: (env: NodeJS.ProcessEnv) => SiiReal;
  env?: NodeJS.ProcessEnv;
}

export function crearSiiConmutable({ falso, respaldo, conexion, crearReal, env = process.env }: OpcionesConmutable): PuertoSii {
  const oyentes = new Set<(cambio: CambioEstadoSii) => void>();
  const avisar = (cambio: CambioEstadoSii) => { for (const o of oyentes) o(cambio); };
  respaldo?.alCambiarEstado?.(avisar);
  let real: { version: number; sii: SiiReal } | null = null;

  async function actual(): Promise<PuertoSii> {
    const version = conexion.version();
    if (real?.version === version) return real.sii;
    const variables = await conexion.entorno(env);
    if (!variables) return respaldo ?? falso;
    // Una instancia por versión de la conexión: los folios viven en el almacén compartido, no en la instancia.
    const sii = crearReal(variables);
    sii.alCambiarEstado?.(avisar);
    real = { version, sii };
    return sii;
  }

  return {
    alCambiarEstado: oyente => { oyentes.add(oyente); },
    emitirFactura: async d => (await actual()).emitirFactura(d),
    emitirFacturas: async d => (await actual()).emitirFacturas(d),
    emitirGuia: async d => (await actual()).emitirGuia(d),
    emitirNotaCredito: async d => (await actual()).emitirNotaCredito(d),
    registrarReclamo: async d => (await actual()).registrarReclamo(d),
  };
}
