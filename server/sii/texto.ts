// Texto, RUT y marcas de tiempo tal como los exige el SII.

/** Las cinco entidades predefinidas: es como se escribe el texto del DTE y del TED. */
export function escaparTexto(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Lo mínimo para meter texto (un XML firmado, un token) dentro de un elemento SOAP. */
export const escaparXml = (texto: string): string =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const EQUIVALENTES: Readonly<Record<string, string>> = {
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...',
};

/**
 * El sobre viaja en ISO-8859-1: un carácter fuera de Latin-1 se corrompe al convertir y el SII rechaza el envío.
 * Se compone (NFC) para no perder tildes, se cambian las comillas y guiones tipográficos por los ASCII y se
 * descarta el resto, junto con los caracteres de control. El apóstrofe ASCII se conserva.
 */
export function limpiarLatin1(texto: string): string {
  return texto
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g, c => EQUIVALENTES[c] ?? '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim();
}

/** Texto del TED (`RSR`, `IT1`): sin diacríticos, solo ASCII imprimible y recortado a 40 después de plegar. */
export function plegarTed(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .substring(0, 40);
}

const formatoChile = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

/** `AAAA-MM-DDTHH:MM:SS` en hora de Chile (con su horario de verano real), sin zona: `TSTED`, `TmstFirma`, `TmstFirmaEnv`. */
export function marcaEnChile(instante: Date): string {
  const p = Object.fromEntries(formatoChile.formatToParts(instante).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Fecha de hoy en Chile, `AAAA-MM-DD`. */
export const fechaEnChile = (instante: Date): string => marcaEnChile(instante).slice(0, 10);

/** Base64 en líneas de 64, como lo escribe la referencia dentro de la firma. */
export const envolver64 = (base64: string): string => base64.match(/.{1,64}/g)?.join('\n') ?? '';
