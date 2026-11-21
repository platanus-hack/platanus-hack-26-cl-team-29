import type pg from 'pg';

// Folios de los documentos que la red manda al SII real. Un folio se toma de los rangos de los CAF del tipo (puede
// haber varios: la reposición de folios suma rangos reobtenidos o pedidos), se guarda antes de armar el documento y
// nunca vuelve a usarse, aunque el envío falle: dentro de cada rango, el siguiente es siempre el mayor ya tomado + 1.
// Aquí también queda lo que respondió el SII, para consultarlo después.

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
  /**
   * Toma el siguiente folio del tipo dentro de `rangos` (ver `siguienteFolio`) y lo guarda `reservado`. Falla si
   * ningún rango tiene folios.
   */
  reservar(tipo: number, rangos: readonly RangoFolios[], ordenId: string): Promise<RegistroFolio>;
  guardar(registro: RegistroFolio): Promise<void>;
  buscar(tipo: number, folio: number): Promise<RegistroFolio | undefined>;
  deOrden(ordenId: string, tipo: number): Promise<RegistroFolio[]>;
  /** Folios ya tomados del tipo (en cualquier estado): ninguno vuelve a usarse. */
  tomados(tipo: number): Promise<number[]>;
}

/**
 * Siguiente folio de un rango: el que sigue al mayor ya tomado DENTRO del rango, nunca antes de `desde`. null si el
 * rango se agotó. Un hueco bajo el mayor tomado no se rellena: un folio que la red alcanzó a reservar pudo llegar al SII.
 */
export function siguienteEnRango(rango: RangoFolios, tomados: readonly number[]): number | null {
  const mayor = tomados.reduce((m, f) => (f >= rango.desde && f <= rango.hasta && f > m ? f : m), rango.desde - 1);
  return mayor < rango.hasta ? mayor + 1 : null;
}

/** Rangos en el orden en que se gastan: el de folios más bajos primero (suele ser el más antiguo, el que vence antes). */
const enOrden = (rangos: readonly RangoFolios[]) => [...rangos].sort((a, b) => a.desde - b.desde);

/** Siguiente folio entre varios rangos (varios CAF del mismo tipo), en orden; null si todos se agotaron. */
export function siguienteFolio(rangos: readonly RangoFolios[], tomados: readonly number[]): number | null {
  for (const r of enOrden(rangos)) {
    const folio = siguienteEnRango(r, tomados);
    if (folio !== null) return folio;
  }
  return null;
}

/** Folios que quedan por tomar en los rangos, con la misma regla que `siguienteFolio`. */
export function foliosLibres(rangos: readonly RangoFolios[], tomados: readonly number[]): number {
  return rangos.reduce((total, r) => {
    const folio = siguienteEnRango(r, tomados);
    return total + (folio === null ? 0 : r.hasta - folio + 1);
  }, 0);
}

const agotado = (tipo: number, rangos: readonly RangoFolios[]) =>
  new Error(`[sii] los CAF del tipo ${tipo} no tienen folios libres (${rangos.map(r => `${r.desde} a ${r.hasta}`).join(', ') || 'sin CAF'}): hay que reponer folios`);

const nuevo = (tipo: number, folio: number, ordenId: string): RegistroFolio =>
  ({ tipo, folio, ordenId, estado: 'reservado', trackId: '', actualizadoEn: new Date().toISOString() });

/** Sin base de datos: se pierde al reiniciar el proceso. Un mismo almacén simula un reinicio en los tests. */
export function crearAlmacenFoliosMemoria(): AlmacenFolios {
  const registros = new Map<string, RegistroFolio>();
  const clave = (tipo: number, folio: number) => `${tipo}:${folio}`;
  const tomados = (tipo: number) => [...registros.values()].filter(r => r.tipo === tipo).map(r => r.folio);
  return {
    async reservar(tipo, rangos, ordenId) {
      const folio = siguienteFolio(rangos, tomados(tipo));
      if (folio === null) throw agotado(tipo, rangos);
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
    async tomados(tipo) {
      return tomados(tipo);
    },
  };
}

/**
 * Tabla `sii_folios`: la llave (rut_emisor, tipo, folio) impide que un folio de una empresa se tome dos veces. Cada
 * proveedor con SII real tiene sus propios folios (`rutEmisor`); los de la conexión del panel van con `''` (así
 * quedaron los guardados antes de haber varios emisores).
 */
export async function crearAlmacenFoliosPostgres(db: pg.Pool, rutEmisor = ''): Promise<AlmacenFolios> {
  await db.query(`create table if not exists sii_folios (
    rut_emisor text not null default '',
    tipo int not null,
    folio int not null,
    orden_id text not null,
    datos jsonb not null,
    primary key (rut_emisor, tipo, folio)
  )`);
  // Una tabla de antes (llave tipo, folio) pasa a llevar el emisor en la llave; sus filas quedan con ''.
  await db.query(`alter table sii_folios add column if not exists rut_emisor text not null default ''`);
  await db.query(`do $$ begin
    if not exists (select 1 from information_schema.key_column_usage
                   where table_name = 'sii_folios' and constraint_name = 'sii_folios_pkey' and column_name = 'rut_emisor') then
      alter table sii_folios drop constraint sii_folios_pkey;
      alter table sii_folios add primary key (rut_emisor, tipo, folio);
    end if;
  end $$`);
  const tomados = async (tipo: number): Promise<number[]> =>
    (await db.query(`select folio from sii_folios where rut_emisor = $1 and tipo = $2`, [rutEmisor, tipo])).rows.map(r => Number(r.folio));
  return {
    async reservar(tipo, rangos, ordenId) {
      // La llave (tipo, folio) decide si otra instancia lo tomó primero: entonces se calcula el siguiente otra vez.
      for (let intento = 0; intento < 5; intento++) {
        const folio = siguienteFolio(rangos, await tomados(tipo));
        if (folio === null) throw agotado(tipo, rangos);
        const registro = nuevo(tipo, folio, ordenId);
        const { rowCount } = await db.query(
          `insert into sii_folios (rut_emisor, tipo, folio, orden_id, datos) values ($5, $1, $2, $3, $4::jsonb) on conflict do nothing`,
          [tipo, folio, ordenId, JSON.stringify(registro), rutEmisor],
        );
        if (rowCount === 1) return registro;
      }
      throw new Error(`[sii] no se pudo reservar un folio del tipo ${tipo}: otra emisión los tomó al mismo tiempo`);
    },
    async guardar(registro) {
      await db.query(
        `update sii_folios set datos = $3 where rut_emisor = $4 and tipo = $1 and folio = $2`,
        [registro.tipo, registro.folio, JSON.stringify(registro), rutEmisor],
      );
    },
    async buscar(tipo, folio) {
      const { rows } = await db.query(`select datos from sii_folios where rut_emisor = $3 and tipo = $1 and folio = $2`, [tipo, folio, rutEmisor]);
      return rows[0]?.datos;
    },
    async deOrden(ordenId, tipo) {
      const { rows } = await db.query(
        `select datos from sii_folios where rut_emisor = $3 and orden_id = $1 and tipo = $2 order by folio`, [ordenId, tipo, rutEmisor],
      );
      return rows.map(r => r.datos);
    },
    tomados,
  };
}
