# feed-detalle
Actualizado: 2026-11-21 16:53

## Estado
libre (PR #85 listo para revisión)

## Trabajando en
- Feed "Pasando ahora" (/red, /mapa): segunda línea con el detalle de cada evento y panel con todo el detalle al hacer clic.

## Archivos que estoy tocando
- client/src/vistas/RedEnVivo.tsx (`Feed`), client/src/red/derivar.ts (`detalleEvento`), client/src/estilos.css (feed)
- test/feed-detalle.test.ts

## Hecho
- Feed con segunda línea de detalle por evento (`detalleEvento` en derivar.ts) y panel con todo el detalle al tocar la fila; /red y /mapa revisadas en 1920x1080, 1440x810 y 1024x768 sin scroll.

## Bloqueos
- (ninguno)

## Pedidos a otros
- (ninguno)
