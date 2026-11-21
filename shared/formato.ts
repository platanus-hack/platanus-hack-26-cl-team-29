// Formatos chilenos que comparten la web, WhatsApp y los PDF: $1.234.567 y nota 4,7.

/** Separador de miles chileno, también con cuatro dígitos: 6900 → "6.900". Sin decimales. */
export function miles(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Monto en pesos: $1.234.567, sin decimales. El único formateador de dinero. */
export function dinero(monto: number): string {
  return `${monto < 0 ? '-' : ''}$${miles(Math.abs(monto))}`;
}

/** Nota con coma decimal: 4.7 → "4,7". */
export function nota(valor: number): string {
  return valor.toFixed(1).replace('.', ',');
}

/** Distancia con coma decimal bajo 100 km: 12.4 → "12,4 km"; 134.2 → "134 km". */
export function kilometros(km: number): string {
  return `${km < 100 ? nota(km) : miles(km)} km`;
}
