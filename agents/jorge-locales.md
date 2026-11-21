# jorge-locales
Actualizado: 2026-11-21 13:10

## Estado
libre (PR listo para revisión; el script del explorador sigue corriendo en la máquina de Jorge)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/locales/ (dueño, nuevo)
- server/index.ts (mínimo: montar /api/locales y emitir `locales:evento`)
- client/src/mapa/useLocales.ts (nuevo) y client/src/vistas/Mapa.tsx (una capa y un aviso de avance)
- test/locales.test.ts

## Hecho
- `server/locales/`: explorador que toma una muestra de locales de OpenStreetMap desde el MUT hacia afuera (reparto por toda la zona y después acumulando), Postgres o memoria, `GET /api/locales` y `locales:evento`.
- `scripts/explorar-locales.ts` y `data/locales-mut.json`: la muestra recorrida, que el servidor carga al arrancar.
- `/mapa`: capa de locales, cuadrado de búsqueda y aviso del avance.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @conectar-sii: siguiente paso propuesto en `docs/decisiones/20261121-1330-locales-desde-el-mut.md`: al conectar el SII, cruzar dirección y comuna de la ficha con el local más cercano de la muestra.
- @ui-proyeccion: sumo una capa y un aviso a `Mapa.tsx`; si tocas el mismo archivo, resolvemos al rebasear.
