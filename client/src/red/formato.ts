// Formatos de las pantallas: tiempos relativos, cuenta regresiva y cómo se cuenta cada producto.
// Dinero, miles, notas y conteos están en shared/.
import { contar } from '../../../shared/texto.ts';

// ConectarSii.tsx todavía importa `contar` desde aquí (ver agents/sin-copias.md, Pedidos a otros).
export { contar };

export function haceCuanto(en: string, ahora: number): string {
  const segundos = Math.max(0, Math.round((ahora - Date.parse(en)) / 1000));
  if (segundos < 60) return `hace ${segundos} s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  return `hace ${Math.round(minutos / 60)} h`;
}

export function cuentaRegresiva(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const dos = (n: number) => n.toString().padStart(2, '0');
  const hh = Math.floor(total / 3600);
  const mmss = `${dos(Math.floor((total % 3600) / 60))}:${dos(total % 60)}`;
  return hh > 0 ? `${hh}:${mmss}` : mmss;
}

/** Cómo se cuenta el producto en pantalla: la harina va en sacos, el aceite en bidones. */
export function unidadDe(producto: string): { singular: string; plural: string } {
  if (/harina|az[uú]car/i.test(producto)) return { singular: 'saco', plural: 'sacos' };
  if (/aceite/i.test(producto)) return { singular: 'bidón', plural: 'bidones' };
  if (/^caja/i.test(producto)) return { singular: 'caja', plural: 'cajas' };
  return { singular: 'unidad', plural: 'unidades' };
}

export function cantidadCon(n: number, producto: string): string {
  const u = unidadDe(producto);
  return contar(n, u.singular, u.plural);
}

/** "4 cajas de rollos térmicos 80 mm": sin repetir la unidad cuando el producto ya empieza con ella. */
export function pedidoDe(n: number, producto: string): string {
  const u = unidadDe(producto);
  const resto = producto.replace(new RegExp(`^${u.singular}s?\\s+de\\s+`, 'i'), '');
  return `${cantidadCon(n, producto)} de ${resto}`;
}

const ESTADO_SII: Record<string, string> = {
  aceptado: 'aceptado por el SII',
  reparo: 'aceptado con reparos',
  recibido: 'recibido por el SII',
  rechazado: 'rechazado por el SII',
  reclamado: 'reclamado en el SII',
  simulado: 'simulado',
  incierto: 'en revisión',
  no_recibido: 'en revisión',
  no_coincide: 'en revisión',
  fallido: 'no se pudo enviar',
};

/** Estado del documento en el SII, en palabras. Vacío si no hay estado. */
export function textoEstadoSii(estado: string | null | undefined): string {
  if (!estado) return '';
  return ESTADO_SII[estado] ?? estado.replace(/_/g, ' ');
}

/** Códigos de país de dos dígitos (los de uno son 1 y 7; el resto, de tres). */
const PAISES_DE_DOS = new Set(['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98']);

/**
 * Número de teléfono legible desde sus dígitos (con o sin +): +1 → "+1 (208) 482-8247", Chile → "+56 9 1234 5678";
 * otros, "+<código> " y bloques de 3 y 4 dígitos.
 */
export function formatearTelefono(digitos: string): string {
  const d = digitos.replace(/\D/g, '');
  if (/^1\d{10}$/.test(d)) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (/^569\d{8}$/.test(d)) return `+56 9 ${d.slice(3, 7)} ${d.slice(7)}`;
  const largoPais = /^[17]/.test(d) ? 1 : PAISES_DE_DOS.has(d.slice(0, 2)) ? 2 : 3;
  let resto = d.slice(largoPais);
  const bloques: string[] = [];
  while (resto.length > 4 && resto.length % 4 !== 0) { bloques.push(resto.slice(0, 3)); resto = resto.slice(3); }
  for (let i = 0; i < resto.length; i += 4) bloques.push(resto.slice(i, i + 4));
  return [`+${d.slice(0, largoPais)}`, ...bloques].join(' ');
}
