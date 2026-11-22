# precio-con-stock
Actualizado: 2026-11-22 02:55

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- shared/precios.ts (repartirPorStock, precioDelReparto), server/red/compra.ts (candidatasDe, precio con reparto), server/red/dominio.ts (cierre)
- client/src/comprador/ComprasEnGrupo.tsx, client/src/canal/carrito.ts, tipos (cubreElMejor)

## Hecho
- El precio que ve el grupo sale del mismo reparto por stock que usa el cierre, y todos pagan ese precio único
  (docs/decisiones/20261122-0253-precio-del-grupo-con-stock.md).

## Bloqueos

## Pedidos a otros
- @javier: `candidatasDe` se movió de dominio.ts a compra.ts y `precioVigente`/`vistaLicitacion` reciben la nota de
  cada proveedor (`ContextoPrecio`); dentro de dominio.ts se usan igual que antes.
