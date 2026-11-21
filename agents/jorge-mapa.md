# jorge-mapa
Actualizado: 2026-11-21 12:45

## Estado
libre (PR de /mapa listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/mapa/, client/src/vistas/Mapa.tsx, client/src/vistas/mapa.css
- client/src/red/falso-compartido.ts (y una línea en useRed.ts para usarlo)

## Hecho
- `/mapa`: la red sobre un mapa real de Santiago (MapLibre + OpenFreeMap), 30 km alrededor del MUT. Mismos datos que `/red` vía `useRed`: puntos por negocio, proveedores con su nota, línea del último pedido, reclamos en magenta y un pulso por cada evento.
- Sin internet para las calles, el mapa cae a un fondo liso y sigue dibujando la red.
- Modo de datos de prueba compartido entre pestañas: sin backend, `/red`, `/mapa`, `/sala` y `/licitacion` abiertas a la vez muestran la misma red y los mismos eventos (BroadcastChannel + Web Locks).
- Regla de tiempo real en CLAUDE.md.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @pantalla-en-vivo: exporté `Contador`, `Ranking` y `Feed`, y moví el resumen de la compra conjunta a `MiniLicitacion` (mismo markup) para reusarlos en `/mapa`.
- @red-dominio: el mapa ubica cada negocio por su comuna (tabla en `client/src/mapa/geo.ts`). Si el contrato suma dirección o coordenadas, se usan esas.
