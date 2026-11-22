// Rechazos conocidos del portal del SII, explicados para el proveedor: qué pasa y qué hacer, sin rutas internas del
// portal. El texto literal del SII no se pierde: queda en el paso de la conexión y en el log (trazabilidad).

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const CONOCIDOS: readonly [patron: RegExp, explicacion: string][] = [
  [/NO REGISTRA VERIFICACION DE ACTIVIDAD/,
    'Tu RUT no tiene verificación de actividad en el SII, así que todavía no puedes emitir facturas. '
    + 'Pídela en sii.cl, Peticiones Administrativas > Verificación de actividad, o conecta el RUT de tu empresa.'],
  [/(EMPRESA|CONTRIBUYENTE) NO ESTA AUTORIZAD[OA] PARA OPERAR EN ESTA MODALIDAD/,
    'Tu empresa no está autorizada como emisor de facturas electrónicas en este ambiente del SII. '
    + 'Conecta el RUT de una empresa que ya emite facturas electrónicas.'],
];

/** La explicación de un rechazo conocido del SII, o null si el texto no es uno conocido. */
export function explicarRechazoSii(mensajeSii: string | null | undefined): string | null {
  if (!mensajeSii) return null;
  const texto = sinTildes(mensajeSii);
  return CONOCIDOS.find(([patron]) => patron.test(texto))?.[1] ?? null;
}
