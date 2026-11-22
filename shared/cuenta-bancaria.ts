// Cuenta bancaria donde un proveedor recibe lo que Bando le paga. La usan el formulario del panel del proveedor y el
// servidor (server/pagos/), que la valida igual antes de guardarla. Nunca viaja en eventos ni pantallas públicas.
import { validarRut } from './rut.ts';

export const BANCOS = [
  'BancoEstado', 'Banco de Chile', 'Banco Santander', 'Bci', 'Scotiabank', 'Itaú', 'Banco BICE', 'Banco Security',
  'Banco Falabella', 'Banco Ripley', 'Banco Internacional', 'Banco Consorcio', 'Tenpo', 'Mercado Pago', 'Coopeuch',
] as const;

export const TIPOS_CUENTA = { corriente: 'Cuenta corriente', vista: 'Cuenta vista o RUT', ahorro: 'Cuenta de ahorro' } as const;

export interface CuentaBancaria {
  banco: string;
  tipo: keyof typeof TIPOS_CUENTA;
  numero: string;
  /** RUT del titular, en la forma del SII ("12345678-5"). */
  rutTitular: string;
  titular: string;
}

/** La cuenta limpia, o el error en una frase. */
export function validarCuenta(c: Partial<Record<keyof CuentaBancaria, unknown>>): CuentaBancaria | string {
  const banco = String(c.banco ?? '');
  const tipo = String(c.tipo ?? '');
  const numero = String(c.numero ?? '').replace(/[\s.-]/g, '');
  const rutTitular = validarRut(String(c.rutTitular ?? ''));
  const titular = String(c.titular ?? '').trim().slice(0, 80);
  if (!(BANCOS as readonly string[]).includes(banco)) return 'Elige tu banco de la lista.';
  if (!(tipo in TIPOS_CUENTA)) return 'Elige el tipo de cuenta.';
  if (!/^\d{4,20}$/.test(numero)) return 'El número de cuenta lleva solo dígitos (entre 4 y 20).';
  if (!rutTitular) return 'Revisa el RUT del titular.';
  if (!titular) return 'Falta el nombre del titular.';
  return { banco, tipo: tipo as CuentaBancaria['tipo'], numero, rutTitular, titular };
}

/** "BancoEstado · Cuenta vista o RUT terminada en 1234", sin mostrar el número completo. */
export const cuentaCorta = (c: Pick<CuentaBancaria, 'banco' | 'tipo' | 'numero'>): string =>
  `${c.banco} · ${TIPOS_CUENTA[c.tipo]} terminada en ${c.numero.slice(-4)}`;
