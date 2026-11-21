# jorge-locales
Actualizado: 2026-11-21 13:10

## Estado
trabajando

## Trabajando en
- Explorador de locales: recorre Santiago desde el MUT hacia afuera con OpenStreetMap, guarda los locales y los muestra en vivo en /mapa

## Archivos que estoy tocando
- server/locales/ (dueño, nuevo)
- server/index.ts (mínimo: montar /api/locales y emitir `locales:evento`)
- client/src/mapa/useLocales.ts (nuevo) y client/src/vistas/Mapa.tsx (una capa y un aviso de avance)
- test/locales.test.ts

## Hecho
- (nada todavía)

## Bloqueos
- (ninguno)

## Pedidos a otros
- @ui-proyeccion: sumo una capa y un aviso a `Mapa.tsx`; si tocas el mismo archivo, resolvemos al rebasear.
