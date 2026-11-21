// Lectura de diagnóstico del portal de certificación del SII, SOLO LECTURA y con UN solo login: ficha de la empresa,
// resolución y primera página de rangos reobtenibles de 33, 52 y 61. No pide, no reobtiene ni anula folios.
//
//   SII_PFX_CLAVE=... SII_RUT_EMISOR=76123456-7 node scripts/sii-portal-lectura.ts ruta/al/certificado.pfx [carpeta-captura]
//
// Cada login cuenta contra el cupo de sesiones del RUT: no lo corras en bucle. Si el SII responde el límite de
// sesiones, espera al menos 45 minutos. La captura (respuestas redactadas) va a la carpeta indicada, nunca al repo.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  consultarFicha, consultarResolucion, crearAlmacenSesionesMemoria, crearCandadoMemoria, crearPortalSii, esErrorPortal,
  INTERVALO_FOLIOS_MS, listarReobtenibles,
} from '../server/sii-portal/index.ts';

const [rutaPfx, carpeta] = process.argv.slice(2);
const clave = process.env.SII_PFX_CLAVE;
const rutEmpresa = process.env.SII_RUT_EMISOR;
if (!rutaPfx || !clave || !rutEmpresa) {
  console.error('Uso: SII_PFX_CLAVE=... SII_RUT_EMISOR=... node scripts/sii-portal-lectura.ts certificado.pfx [carpeta-captura]');
  process.exit(1);
}
if (carpeta) mkdirSync(carpeta, { recursive: true, mode: 0o700 });
let n = 0;
const portal = crearPortalSii({
  almacen: crearAlmacenSesionesMemoria(),
  candado: crearCandadoMemoria(),
  capturar: c => {
    if (!carpeta) return;
    const nombre = `${String(++n).padStart(2, '0')}-${c.operacion}-${c.paso.replace(/[^\w.-]/g, '_')}`;
    writeFileSync(join(carpeta, `${nombre}.json`), JSON.stringify({ ...c, cuerpo: undefined }, null, 2), { mode: 0o600 });
    writeFileSync(join(carpeta, `${nombre}.html`), c.cuerpo, { mode: 0o600 });
  },
});

const paso = async (nombre: string, fn: () => Promise<unknown>) => {
  try {
    console.log(`\n== ${nombre}\n`, JSON.stringify(await fn(), null, 2));
  } catch (e) {
    console.log(`\n== ${nombre}: ERROR`, esErrorPortal(e) ? { codigo: e.codigo, mensaje: e.message, paso: e.paso, mensajeSii: e.mensajeSii } : e);
    if (esErrorPortal(e, 'LIMITE_SESIONES') || esErrorPortal(e, 'SESION_VENCIDA')) throw e;
  }
};

await portal.conSesion({ pfx: readFileSync(rutaPfx), clave }, 'lectura', async sesion => {
  await paso('ficha (ce_consulta_muestra_e)', async () => {
    const f = await consultarFicha(sesion, rutEmpresa);
    return { razonSocial: f.razonSocial, giro: f.giro, acteco: f.acteco, comuna: f.comuna, actividades: f.actividades.length };
  });
  await paso('resolución (app de datos de la empresa en www2c)', () => consultarResolucion(sesion, rutEmpresa));
  for (const tipo of [33, 52, 61]) {
    await paso(`rangos reobtenibles ${tipo} (primera página)`, () => listarReobtenibles(sesion, rutEmpresa, tipo, 15));
  }
}, { ritmoMs: INTERVALO_FOLIOS_MS }).catch(e => {
  console.error('\nSe detuvo:', esErrorPortal(e) ? { codigo: e.codigo, mensaje: e.message, mensajeSii: e.mensajeSii } : e);
  process.exitCode = 1;
});
