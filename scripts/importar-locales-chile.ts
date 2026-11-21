// Arma data/locales-chile.json.gz con todos los locales de Chile en OpenStreetMap.
//
//   curl -L -o chile.osm.pbf https://download.geofabrik.de/south-america/chile-latest.osm.pbf
//   node scripts/importar-locales-chile.ts chile.osm.pbf
//
// Necesita osmium-tool (brew install osmium-tool). El extracto de Geofabrik se actualiza a diario.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ARCHIVO_CATALOGO } from '../server/locales/index.ts';
import { FILTRO_OSMIUM, leerGeojsonseq } from '../server/locales/osm.ts';

const extracto = process.argv[2];
if (!extracto) throw new Error('Uso: node scripts/importar-locales-chile.ts chile.osm.pbf');

const carpeta = mkdtempSync(join(tmpdir(), 'locales-'));
const filtrado = join(carpeta, 'filtrado.osm.pbf');
const geojson = join(carpeta, 'locales.geojsonseq');
execFileSync('osmium', ['tags-filter', extracto, ...FILTRO_OSMIUM, '-o', filtrado, '--overwrite']);
execFileSync('osmium', ['export', filtrado, '-f', 'geojsonseq', '-a', 'type,id', '--geometry-types=point,polygon', '-o', geojson, '--overwrite']);

const locales = leerGeojsonseq(readFileSync(geojson, 'utf8')).sort((a, b) => a.distanciaKm - b.distanciaKm);
mkdirSync(dirname(ARCHIVO_CATALOGO), { recursive: true });
writeFileSync(ARCHIVO_CATALOGO, gzipSync(JSON.stringify(locales)));
const cuenta = new Map<string, number>();
for (const l of locales) cuenta.set(l.tipo, (cuenta.get(l.tipo) ?? 0) + 1);
const porTipo = [...cuenta].map(([t, n]) => `${t} ${n}`).join(', ');
console.log(`${locales.length} locales en ${ARCHIVO_CATALOGO}: ${porTipo}`);
