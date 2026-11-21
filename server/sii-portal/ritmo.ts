// Cuánto se le pide al SII a la vez. El costo de una operación del portal se mide en llamadas y sesiones del SII, no
// en CPU propia: todo pasa por un solo limitador global (no por comercio) con tope de flujos simultáneos y una
// separación mínima entre el inicio de dos flujos (el SII recomienda como máximo 1 solicitud por segundo). Dentro de
// un flujo de folios, cada paso se separa además ~1 s (`conRitmo`).

export interface Reloj {
  ahora(): number;
  esperar(ms: number): Promise<void>;
}

export const relojReal: Reloj = {
  ahora: () => Date.now(),
  esperar: ms => new Promise(r => setTimeout(r, ms)),
};

export interface Limitador {
  turno<T>(trabajo: () => Promise<T>): Promise<T>;
}

export function crearLimitador({ maxSimultaneos = 2, separacionMs = 1000, reloj = relojReal }: { maxSimultaneos?: number; separacionMs?: number; reloj?: Reloj } = {}): Limitador {
  let activos = 0;
  let ultimoInicio = Number.NEGATIVE_INFINITY;
  const espera: (() => void)[] = [];
  const entrar = async () => {
    if (activos >= maxSimultaneos) await new Promise<void>(r => espera.push(r));
    activos++;
    // Se reserva el instante antes de esperar: dos flujos que entran juntos quedan separados igual.
    const inicio = Math.max(reloj.ahora(), ultimoInicio + separacionMs);
    ultimoInicio = inicio;
    const falta = inicio - reloj.ahora();
    if (falta > 0) await reloj.esperar(falta);
  };
  const salir = () => {
    activos--;
    espera.shift()?.();
  };
  return {
    async turno(trabajo) {
      await entrar();
      try {
        return await trabajo();
      } finally {
        salir();
      }
    },
  };
}

/** Separación mínima entre pasos del flujo de timbraje y reobtención (1001 ms, como la referencia). */
export const INTERVALO_FOLIOS_MS = 1001;
