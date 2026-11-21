// Revisa en el SII de CERTIFICACIÓN (QueryEstDte) un documento que la red emitió, típicamente uno que quedó
// `incierto` por un corte de red al subir. Lee el folio de la tabla sii_folios (DATABASE_URL) y guarda la respuesta.
// Nunca reenvía ni anula: con FAU (no recibido) el folio queda `no_recibido` para que una persona decida.
//
//   node --env-file=.env scripts/sii-folio.ts --tipo 33 --folio 12
import pg from 'pg';
import { crearSii } from '../server/sii/index.ts';
import { crearSiiReal } from '../server/red/index.ts';
import { crearAlmacenFoliosPostgres } from '../server/red/folios.ts';

const args = process.argv.slice(2);
const numero = (nombre: string) => Number(args[args.indexOf(`--${nombre}`) + 1]);
const tipo = numero('tipo'), folio = numero('folio');
if (!process.env.DATABASE_URL || !Number.isSafeInteger(tipo) || !Number.isSafeInteger(folio)) {
  console.error('Uso (con DATABASE_URL): node --env-file=.env scripts/sii-folio.ts --tipo <33|52|61> --folio <n>');
  process.exit(2);
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const sii = crearSiiReal({ sii: crearSii(), folios: await crearAlmacenFoliosPostgres(db), seguirEnvios: false });
  const { registro, estado } = await sii.consultarDocumento(tipo, folio);
  console.log(JSON.stringify({ ...registro, detalle: undefined }, null, 2));
  console.log(`\n${estado.codigo} ${estado.glosa ?? ''} ${estado.glosaError ?? ''}\n${estado.respuesta}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
