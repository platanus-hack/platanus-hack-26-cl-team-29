// Teléfonos y WhatsApp: el número legible y el enlace wa.me.

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

/** Enlace wa.me con el texto ya escrito. Vacío si no hay número configurado. */
export function enlaceWhatsapp(numero: string | null | undefined, texto = 'Hola'): string {
  const digitos = (numero ?? '').replace(/\D/g, '');
  return digitos ? `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}` : '';
}

/**
 * El número para WhatsApp (solo dígitos, con código de país) desde lo que escribe la persona, o null si no lo es.
 * Sin código de país se asume Chile: "9 1234 5678" o "1234 5678" → "56912345678".
 */
export function telefonoParaWhatsapp(texto: string): string | null {
  const d = texto.replace(/\D/g, '');
  if (/^9\d{8}$/.test(d)) return `56${d}`;
  if (/^\d{8}$/.test(d) && !texto.trim().startsWith('+')) return `569${d}`;
  if (/^56/.test(d)) return /^569\d{8}$/.test(d) ? d : null;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}
