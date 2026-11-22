// Primer folio libre de un CAF, preguntándole al SII folio por folio (QueryEstDte). Un CAF de certificación
// puede traer folios que ya se usaron fuera de esta app: el registro local no basta, la fuente es el SII.
// `FAU` (no recibido) es libre; un documento recibido, anulado o modificado es usado; cualquier otra respuesta
// detiene la búsqueda con el texto del SII, para que una persona decida.

/** Respuestas de QueryEstDte que dicen que el folio ya tiene un documento en el SII. */
export const FOLIO_USADO: ReadonlySet<string> = new Set(['DOK', 'DNK', 'FAN', 'TMD', 'TMC', 'MMD', 'MMC', 'AND', 'ANC']);
export const FOLIO_LIBRE = 'FAU';

export interface RespuestaFolio {
  codigo: string;
  /** Texto del SII para el error, sin recortar. */
  detalle: string;
}

export interface Progreso {
  /** Último folio consultado. */
  folio: number;
  revisados: number;
}

export interface OpcionesBusqueda {
  desde: number;
  hasta: number;
  consultar: (folio: number) => Promise<RespuestaFolio>;
  /** Cuántos `FAU` seguidos dan el rango por libre. Por defecto 3. */
  racha?: number;
  alProgreso?: (p: Progreso) => void;
  /** Si devuelve true, la búsqueda se detiene sin resultado (el proveedor fijó el folio a mano o se desconectó). */
  cancelada?: () => boolean;
}

export class FolioIlegible extends Error {
  constructor(folio: number, r: RespuestaFolio) {
    super(`El SII respondió ${r.codigo} al consultar el folio ${folio}; no se sabe si está libre. Respuesta: ${r.detalle}`);
    this.name = 'FolioIlegible';
  }
}

/**
 * El primero de la primera racha de `racha` folios `FAU` seguidos desde `desde`. Si el rango termina en medio de
 * una racha, vale el primero de esa racha. `null` si no queda ningún folio libre o si se canceló.
 */
/** Folios libres seguidos con que se da por encontrado el primero libre de un rango. */
export const RACHA_LIBRES = 3;

export async function buscarPrimerLibre({ desde, hasta, consultar, racha = RACHA_LIBRES, alProgreso, cancelada }: OpcionesBusqueda): Promise<number | null> {
  let inicioRacha: number | null = null;
  let largo = 0;
  for (let folio = desde, revisados = 1; folio <= hasta; folio++, revisados++) {
    if (cancelada?.()) return null;
    const r = await consultar(folio);
    alProgreso?.({ folio, revisados });
    if (r.codigo === FOLIO_LIBRE) {
      inicioRacha ??= folio;
      if (++largo >= racha) return inicioRacha;
    } else if (FOLIO_USADO.has(r.codigo)) {
      inicioRacha = null;
      largo = 0;
    } else {
      throw new FolioIlegible(folio, r);
    }
  }
  return cancelada?.() ? null : inicioRacha;
}
