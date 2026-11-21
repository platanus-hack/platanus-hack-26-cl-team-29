// Consulta de un contribuyente en el SII por su RUT: razón social, giro, dirección, comuna y actividades.
// Es lo que pone la factura de cada comprador de la compra conjunta a su nombre.
//
// Costura con el SII real: esta red NUNCA abre su propia sesión en el portal del SII. La consulta real la
// entrega el componente compartido de sesión del SII (una sola sesión por certificado, pedidos en serie,
// ~1 por segundo, sin reintentar un 720) y se pasa a `iniciarRed` como `consultarContribuyente`. Sin él, se
// usa `crearConsultaContribuyenteFalsa`, que marca sus datos como simulados.
//
// `conCacheYFila` envuelve cualquier consulta: un RUT se consulta una sola vez (también si llegan varios
// pedidos del mismo RUT a la vez) y los pedidos salen de a uno, separados por `intervaloMs`, para que una sala
// que se suma de golpe no dispare ráfagas al SII.

export interface ActividadEconomica {
  codigo: string;
  glosa: string;
}

export interface DatosContribuyente {
  razonSocial: string;
  giro: string;
  direccion: string;
  comuna: string;
  actividades: ActividadEconomica[];
  /** Datos de la consulta falsa: no se usan para facturar en el SII real. */
  simulado?: boolean;
}

/** El puerto. `rut` llega ya validado en la forma del SII ("12345678-5"). null si el SII no lo conoce. */
export type ConsultarContribuyente = (rut: string) => Promise<DatosContribuyente | null>;

/** Sin sesión del SII: datos de prueba para cualquier RUT válido, marcados como simulados. */
export function crearConsultaContribuyenteFalsa(): ConsultarContribuyente {
  return async () => ({
    razonSocial: 'Contribuyente de prueba',
    giro: 'Comercio al por menor',
    direccion: 'Sin informar',
    comuna: 'Santiago',
    actividades: [],
    simulado: true,
  });
}

export interface OpcionesFila {
  /** Pausa mínima entre el inicio de dos consultas. Por defecto 1 s. */
  intervaloMs?: number;
  reloj?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

const esperarMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Una consulta por RUT (los resultados quedan en memoria) y en fila, de a una, con `intervaloMs` entre inicios. Un error no se guarda. */
export function conCacheYFila(consultar: ConsultarContribuyente, { intervaloMs = 1000, reloj = Date.now, esperar = esperarMs }: OpcionesFila = {}): ConsultarContribuyente {
  const cache = new Map<string, Promise<DatosContribuyente | null>>();
  let cola: Promise<unknown> = Promise.resolve();
  let ultimoInicio = -Infinity;

  const enFila = (rut: string) => {
    const r = cola.then(async () => {
      const espera = ultimoInicio + intervaloMs - reloj();
      if (espera > 0) await esperar(espera);
      ultimoInicio = reloj();
      return consultar(rut);
    });
    cola = r.catch(() => {});
    return r;
  };

  return rut => {
    const enCache = cache.get(rut);
    if (enCache) return enCache;
    const r = enFila(rut);
    cache.set(rut, r);
    r.catch(() => cache.delete(rut));
    return r;
  };
}
