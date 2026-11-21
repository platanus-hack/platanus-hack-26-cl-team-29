import type pg from 'pg';

// Folios de los documentos que la red manda al SII real. Un folio se toma del rango del CAF, se guarda
// antes de armar el documento y nunca vuelve a usarse, aunque el envío falle: el siguiente es siempre
// el mayor ya tomado + 1. Aquí también queda lo que respondió el SII, para consultarlo después.

/**
 * - `reservado`: tomado, el documento se está armando o subiendo (si queda así tras un reinicio, es incierto).
 * - `fallido`: falló antes de subir (armado o autenticación); nada llegó al SII.
 * - `rechazado`: el SII rechazó el sobre al subirlo o al procesarlo.
 * - `incierto`: corte de red al subir; pudo llegar o no. Se consulta con QueryEstDte, nunca se reenvía solo.
 * - `recibido`: el SII lo recibió (STATUS 0, o DOK al consultar); falta su veredicto.
 * - `aceptado`, `reparo`: veredicto del SII al procesar el envío.
 * - `no_recibido` (FAU), `no_coincide` (DNK): respuesta de QueryEstDte a un documento consultado.
 */
export type EstadoFolio =
  | 'reservado' | 'fallido' | 'rechazado' | 'incierto' | 'recibido' | 'aceptado' | 'reparo' | 'no_recibido' | 'no_coincide';

export interface RegistroFolio {
  tipo: number;
  folio: number;
  ordenId: string;
  estado: EstadoFolio;
  trackId: string;
  /** Datos con que se consulta el documento en QueryEstDte; existen desde que se armó. */
  fechaEmision?: string;
  montoTotal?: number;
  rutReceptor?: string;
  /** Última respuesta del SII o error, completa. */
  detalle?: string;
  actualizadoEn: string;
}

export interface RangoFolios {
  desde: number;
  hasta: number;
}

export interface AlmacenFolios {
  /** Toma el siguiente folio del tipo (mayor tomado + 1, nunca menor que `desde`) y lo guarda `reservado`. */
  reservar(tipo: number, rango: RangoFolios, ordenId: string): Promise<RegistroFolio>;
  guardar(registro: RegistroFolio): Promise<void>;
  buscar(tipo: number, folio: number): Promise<RegistroFolio | undefined>;
  deOrden(ordenId: string, tipo: number): Promise<RegistroFolio[]>;
  /** Mayor folio ya tomado del tipo, o 0 si no hay ninguno. */
  ultimo(tipo: number): Promise<number>;
}

const agotado = (tipo: number, rango: RangoFolios) =>
  new Error(`[sii] el CAF del tipo ${tipo} no tiene folios libres (rango ${rango.desde} a ${rango.hasta}): hay que pedir uno nuevo`);

const nuevo = (tipo: number, folio: number, ordenId: string): RegistroFolio =>
  ({ tipo, folio, ordenId, estado: 'reservado', trackId: '', actualizadoEn: new Date().toISOString() });

/** Sin base de datos: se pierde al reiniciar el proceso. Un mismo almacén simula un reinicio en los tests. */
export function crearAlmacenFoliosMemoria(): AlmacenFolios {
  const registros = new Map<string, RegistroFolio>();
  const clave = (tipo: number, folio: number) => `${tipo}:${folio}`;
  return {
    async reservar(tipo, rango, ordenId) {
      const usados = [...registros.values()].filter(r => r.tipo === tipo).map(r => r.folio);
      const folio = Math.max(rango.desde, Math.max(0, ...usados) + 1);
      if (folio > rango.hasta) throw agotado(tipo, rango);
      const registro = nuevo(tipo, folio, ordenId);
      registros.set(clave(tipo, folio), structuredClone(registro));
      return registro;
    },
    async guardar(registro) {
      registros.set(clave(registro.tipo, registro.folio), structuredClone(registro));
    },
    async buscar(tipo, folio) {
      const r = registros.get(clave(tipo, folio));
      return r && structuredClone(r);
    },
    async deOrden(ordenId, tipo) {
      return [...registros.values()].filter(r => r.ordenId === ordenId && r.tipo === tipo).map(r => structuredClone(r));
    },
    async ultimo(tipo) {
      return Math.max(0, ...[...registros.values()].filter(r => r.tipo === tipo).map(r => r.folio));
    },
  };
}

/** Tabla `sii_folios`: la llave (tipo, folio) impide que un folio se tome dos veces. */
export async function crearAlmacenFoliosPostgres(db: pg.Pool): Promise<AlmacenFolios> {
  await db.query(`create table if not exists sii_folios (
    tipo int not null,
    folio int not null,
    orden_id text not null,
    datos jsonb not null,
    primary key (tipo, folio)
  )`);
  return {
    async reservar(tipo, rango, ordenId) {
      const registro = nuevo(tipo, 0, ordenId);
      const { rows } = await db.query(
        `with siguiente as (
           select greatest(coalesce(max(folio), 0) + 1, $2::int) as folio from sii_folios where tipo = $1
         )
         insert into sii_folios (tipo, folio, orden_id, datos)
         select $1, folio, $4, $5::jsonb || jsonb_build_object('folio', folio) from siguiente where folio <= $3
         returning folio`,
        [tipo, rango.desde, rango.hasta, ordenId, JSON.stringify(registro)],
      );
      if (rows.length === 0) throw agotado(tipo, rango);
      return { ...registro, folio: Number(rows[0].folio) };
    },
    async guardar(registro) {
      await db.query(
        `update sii_folios set datos = $3 where tipo = $1 and folio = $2`,
        [registro.tipo, registro.folio, JSON.stringify(registro)],
      );
    },
    async buscar(tipo, folio) {
      const { rows } = await db.query(`select datos from sii_folios where tipo = $1 and folio = $2`, [tipo, folio]);
      return rows[0]?.datos;
    },
    async deOrden(ordenId, tipo) {
      const { rows } = await db.query(
        `select datos from sii_folios where orden_id = $1 and tipo = $2 order by folio`, [ordenId, tipo],
      );
      return rows.map(r => r.datos);
    },
    async ultimo(tipo) {
      const { rows } = await db.query(`select coalesce(max(folio), 0) as folio from sii_folios where tipo = $1`, [tipo]);
      return Number(rows[0]?.folio ?? 0);
    },
  };
}
