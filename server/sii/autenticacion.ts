// Token SOAP del SII: semilla (CrSeed), semilla firmada con el certificado y canje por token (GetTokenFromSeed).
import type { Certificado } from './certificado.ts';
import { firmarSemilla } from './firma.ts';
import { CABECERAS_SOAP, desescapar, ErrorSii, etiqueta, type Http, sobreSoap, URLS } from './soap.ts';
import { escaparXml } from './texto.ts';

/** Lo que devuelve un uso del token: el valor y si el SII rechazó el token por vencido o inexistente. */
export interface UsoDeToken<T> {
  readonly valor: T;
  readonly tokenRechazado: boolean;
}

/** `ESTADO 001` (y 002/003 en QueryEstDte): token inactivo o inexistente. Se renueva y se reintenta una vez. */
export const esTokenRechazado = (estado: string | null): boolean => estado !== null && /^00[123]$/.test(estado);

/** Un token en memoria por proceso. No vence por tiempo: se renueva cuando el SII lo rechaza. */
export class Autenticador {
  readonly #http: Http;
  readonly #certificado: Certificado;
  #token: Promise<string> | null = null;

  constructor(http: Http, certificado: Certificado) {
    this.#http = http;
    this.#certificado = certificado;
  }

  /** El token guardado o uno nuevo. Llamadas concurrentes comparten la misma autenticación. */
  token(): Promise<string> {
    if (this.#token) return this.#token;
    const pedido = this.#pedirToken();
    this.#token = pedido;
    // Un fallo no queda guardado: la próxima llamada vuelve a intentar.
    pedido.catch(() => {
      if (this.#token === pedido) this.#token = null;
    });
    return pedido;
  }

  /** Descarta el token guardado y pide uno nuevo. */
  tokenNuevo(): Promise<string> {
    this.#token = null;
    return this.token();
  }

  /** Usa el token y, si el SII lo rechaza, pide uno nuevo y reintenta UNA vez. Solo para operaciones repetibles. */
  async conToken<T>(usar: (token: string) => Promise<UsoDeToken<T>>): Promise<T> {
    const primero = await usar(await this.token());
    if (!primero.tokenRechazado) return primero.valor;
    return (await usar(await this.tokenNuevo())).valor;
  }

  /** La semilla dura unos 2 minutos: se firma y se canjea apenas llega. */
  async #pedirToken(): Promise<string> {
    const semilla = await this.#leer('semilla', sobreSoap('<getSeed/>'), 'SEMILLA');
    const firmada = firmarSemilla(semilla, this.#certificado);
    const cuerpo = sobreSoap(`\n    <getToken>\n      <pszXml>${escaparXml(firmada)}</pszXml>\n    </getToken>\n  `);
    return this.#leer('token', cuerpo, 'TOKEN');
  }

  async #leer(servicio: 'semilla' | 'token', cuerpo: string, valor: string): Promise<string> {
    const r = await this.#http({ url: URLS[servicio], cabeceras: CABECERAS_SOAP, cuerpo });
    const texto = desescapar(r.cuerpo);
    const estado = etiqueta(texto, 'ESTADO');
    const leido = etiqueta(texto, valor);
    if (r.status !== 200 || estado !== '00' || !leido) {
      throw new ErrorSii(
        `El SII no entregó ${valor} (HTTP ${r.status}, ESTADO ${estado ?? 'sin estado'}: ${etiqueta(texto, 'GLOSA') ?? 'sin glosa'})`,
        texto,
      );
    }
    return leido;
  }
}
