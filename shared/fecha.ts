// Fechas en hora de Chile (con su horario de verano real), como las piden el SII y las personas.

const ZONA = 'America/Santiago';

const formatoChile = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DDTHH:MM:SS` en hora de Chile, sin zona: `TSTED`, `TmstFirma`, `TmstFirmaEnv`. */
export function marcaEnChile(instante: Date | string): string {
  const p = Object.fromEntries(formatoChile.formatToParts(new Date(instante)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** El día en Chile de un instante (Date o texto ISO), `AAAA-MM-DD`. */
export const fechaEnChile = (instante: Date | string): string => marcaEnChile(instante).slice(0, 10);

/** `HH:MM` en Chile. */
export const horaEnChile = (instante: Date | number): string => marcaEnChile(new Date(instante)).slice(11, 16);

/**
 * "15-01-2026", como se leen las fechas en Chile. Acepta un día (`AAAA-MM-DD`, que no se mueve de zona) o un
 * instante ISO (se toma su día en Chile). Lo que no es fecha queda tal cual.
 */
export function fechaCorta(fecha: string): string {
  if (!SOLO_FECHA.test(fecha) && Number.isNaN(Date.parse(fecha))) return fecha;
  const dia = SOLO_FECHA.test(fecha) ? fecha : fechaEnChile(fecha);
  return dia.split('-').reverse().join('-');
}

/** `AAAA-MM-DD` → "15 de enero de 2026". Lo que no es fecha queda tal cual. */
export function fechaLarga(dia: string): string {
  const m = SOLO_FECHA.exec(dia);
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1] ?? m[2]} de ${m[1]}` : dia;
}
