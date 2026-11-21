# canasta-sala
Actualizado: 2026-11-21 23:30

## Estado
libre (PR #43 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/vistas/Sala.tsx, Licitacion.tsx, RedEnVivo.tsx y sus css
- client/src/red/derivar.ts, client/src/red/tipos.ts (solo lo de la canasta), client/src/red/formato.ts (`formatearTelefono`), lo proyectado de client/src/red/falso.ts
- client/src/components/Canasta.tsx (nuevo), client/src/components/Iconos.tsx (íconos de productos y WhatsApp), client/src/vistas/canasta.css (nuevo)
- test/pantalla-derivar.test.ts

## Hecho
- `/sala`, `/licitacion` y `/red` muestran la canasta completa: una fila por producto (precio, precio solo y %, avance al siguiente tramo, quién va ganando), totales de la canasta, aviso a pantalla completa al cruzar el tramo de cualquier producto (máximo uno cada 6 s) y bajadas por oferta animadas en su fila.
- Número de WhatsApp bajo el QR como enlace directo (`wa.me`) con pastilla "Abrir WhatsApp"; `formatearTelefono(digitos)` en `red/formato.ts`.
- Red falsa con carritos de varios productos, cambios de carrito (entra, cambia, sale) y competencia por producto.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @carrito-movil: no toqué client/src/canal/ ni Unirse.tsx. `formatearTelefono(digitos: string): string` ya está en `client/src/red/formato.ts` (reemplaza a `telefono`, que no usaba nadie más).
