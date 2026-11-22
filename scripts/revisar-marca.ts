// `npm run marca`: revisa que client/src cumpla las reglas de la marca (scripts/marca-reglas.ts, DESIGN.md "Reglas").
// Funciona como trinquete: la deuda que ya existía está en scripts/marca-linea-base.json y no bloquea, pero ningún
// archivo puede empeorar. Al migrar una vista y bajar su deuda, `npm run marca -- --actualizar` baja la línea base.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REGLAS, loQueEmpeoro, revisarArchivo, type Cuentas } from './marca-reglas.ts';

const RAIZ = join(import.meta.dirname, '..');
const CARPETA = join(RAIZ, 'client/src');
const LINEA_BASE = join(import.meta.dirname, 'marca-linea-base.json');
const EXTENSIONES = /\.(tsx?|css)$/;

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap(e => {
    const ruta = join(carpeta, e.name);
    return e.isDirectory() ? archivos(ruta) : EXTENSIONES.test(e.name) ? [ruta] : [];
  });
}

const actual: Cuentas = {};
for (const ruta of archivos(CARPETA).sort()) {
  const rel = relative(RAIZ, ruta).split('\\').join('/');
  const cuenta = revisarArchivo(rel, readFileSync(ruta, 'utf8'));
  if (Object.keys(cuenta).length) actual[rel] = cuenta;
}

const total = (c: Cuentas) => Object.values(c).reduce((s, r) => s + Object.values(r).reduce((t, n) => t + n!, 0), 0);

if (process.argv.includes('--actualizar')) {
  writeFileSync(LINEA_BASE, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Línea base de la marca actualizada: ${total(actual)} casos en ${Object.keys(actual).length} archivos.`);
  process.exit(0);
}

const base: Cuentas = JSON.parse(readFileSync(LINEA_BASE, 'utf8'));
const peores = loQueEmpeoro(base, actual);
if (peores.length) {
  console.error('La marca empeoró (DESIGN.md, "Reglas"):');
  for (const p of peores) console.error(`  ${p.ruta}: ${REGLAS[p.regla]} Antes ${p.antes}, ahora ${p.ahora}.`);
  console.error('Corrígelo con los tokens y las primitivas de client/src/marca/. La línea base no se sube para hacer pasar un cambio.');
  process.exit(1);
}

const antes = total(base), ahora = total(actual);
console.log(`Marca: sin retrocesos. Deuda pendiente: ${ahora} casos en ${Object.keys(actual).length} archivos.`);
if (ahora < antes) console.log(`Bajó de ${antes} a ${ahora}: corre "npm run marca -- --actualizar" y commitea la línea base nueva.`);
