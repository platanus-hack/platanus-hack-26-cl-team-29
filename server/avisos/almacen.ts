import type pg from 'pg';
import { claveTelefono } from '../agente/envios.ts';
import type { LicitacionVista, Negocio } from '../red/tipos.ts';

// Contactos de los avisos: los compradores que se registraron solos (por WhatsApp o en la web) y lo que se sabe
// de ellos para avisarles. Viven aparte de la red (tabla `avisos_contactos`): reiniciar la demo borra los negocios,
// pero no el historial de quién compró ni, sobre todo, quién pidió no recibir más avisos.

export interface Contacto {
  /** `tel:<últimos 9 dígitos>` o, sin teléfono (web), `rut:<rut>`. */
  id: string;
  /** Solo interno: nunca en eventos ni respuestas HTTP. */
  telefono?: string;
  nombre: string;
  comuna?: string;
  rubro?: string;
  /** Se registró en la red con su RUT. Solo a estos se les avisa: nunca a teléfonos sacados de otra fuente. */
  registrado: boolean;
  /** Productos de la canasta que tuvo en su carrito en compras anteriores. */
  productos: string[];
  /** Compras conjuntas (`ronda`) en que participó. */
  rondas: string[];
  /** Compras conjuntas en que ya se le avisó (las últimas). */
  avisadas: string[];
  /** La compra de su último aviso, mientras no responda: un SÍ lo suma. */
  esperaSi?: string;
  /** Cuándo pidió no recibir más avisos. No se borra nunca. */
  sinAvisos?: string;
  /** Código de su invitación ("Trae a tu vecino"): al azar, nunca sacado de su teléfono ni de su RUT. */
  codigo?: string;
  /** Quién lo invitó (`Contacto.id`), si llegó con un código. */
  invitadoPor?: string;
  /** Cuándo se le contó su llegada a quien lo invitó (una sola vez). */
  invitacionContada?: string;
  /** Compras en que ya se le ofreció invitar a otro negocio. */
  ofrecidas?: string[];
}

/** Una compra conjunta: su id se repite tras cada reinicio de la demo (`L-1`), su cierre no. */
export const ronda = (l: Pick<LicitacionVista, 'id' | 'cierraEn'>) => `${l.id}@${l.cierraEn}`;

/** Clave del contacto de un negocio: su teléfono o, si entró por la web sin teléfono, su RUT. */
export const claveDe = (n: Pick<Negocio, 'telefono' | 'rut'>) =>
  (n.telefono && claveTelefono(n.telefono) ? `tel:${claveTelefono(n.telefono)}` : n.rut ? `rut:${n.rut}` : null);

export const contactoVacio = (id: string): Contacto => ({ id, nombre: '', registrado: false, productos: [], rondas: [], avisadas: [] });

export interface AlmacenContactos {
  todos(): Contacto[];
  buscar(id: string): Contacto | null;
  guardar(contacto: Contacto): Promise<void>;
}

/** Memoria (tests y sin DATABASE_URL) con escritura a Postgres si se entrega `persistir`. */
function enMemoria(iniciales: Contacto[], persistir?: (c: Contacto) => Promise<void>): AlmacenContactos {
  const porId = new Map(iniciales.map(c => [c.id, c]));
  return {
    todos: () => [...porId.values()].map(c => structuredClone(c)),
    buscar: id => (porId.has(id) ? structuredClone(porId.get(id)!) : null),
    async guardar(c) {
      porId.set(c.id, structuredClone(c));
      await persistir?.(c);
    },
  };
}

export const crearAlmacenContactosMemoria = (): AlmacenContactos => enMemoria([]);

export async function crearAlmacenContactos(db: pg.Pool | null): Promise<AlmacenContactos> {
  if (!db) return crearAlmacenContactosMemoria();
  try {
    await db.query('create table if not exists avisos_contactos (id text primary key, datos jsonb not null)');
    const { rows } = await db.query('select datos from avisos_contactos');
    return enMemoria(rows.map(r => r.datos as Contacto), async c => {
      await db.query('insert into avisos_contactos (id, datos) values ($1, $2) on conflict (id) do update set datos = excluded.datos',
        [c.id, JSON.stringify(c)]);
    });
  } catch (error) {
    console.error('[avisos] no se pudo usar Postgres, sigo en memoria', error);
    return crearAlmacenContactosMemoria();
  }
}
