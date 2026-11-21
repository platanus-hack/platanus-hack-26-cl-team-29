// Enriquecimiento de proveedores en segundo plano: giros e inicio de actividades desde la consulta pública del SII
// (STC, sin certificado), solo para los que siguen sin categoría una clasificación de la IA y, para los de Mercado Público,
// su canal de contacto buscado en la web. De a uno, con pausa,
// y con caché persistente por RUT: un RUT ya consultado no se vuelve a consultar. Nunca bloquea el arranque ni la búsqueda.
import type pg from 'pg';
import type { IdCategoria } from '../../shared/categorias.ts';
import type { Contacto, EntradaContacto } from '../ia/index.ts';

export type { Contacto, EntradaContacto } from '../ia/index.ts';

export interface GiroSii {
  codigo: string;
  descripcion: string;
}

export interface DatosSii {
  /** Fecha de inicio de actividades (`AAAA-MM-DD` o como la entrega el SII), o null si no tiene. */
  inicioActividades: string | null;
  giros: GiroSii[];
  /** Cuándo se consultó (ISO). */
  consultado: string;
}

export interface Clasificacion {
  categoria: IdCategoria;
  /** Una frase corta del porqué. */
  porque: string;
  /** `ia` si la dio el modelo; `reglas` si fue el respaldo sin clave. */
  fuente: 'ia' | 'reglas';
  en: string;
}

export interface Enriquecido {
  rut: string;
  /** null: el SII dice que el RUT no está registrado. */
  sii?: DatosSii | null;
  clasificacion?: Clasificacion;
  /** null: se buscó y no se encontró un teléfono o correo seguro. */
  contacto?: (Contacto & { en: string }) | null;
}

/** Lo que la IA recibe para clasificar un proveedor ambiguo. */
export interface EntradaClasificacion {
  rut: string;
  nombre: string;
  giros: string[];
  productos: string[];
}

export type ConsultarSii = (rut: string) => Promise<Omit<DatosSii, 'consultado'> | null>;
export type Clasificar = (e: EntradaClasificacion) => Promise<Omit<Clasificacion, 'en'> | null>;
export type BuscarContacto = (e: EntradaContacto) => Promise<Contacto | null>;

export interface AlmacenEnriquecidos {
  todos(): Promise<Enriquecido[]>;
  guardar(e: Enriquecido): Promise<void>;
}

export function crearAlmacenEnriquecidosMemoria(): AlmacenEnriquecidos {
  const porRut = new Map<string, Enriquecido>();
  return { todos: async () => [...porRut.values()], guardar: async e => void porRut.set(e.rut, e) };
}

export async function crearAlmacenEnriquecidosPostgres(db: pg.Pool): Promise<AlmacenEnriquecidos> {
  await db.query('create table if not exists proveedores_enriquecidos (rut text primary key, datos jsonb not null, en timestamptz not null default now())');
  return {
    async todos() {
      const { rows } = await db.query<{ datos: Enriquecido }>('select datos from proveedores_enriquecidos');
      return rows.map(r => r.datos);
    },
    async guardar(e) {
      await db.query(
        `insert into proveedores_enriquecidos (rut, datos) values ($1, $2)
         on conflict (rut) do update set datos = excluded.datos, en = now()`,
        [e.rut, JSON.stringify(e)],
      );
    },
  };
}

/** Pausa entre consultas al SII: una cada 1,5 s, lejos de parecer abuso. */
export const ESPERA_SII_MS = 1500;
/** Tras tantos errores seguidos (sin red, SII caído o bloqueado) se deja de consultar hasta el próximo arranque. */
const MAX_FALLAS_SEGUIDAS = 5;

export interface OpcionesEnriquecedor {
  almacen: AlmacenEnriquecidos;
  consultarSii: ConsultarSii;
  clasificar: Clasificar;
  /** Sin buscador (sin clave de la IA) no se busca contacto. */
  buscarContacto?: BuscarContacto | null;
  /** Se llama cada vez que hay un dato nuevo (para avisar por `red:evento`). */
  alCambiar: (e: Enriquecido) => void;
  esperaMs?: number;
  ahora?: () => Date;
  log?: Pick<Console, 'warn'>;
}

export interface Enriquecedor {
  de(rut: string): Enriquecido | undefined;
  /** Pide los giros del SII de estos RUT (los que ya están en caché no se consultan). */
  pedirSii(ruts: string[]): void;
  /** Pide clasificar estos proveedores (los ya clasificados se saltan). */
  pedirClasificacion(entradas: EntradaClasificacion[]): void;
  /** Pide buscar el contacto de estos proveedores (los ya buscados se saltan). */
  pedirContacto(entradas: EntradaContacto[]): void;
  /** Se resuelve cuando la fila queda vacía (para los tests). */
  enCalma(): Promise<void>;
  detener(): void;
}

