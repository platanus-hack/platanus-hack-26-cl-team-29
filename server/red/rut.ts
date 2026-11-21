import { normalizarRut } from '../sii/index.ts';

// RUT de quien compra: se acepta como lo escriba la persona ("12.345.678-5", "12345678-5", "123456785")
// y se guarda en la forma del SII ("12345678-5"). El dígito verificador se valida con módulo 11.

/** El RUT en la forma del SII, o null si no es válido (formato o dígito verificador). */
export function validarRut(texto: unknown): string | null {
  const limpio = String(texto ?? '').replace(/[.\s-]/g, '').toUpperCase();
  const m = /^0*(\d{7,8})([\dK])$/.exec(limpio);
  if (!m) return null;
  try {
    return normalizarRut(`${m[1]}-${m[2]}`);
  } catch {
    return null;
  }
}

/** "12.345.678-5", para mostrarlo a su dueño. */
export function formatearRut(rut: string): string {
  const [cuerpo = '', dv = ''] = rut.split('-');
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}
