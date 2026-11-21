// Tarjeta inscrita, como en Uber: Webpay Oneclick Mall de Transbank. El comprador inscribe su tarjeta una vez en el
// formulario de Transbank (Bando nunca ve el número) y Bando guarda solo el `tbk_user` para cobrar al vencer.
// PAGOS_TRANSBANK=integracion usa el ambiente de prueba de Transbank con sus credenciales públicas (tarjetas de prueba);
// =produccion exige TRANSBANK_COMERCIO, TRANSBANK_COMERCIO_TIENDA y TRANSBANK_API_KEY. Sin variable, la pasarela falsa.
import { randomUUID } from 'node:crypto';

export interface TarjetaInscrita {
  tbkUser: string;
  marca: string;
  /** Los últimos 4 dígitos, como los entrega Transbank. */
  ultimos4: string;
}

export interface PasarelaTarjetas {
  ambiente: 'falsa' | 'integracion' | 'produccion';
  /** Abre la inscripción: el navegador hace POST de `TBK_TOKEN=token` a `url`. */
  iniciarInscripcion(o: { usuario: string; email: string; volverA: string }): Promise<{ token: string; url: string }>;
  /** Cierra la inscripción con el token que vuelve de Transbank; null si la persona la rechazó o la abandonó. */
  terminarInscripcion(token: string): Promise<TarjetaInscrita | null>;
  /** Cobra sin la persona presente. Devuelve el código de autorización o lanza si el banco lo rechaza. */
  cobrar(o: { usuario: string; tbkUser: string; ordenCompra: string; monto: number }): Promise<string>;
}

// Credenciales públicas del ambiente de integración (documentación de Transbank): no son secretas ni cobran.
const INTEGRACION = {
  base: 'https://webpay3gint.transbank.cl',
  comercio: '597055555541',
  tienda: '597055555542',
  llave: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
};
const RUTA = '/rswebpaytransaction/api/oneclick/v1.2';

export function crearOneclick(c: typeof INTEGRACION, ambiente: 'integracion' | 'produccion', pedir: typeof fetch = fetch): PasarelaTarjetas {
  async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const res = await pedir(`${c.base}${RUTA}${ruta}`, {
      method: metodo,
      headers: { 'Tbk-Api-Key-Id': c.comercio, 'Tbk-Api-Key-Secret': c.llave, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20_000),
    });
    const datos = await res.json().catch(() => ({})) as T & { error_message?: string };
    if (!res.ok) throw new Error(`Transbank ${metodo} ${ruta}: HTTP ${res.status} ${datos.error_message ?? ''}`);
    return datos;
  }
  return {
    ambiente,
    async iniciarInscripcion({ usuario, email, volverA }) {
      const r = await llamar<{ token: string; url_webpay: string }>('POST', '/inscriptions', { username: usuario, email, response_url: volverA });
      return { token: r.token, url: r.url_webpay };
    },
    async terminarInscripcion(token) {
      const r = await llamar<{ response_code: number; tbk_user?: string; card_type?: string; card_number?: string }>('PUT', `/inscriptions/${token}`);
      if (r.response_code !== 0 || !r.tbk_user) return null;
      return { tbkUser: r.tbk_user, marca: r.card_type ?? 'Tarjeta', ultimos4: (r.card_number ?? '').slice(-4) };
    },
    async cobrar({ usuario, tbkUser, ordenCompra, monto }) {
      const r = await llamar<{ details?: { status?: string; response_code?: number; authorization_code?: string }[] }>('POST', '/transactions', {
        username: usuario, tbk_user: tbkUser, buy_order: ordenCompra,
        details: [{ commerce_code: c.tienda, buy_order: `${ordenCompra}-1`, amount: monto, installments_number: 1 }],
      });
      const d = r.details?.[0];
      if (d?.status !== 'AUTHORIZED' || d.response_code !== 0) throw new Error(`Cobro rechazado (${d?.status ?? 'sin respuesta'})`);
      return d.authorization_code ?? '';
    },
  };
}

/** Sin Transbank: inscribe al instante una tarjeta de prueba y todo cobro se autoriza. La inscripción pasa por una página propia. */
export function crearPasarelaFalsa(): PasarelaTarjetas {
  const pendientes = new Map<string, string>();
  return {
    ambiente: 'falsa',
    async iniciarInscripcion({ volverA }) {
      const token = randomUUID();
      pendientes.set(token, volverA);
      return { token, url: '/api/pagos/tarjeta/falsa' };
    },
    async terminarInscripcion(token) {
      return pendientes.delete(token) ? { tbkUser: `falso-${token}`, marca: 'Visa', ultimos4: '6623' } : null;
    },
    async cobrar() {
      return `F${Date.now().toString().slice(-6)}`;
    },
  };
}

export function pasarelaDesdeEnv(env: NodeJS.ProcessEnv): PasarelaTarjetas {
  if (env.PAGOS_TRANSBANK === 'integracion') return crearOneclick(INTEGRACION, 'integracion');
  if (env.PAGOS_TRANSBANK === 'produccion') {
    const { TRANSBANK_COMERCIO: comercio, TRANSBANK_COMERCIO_TIENDA: tienda, TRANSBANK_API_KEY: llave } = env;
    if (!comercio || !tienda || !llave) throw new Error('PAGOS_TRANSBANK=produccion exige TRANSBANK_COMERCIO, TRANSBANK_COMERCIO_TIENDA y TRANSBANK_API_KEY');
    return crearOneclick({ base: 'https://webpay3g.transbank.cl', comercio, tienda, llave }, 'produccion');
  }
  return crearPasarelaFalsa();
}
