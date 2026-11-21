// El explorador: recorre las celdas de adentro hacia afuera, una por vez, y avisa cada local nuevo.
// Corre solo en el servidor. Si se reinicia, sigue desde la última celda guardada.
import type { AlmacenLocales } from './almacen.ts';
import type { Celda, Local } from './osm.ts';

export interface Avance {
  /** Celdas recorridas y total. */
  celda: number;
  total: number;
  /** Distancia al MUT de la última celda recorrida. */
  distanciaKm: number;
  /** `reparto` mientras se reparte por toda la zona; `acumulando` al sumar muestra de adentro hacia afuera. */
  fase: Celda['fase'];
  /** La celda que se está buscando ahora, para dibujarla en el mapa. Null al terminar. */
  buscando: Celda | null;
  terminado: boolean;
}

export interface Hallazgo {
  nuevos: Local[];
  avance: Avance;
}

export interface OpcionesExplorador {
  almacen: AlmacenLocales;
  celdas: Celda[];
  buscar: (c: Celda) => Promise<Local[]>;
  /** Pausa entre celdas, para no cargar Overpass (servicio público y gratuito). */
  esperaMs: number;
  alAvanzar: (h: Hallazgo) => void;
  registrar?: (mensaje: string) => void;
}

export interface Explorador {
  iniciar(): Promise<void>;
  detener(): void;
  avance(): Avance;
}

/** Tras un error de Overpass (cargado, sin red) se espera más antes de reintentar la misma celda. */
const MULTIPLICADOR_ERROR = 4;

export function crearExplorador(o: OpcionesExplorador): Explorador {
  let activo = false;
  let siguiente = 0;
  let despertar: (() => void) | undefined;

  const avance = (): Avance => {
    const hecha = o.celdas[siguiente - 1];
    const terminado = siguiente >= o.celdas.length;
    const actual = o.celdas[Math.min(siguiente, o.celdas.length - 1)];
    return {
      celda: siguiente, total: o.celdas.length, distanciaKm: hecha ? Number(hecha.distanciaKm.toFixed(1)) : 0,
      fase: actual?.fase ?? 'acumulando', buscando: terminado ? null : o.celdas[siguiente], terminado,
    };
  };

  const dormir = (ms: number) => new Promise<void>(r => {
    const t = setTimeout(r, ms);
    despertar = () => { clearTimeout(t); r(); };
  });

  return {
    async iniciar() {
      if (activo) return;
      activo = true;
      siguiente = await o.almacen.siguienteCelda();
      while (activo && siguiente < o.celdas.length) {
        let espera = o.esperaMs;
        try {
          const encontrados = await o.buscar(o.celdas[siguiente]);
          const nuevos = await o.almacen.guardar(encontrados);
          siguiente += 1;
          await o.almacen.marcarCelda(siguiente);
          o.alAvanzar({ nuevos, avance: avance() });
        } catch (error) {
          espera *= MULTIPLICADOR_ERROR;
          o.registrar?.(`[locales] celda ${siguiente}: ${error instanceof Error ? error.message : error}; reintento en ${espera / 1000} s`);
        }
        if (activo && siguiente < o.celdas.length) await dormir(espera);
      }
      if (activo) o.registrar?.(`[locales] recorrido terminado: ${o.celdas.length} celdas`);
      activo = false;
    },
    detener() {
      activo = false;
      despertar?.();
    },
    avance,
  };
}
