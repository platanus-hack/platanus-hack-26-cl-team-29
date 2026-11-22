// Solo para la demo: un proveedor sin certificado puede usar la conexión del panel (la empresa de la demo, con su
// certificado y sus folios) en vez de la suya. Sus documentos salen emitidos por esa empresa en el SII de
// certificación. Se guarda por RUT del proveedor; en uso real, cada proveedor conecta su propio certificado.
import type pg from 'pg';

export interface DemoSii {
  usa(rut: string): boolean;
  fijar(rut: string, usar: boolean): Promise<void>;
}

export async function crearDemoSii(db: pg.Pool | null): Promise<DemoSii> {
  const usan = new Set<string>();
  if (db) {
    try {
      await db.query('create table if not exists sii_demo_proveedores (rut text primary key)');
      for (const r of (await db.query('select rut from sii_demo_proveedores')).rows) usan.add(r.rut);
    } catch (error) {
      console.error('[conexion-sii] no se pudo leer quién usa la conexión demo; queda en memoria', error);
      db = null;
    }
  }
  return {
    usa: rut => usan.has(rut),
    async fijar(rut, usar) {
      if (usar) usan.add(rut);
      else usan.delete(rut);
      if (!db) return;
      await db.query(usar ? 'insert into sii_demo_proveedores (rut) values ($1) on conflict do nothing' : 'delete from sii_demo_proveedores where rut = $1', [rut]);
    },
  };
}