export async function crearEnriquecedor(o: OpcionesEnriquecedor): Promise<Enriquecedor> {
  const log = o.log ?? console;
  const ahora = () => (o.ahora?.() ?? new Date()).toISOString();
  const esperaMs = o.esperaMs ?? ESPERA_SII_MS;
  const datos = new Map((await o.almacen.todos()).map(e => [e.rut, e]));
  const filaSii: string[] = [];
  /** Tareas de la IA (clasificar, buscar contacto), de a una, después de las del SII. */
  const filaIa: { clave: string; correr: () => Promise<void> }[] = [];
  const enFila = new Set<string>();
  // ponytail: un RUT que falló no se reintenta hasta el próximo arranque; con muchos fallidos, reintentar por hora.
  const fallidos = new Set<string>();
  let fallasSeguidas = 0;
  let corriendo: Promise<void> | null = null;
  let detenido = false;

  async function guardar(e: Enriquecido) {
    datos.set(e.rut, e);
    await o.almacen.guardar(e);
    o.alCambiar(e);
  }

  async function unaConsultaSii(rut: string) {
    try {
      const sii = await o.consultarSii(rut);
      fallasSeguidas = 0;
      await guardar({ ...datos.get(rut), rut, sii: sii && { ...sii, consultado: ahora() } });
    } catch (error) {
      fallidos.add(rut);
      if (++fallasSeguidas === MAX_FALLAS_SEGUIDAS) {
        log.warn(`[proveedores] el SII falló ${MAX_FALLAS_SEGUIDAS} veces seguidas; se deja de consultar hasta el próximo arranque`, error);
      }
    }
  }

  /** Encola una tarea de la IA sobre un RUT; `hecha` dice si ya está en caché. Un error no se guarda: se reintenta al arrancar. */
  function encolarIa(tipo: string, rut: string, hecha: (e: Enriquecido | undefined) => boolean, correr: () => Promise<Partial<Enriquecido> | null>) {
    const clave = `${tipo}:${rut}`;
    if (hecha(datos.get(rut)) || enFila.has(clave)) return;
    enFila.add(clave);
    filaIa.push({
      clave,
      correr: async () => {
        try {
          const cambio = await correr();
          if (cambio) await guardar({ ...datos.get(rut), rut, ...cambio });
        } catch (error) {
          log.warn(`[proveedores] falló ${tipo}`, rut, error);
        }
      },
    });
  }

  async function vaciar() {
    while (!detenido) {
      const rut = fallasSeguidas < MAX_FALLAS_SEGUIDAS ? filaSii.shift() : undefined;
      if (rut) {
        await unaConsultaSii(rut);
        enFila.delete(`sii:${rut}`);
        if (filaSii.length) await new Promise(r => setTimeout(r, esperaMs));
        continue;
      }
      const tarea = filaIa.shift();
      if (!tarea) break;
      await tarea.correr();
      enFila.delete(tarea.clave);
    }
  }

  const despertar = () => {
    if (corriendo || detenido || (!filaSii.length && !filaIa.length)) return;
    corriendo = vaciar().finally(() => {
      corriendo = null;
    });
  };

  return {
    de: rut => datos.get(rut),
    pedirSii(ruts) {
      for (const rut of ruts) {
        if (datos.get(rut)?.sii !== undefined || fallidos.has(rut) || enFila.has(`sii:${rut}`)) continue;
        enFila.add(`sii:${rut}`);
        filaSii.push(rut);
      }
      despertar();
    },
    pedirClasificacion(entradas) {
      for (const e of entradas) {
        encolarIa('clasificar', e.rut, d => !!d?.clasificacion, async () => {
          const c = await o.clasificar(e);
          return c && { clasificacion: { ...c, en: ahora() } };
        });
      }
      despertar();
    },
    pedirContacto(entradas) {
      const buscar = o.buscarContacto;
      if (!buscar) return;
      for (const e of entradas) {
        encolarIa('contacto', e.rut, d => d?.contacto !== undefined, async () => {
          const c = await buscar(e);
          return { contacto: c && { ...c, en: ahora() } };
        });
      }
      despertar();
    },
    enCalma: async () => {
      while (corriendo) await corriendo;
    },
    detener: () => {
      detenido = true;
    },
  };
}
