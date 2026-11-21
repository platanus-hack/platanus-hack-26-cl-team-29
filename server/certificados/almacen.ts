import type pg from 'pg';

/** Un certificado conectado. `cifrado` es `{ pfxBase64, clave }` en JSON, cifrado con SII_LLAVE_CIFRADO. */
export interface CertificadoGuardado {
  /** RUT del titular, forma "12345678-5". */
  readonly rut: string;
  /** Teléfono desde el que se conectó, solo dígitos. */
  readonly telefono: string;
  readonly cifrado: string;
  readonly venceEl: Date;
}

export interface AlmacenCertificados {
  /** Guarda o reemplaza el certificado de ese RUT. */
  guardar(c: CertificadoGuardado): Promise<void>;
  buscar(rut: string): Promise<CertificadoGuardado | null>;
}

export function crearAlmacenMemoria(): AlmacenCertificados {
  const porRut = new Map<string, CertificadoGuardado>();
  return {
    async guardar(c) { porRut.set(c.rut, c); },
    async buscar(rut) { return porRut.get(rut) ?? null; },
  };
}

// Tabla propia del módulo, creada al arrancar como las demás.
export async function crearAlmacenPostgres(db: pg.Pool): Promise<AlmacenCertificados> {
  await db.query(`create table if not exists certificados_negocio (
    rut text primary key,
    telefono text not null,
    cifrado text not null,
    vence_el timestamptz not null,
    actualizado timestamptz not null default now()
  )`);
  return {
    async guardar(c) {
      await db.query(
        `insert into certificados_negocio (rut, telefono, cifrado, vence_el) values ($1, $2, $3, $4)
         on conflict (rut) do update set telefono = excluded.telefono, cifrado = excluded.cifrado,
           vence_el = excluded.vence_el, actualizado = now()`,
        [c.rut, c.telefono, c.cifrado, c.venceEl],
      );
    },
    async buscar(rut) {
      const { rows } = await db.query('select * from certificados_negocio where rut = $1', [rut]);
      const r = rows[0];
      return r ? { rut: r.rut, telefono: r.telefono, cifrado: r.cifrado, venceEl: r.vence_el } : null;
    },
  };
}
