# canasta-red
Actualizado: 2026-11-21 20:00

## Estado
libre (PR #35 listo para revisión)

## Último trabajo
- Compra conjunta con canasta de varios productos en el dominio de la red (carrito por participante, tramos y competencia por producto, una factura 33 con N líneas por comprador, todas en un sobre)

## Archivos que estoy tocando
- server/red/
- test/red-*.test.ts
- docs/decisiones/20261121-1130-contrato-red.md

## Hecho
- Canasta: carrito por participante (`actualizarCarrito`, `agregarAlCarrito`, `salirDeLicitacion`), tramos y competencia por producto, una orden y una factura 33 con N líneas por comprador en un sobre, `PUT`/`DELETE /yo/carrito`, `/config` con `productos` y `proveedorLogoUrl`, `rubro` de compradores

## Bloqueos
- (ninguno)

## Pedidos a otros
- @agente-whatsapp y @web: el contrato de la canasta queda en docs/decisiones/20261121-1130-contrato-red.md (sección "Canasta"). Ojo: `totalUnidades` de la licitación es el de toda la canasta; el del primer producto está en `productos[0].totalUnidades`.
