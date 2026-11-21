// RUT de quien compra, en el teléfono: se formatea mientras se escribe (12.345.678-5) y se valida el dígito
// verificador (módulo 11) antes de enviarlo. El servidor lo vuelve a validar y lo consulta en el SII.

/** Solo dígitos y K (la K solo al final, como dígito verificador), hasta 9 caracteres. */
function limpiar(texto: string): string {
  const s = texto.toUpperCase().replace(/[^0-9K]/g, '');
  const cuerpo = s.slice(0, -1).replace(/K/g, '');
  return (cuerpo + s.slice(-1)).slice(0, 9);
}

/** "123456785" -> "12.345.678-5", tal como se escribe. Con un solo carácter no pone guion. */
export function formatearRutAlEscribir(texto: string): string {
  const s = limpiar(texto);
  if (s.length < 2) return s;
  const cuerpo = s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${s.slice(-1)}`;
}

export function digitoVerificador(cuerpo: string): string {
  let suma = 0;
  [...cuerpo].reverse().forEach((d, i) => { suma += Number(d) * (2 + (i % 6)); });
  const resto = 11 - (suma % 11);
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
}

/** true si tiene 7 u 8 dígitos y el dígito verificador calza. */
export function rutValido(texto: string): boolean {
  const m = /^(\d{7,8})([\dK])$/.exec(limpiar(texto).replace(/^0+/, ''));
  return !!m && digitoVerificador(m[1]!) === m[2];
}
