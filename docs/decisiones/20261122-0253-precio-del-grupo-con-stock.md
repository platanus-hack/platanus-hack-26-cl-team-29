# Precio del grupo con stock repartido

Fecha: 2026-11-22 02:53
Autor: Luciano (con agente)

## Contexto
Con stock declarado, el cierre reparte el pedido del grupo: lo que no cabe en el stock del mejor va al siguiente. Pero
el precio publicado (`precioActual`) seguía siendo el del mejor, así que el grupo veía un precio y una parte se
facturaba a otro más caro. Además el precio publicado era la oferta más barata, mientras el cierre ordena por precio
ajustado por nota y plazo: con notas distintas también podían no coincidir.

## Decisión
- Una sola regla de reparto, `repartirPorStock` en `shared/precios.ts`, la usan el precio que ve el grupo y el cierre.
  Las candidatas salen de `candidatasDe` (ahora en `server/red/compra.ts`), ordenadas por precio ajustado, igual que al
  cerrar.
- Precio único del grupo: el de la parte más cara que hace falta para cubrir sus unidades (`precioDelReparto`). Todos
  pagan lo mismo, y cada línea de cada orden se factura a ese precio, aunque la cubra un proveedor que ofertó menos.
  Así lo que el comprador ve en vivo es exactamente lo que se factura.
- Cuando el stock del que gana no alcanza, la vista trae `cubreElMejor` y la compra en `/app` lo dice: "El proveedor
  que gana tiene solo N: el resto lo cubre el siguiente y todos pagan $X".
- Excepción: si un participante no puede comprarse a sí mismo y le toca un proveedor más caro que el precio del grupo,
  esa línea va al precio de ese proveedor.
- Con proveedor fijo (la demo) no cambia nada: un solo proveedor, sin reparto.

## Alternativas descartadas
- Que cada unidad pague el precio de quien la cubre: dos negocios en la misma compra pagarían distinto según el orden
  en que se sumaron, y rompe "todos pagan el precio final".
- Promedio ponderado: no es un precio entero por unidad y la suma de las facturas no cuadra con lo mostrado.
