import { sinTildes } from '../../shared/texto.ts';
import type { Contacto } from './almacen.ts';

// A quién avisar que abrió una compra conjunta, y en qué orden. Simple y explicable: cada contacto suma puntos por
// lo que lo acerca a esta compra y queda con el motivo más fuerte. Si nadie calza, se avisa a todos los que se puede.

export type Motivo = 'compro_antes' | 'participo' | 'comuna' | 'rubro' | 'todos';

/** Puntos de cada señal: lo que ya compró pesa más que haber participado, y eso más que la comuna o el rubro. */
const PUNTOS: Record<Exclude<Motivo, 'todos'>, number> = { compro_antes: 8, participo: 4, comuna: 2, rubro: 1 };

export interface CompraAbierta {
  /** Identifica esta compra conjunta (`ronda`): un aviso por negocio y por compra. */
  ronda: string;
  comuna: string;
  productos: readonly string[];
  /** Contactos (`Contacto.id`) que ya están en la compra. */
  dentro: ReadonlySet<string>;
}

export interface Destinatario {
  contacto: Contacto;
  motivo: Motivo;
  puntos: number;
}

/** Se le puede avisar: se registró solo, tiene teléfono, no dijo BASTA, no está dentro y no se le avisó de esta compra. */
export const sePuedeAvisar = (c: Contacto, compra: CompraAbierta): boolean =>
  c.registrado && Boolean(c.telefono) && !c.sinAvisos && !compra.dentro.has(c.id) && !c.avisadas.includes(compra.ronda);

export function audienciaDelAviso(contactos: readonly Contacto[], compra: CompraAbierta): Destinatario[] {
  const productos = new Set(compra.productos);
  const comuna = sinTildes(compra.comuna.trim());
  const comproAntes = (c: Contacto) => c.productos.some(p => productos.has(p));
  // Rubros de quienes ya compraron estos productos: a un negocio del mismo rubro probablemente también le sirven.
  const rubros = new Set(contactos.filter(c => c.rubro && comproAntes(c)).map(c => c.rubro));
  const posibles = contactos.filter(c => sePuedeAvisar(c, compra));
  const puntuados = posibles.map(contacto => {
    const senales: Exclude<Motivo, 'todos'>[] = [];
    if (comproAntes(contacto)) senales.push('compro_antes');
    if (contacto.rondas.length > 0) senales.push('participo');
    if (comuna && contacto.comuna && sinTildes(contacto.comuna.trim()) === comuna) senales.push('comuna');
    if (contacto.rubro && rubros.has(contacto.rubro)) senales.push('rubro');
    const puntos = senales.reduce((s, m) => s + PUNTOS[m], 0);
    return { contacto, motivo: senales[0] ?? 'todos', puntos } satisfies Destinatario;
  });
  const calzan = puntuados.filter(d => d.puntos > 0);
  return (calzan.length > 0 ? calzan : puntuados).sort((a, b) => b.puntos - a.puntos);
}
