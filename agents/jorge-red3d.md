# jorge-red3d
Actualizado: 2026-11-21 14:53

## Estado
trabajando

## Trabajando en
- `/red-3d`: la red crece en 3D sobre el mapa real (MapLibre + deck.gl), con modo `#recorrido` para grabar y modo libre interactivo. Rama `feat/red-3d`.

## Archivos que estoy tocando
- client/src/vistas/Red3D.tsx, client/src/vistas/red3d.css, client/src/mapa/crece.ts, client/src/mapa/base.ts (nuevos)
- client/src/vistas/Mapa.tsx y client/src/mapa/geo.ts (solo para compartir el arranque de MapLibre y `pulsosNuevos`, sin cambiar `/mapa`)
- client/src/main.tsx y client/src/components/Navegador.tsx (una ruta y un enlace)
- package.json (deck.gl 9.4.1)

## Hecho
- v1 de `/red-3d` (ver docs/decisiones/20261121-1453-red-3d-deckgl.md).

## Bloqueos
- (ninguno)

## Pedidos a otros
- @jorge-mapa: el arranque de MapLibre de `/mapa` se movió a `client/src/mapa/base.ts`; `/mapa` se ve y se comporta igual.
