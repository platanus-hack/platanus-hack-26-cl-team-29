// RUT chileno: dígito verificador (módulo 11), forma del SII ("12345678-5") y forma para leer ("12.345.678-5").

export const RUT_INVALIDO = 'Ese RUT no es válido. Revisa los números y el dígito verificador, por ejemplo 12.345.678-5.';

/** Dígito verificador del cuerpo del RUT, con módulo 11: "0" a "9" o "K". */
export function digitoVerificador(cuerpo: string): string {
  let suma = 0;
  [...cuerpo].reverse().forEach((d, i) => { suma += Number(d) * (2 + (i % 6)); });
  const resto = 11 - (suma % 11);
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
}

/** RUT en la forma del XSD del SII: sin puntos, sin ceros a la izquierda, DV en mayúscula (`12345678-5`). Lanza si no es válido. */
export function normalizarRut(rut: string): string {
  const limpio = rut.replace(/[.\s]/g, '').toUpperCase();
  const m = /^0*(\d{1,8})-([\dK])$/.exec(limpio);
  if (!m) throw new Error(`RUT con formato inválido: "${rut}"`);
  const [, cuerpo, dv] = m as unknown as [string, string, string];
  if (digitoVerificador(cuerpo) !== dv) throw new Error(`RUT con dígito verificador inválido: "${rut}"`);
  return `${cuerpo}-${dv}`;
}

/** Cuerpo y dígito verificador por separado, como los piden los formularios del SII. Lanza si no es válido. */
export function partirRut(rut: string): [cuerpo: string, dv: string] {
  const [cuerpo = '', dv = ''] = normalizarRut(rut).split('-');
  return [cuerpo, dv];
}

/**
 * El RUT de una persona, escrito como sea ("12.345.678-5", "12345678-5", "123456785"), en la forma del SII.
 * null si no tiene 7 u 8 dígitos o el dígito verificador no calza.
 */
export function validarRut(texto: unknown): string | null {
  const m = /^0*(\d{7,8})([\dK])$/.exec(String(texto ?? '').replace(/[.\s-]/g, '').toUpperCase());
  return m && digitoVerificador(m[1]!) === m[2] ? `${m[1]}-${m[2]}` : null;
}

/** "12345678-5" → "12.345.678-5", para mostrarlo. Si no parece un RUT, lo deja tal cual. */
export function formatearRut(rut: string): string {
  const m = /^(\d+)-([\dK])$/i.exec(rut.replace(/\./g, ''));
  return m ? `${m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${m[2]!.toUpperCase()}` : rut;
}

/** Solo dígitos y K (la K solo al final, como dígito verificador), hasta 9 caracteres. */
function soloRut(texto: string): string {
  const s = texto.toUpperCase().replace(/[^0-9K]/g, '');
  const cuerpo = s.slice(0, -1).replace(/K/g, '');
  return (cuerpo + s.slice(-1)).slice(0, 9);
}

/** "123456785" → "12.345.678-5" mientras se escribe. Con un solo carácter no pone guion. */
export function formatearRutAlEscribir(texto: string): string {
  const s = soloRut(texto);
  return s.length < 2 ? s : formatearRut(`${s.slice(0, -1)}-${s.slice(-1)}`);
}
