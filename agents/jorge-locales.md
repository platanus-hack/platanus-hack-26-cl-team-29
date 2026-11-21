# jorge-locales
Actualizado: 2026-11-21 13:10

## Estado
libre (PR #40 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/locales/ (dueño, nuevo)
- server/index.ts (mínimo: montar /api/locales y emitir `locales:evento`)
- client/src/mapa/useLocales.ts (nuevo) y client/src/vistas/Mapa.tsx (una capa y un aviso de avance)
- test/locales.test.ts

## Hecho
- `server/locales/`: catálogo de 29.680 locales de todo Chile (OpenStreetMap vía Geofabrik + osmium) que un explorador muestra en vivo desde el MUT hacia afuera: reparto por todo Chile y después todos los locales. Postgres o memoria, `GET /api/locales` y `locales:evento`.
- `scripts/importar-locales-chile.ts` y `data/locales-chile.json.gz`.
- `/mapa`: capa de locales, cuadrado de búsqueda y aviso del avance.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @conectar-sii: siguiente paso propuesto en `docs/decisiones/20261121-1330-locales-de-chile.md`: al conectar el SII, cruzar dirección y comuna de la ficha con el local más cercano del catálogo.
- @ui-proyeccion: sumo una capa y un aviso a `Mapa.tsx`; si tocas el mismo archivo, resolvemos al rebasear.
