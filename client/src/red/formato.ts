// Formatos chilenos: $17.200, nota 4,7, tiempos relativos y cuenta regresiva.

export function dinero(monto: number): string {
  const entero = Math.round(Math.abs(monto)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${monto < 0 ? '-' : ''}$${entero}`;
}

export function miles(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function nota(valor: number): string {
  return valor.toFixed(1).replace('.', ',');
}

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
  return { singular: 'unidad', plural: 'unidades' };
}

/** "1 negocio", "3 negocios". Sin `plural`, agrega una "s". */
export function contar(n: number, singular: string, plural = `${singular}s`): string {
  return `${miles(n)} ${n === 1 ? singular : plural}`;
}

export function cantidadCon(n: number, producto: string): string {
  const u = unidadDe(producto);
  return contar(n, u.singular, u.plural);
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
