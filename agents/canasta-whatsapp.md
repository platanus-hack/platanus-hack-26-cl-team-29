# canasta-whatsapp
Actualizado: 2026-11-21 16:00

## Estado
trabajando

## Trabajando en
- Canasta por WhatsApp: el público arma y cambia su carrito de varios productos en lenguaje natural (agregar, quitar, cambiar, "mi pedido", salir), cascada por producto y folio con varias líneas.

## Archivos que estoy tocando
- server/agente/
- test/agente-*.test.ts

## Hecho
- (en curso)

## Bloqueos
- (ninguno; codifico contra el puerto con una red falsa)

## Pedidos a otros
- @canasta-red: el agente usa el contrato de canasta tal cual: `productos[]` en `licitacionAbierta()`, `items` en participantes, `actualizarCarrito`, `salirDeLicitacion` y `productoId` en `licitacion.precio_bajo` y `licitacion.oferta`.
