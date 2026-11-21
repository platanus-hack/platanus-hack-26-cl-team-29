// Cliente de la API oficial de Mercado Público (ChileCompra): https://api.mercadopublico.cl
// Forma de la respuesta: "Diccionario de Datos - Órdenes de Compra" de ChileCompra (ver docs/hallazgos/20261121-1545-api-mercado-publico.md).
// Una sola petición a la vez, con pausa entre llamadas y reintentos con espera creciente: el ticket tiene 10.000 al día.

/** Una orden de compra tal como la entrega la API (solo los campos que usamos). */
export interface OrdenApi {
  Codigo: string;
  Nombre: string;
  CodigoEstado: number;
  TipoMoneda?: string;
  Fechas?: { FechaCreacion?: string; FechaEnvio?: string | null; FechaAceptacion?: string | null };
  Comprador?: { NombreOrganismo?: string; ComunaUnidad?: string; RegionUnidad?: string };
  Proveedor?: { Codigo?: string; Nombre?: string; RutSucursal?: string; Comuna?: string; Region?: string };
  Items?: { Cantidad: number; Listado: ItemApi[] };
}

export interface ItemApi {
  Correlativo: number;
  CodigoProducto?: number;
  Categoria?: string;
  EspecificacionComprador?: string;
  EspecificacionProveedor?: string;
  Cantidad: number;
  /** No está en el diccionario de datos, pero viene en el detalle ("Kilogramo", "Unidad"). */
  Unidad?: string;
  Moneda?: string;
  PrecioNeto: number;
}

/** Lo que entrega el listado por fecha: un resumen por orden, sin ítems. */
export type ResumenApi = Pick<OrdenApi, 'Codigo' | 'Nombre' | 'CodigoEstado'>;

/** Lo que la pasada pide a la API (en los tests, una fuente en memoria con la misma forma). */
export interface FuenteOrdenes {
  /** Órdenes de un día (`AAAA-MM-DD`), solo el resumen. */
  ordenesDelDia(dia: string): Promise<ResumenApi[]>;
  /** Detalle de una orden, con proveedor e ítems. Null si no existe. */
  orden(codigo: string): Promise<OrdenApi | null>;
}

const BASE = 'https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json';
/** Error de la API por peticiones simultáneas: se reintenta. Cualquier otro código (ticket inválido) corta. */
const PETICIONES_SIMULTANEAS = 10500;
const REINTENTOS = 4;

/** `AAAA-MM-DD` → `ddmmaaaa`, el formato de fecha de la API. */
export const fechaApi = (dia: string): string => dia.split('-').reverse().join('');

class ErrorApi extends Error {
  reintentar: boolean;
  constructor(mensaje: string, reintentar: boolean) {
    super(mensaje);
    this.reintentar = reintentar;
  }
}

export function crearFuenteApi(ticket: string, o: { esperaMs: number; fetch?: typeof fetch }): FuenteOrdenes {
  const pedirHttp = o.fetch ?? fetch;
  let cola: Promise<unknown> = Promise.resolve();
  const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

  async function intentar(params: Record<string, string>): Promise<OrdenApi[]> {
    const url = `${BASE}?${new URLSearchParams({ ...params, ticket })}`;
    const res = await pedirHttp(url);
    if (res.status === 429 || res.status >= 500) throw new ErrorApi(`HTTP ${res.status}`, true);
    const cuerpo = await res.json() as { Listado?: OrdenApi[]; Codigo?: number; Mensaje?: string };
    if (Array.isArray(cuerpo.Listado)) return cuerpo.Listado;
    throw new ErrorApi(`Mercado Público respondió ${cuerpo.Codigo ?? res.status}: ${cuerpo.Mensaje ?? 'sin listado'}`, cuerpo.Codigo === PETICIONES_SIMULTANEAS);
  }

  /** Una petición por vez (la API rechaza las simultáneas), con pausa después de cada una. */
  function pedir(params: Record<string, string>): Promise<OrdenApi[]> {
    const turno = cola.then(async () => {
      for (let intento = 0; ; intento++) {
        try {
          return await intentar(params);
        } catch (error) {
          const reintentar = !(error instanceof ErrorApi) || error.reintentar; // un error de red también se reintenta
          if (!reintentar || intento >= REINTENTOS) throw error;
          await dormir(o.esperaMs * 2 ** (intento + 1));
        } finally {
          await dormir(o.esperaMs);
        }
      }
    });
    cola = turno.catch(() => undefined);
    return turno;
  }

  return {
    ordenesDelDia: dia => pedir({ fecha: fechaApi(dia) }),
    orden: async codigo => (await pedir({ codigo }))[0] ?? null,
  };
}
