# Stock declarado por el proveedor

Fecha: 2026-11-22 02:38
Autor: Luciano (con agente)

## Contexto
Un proveedor escribió por WhatsApp "vendo impresoras térmicas ... a 15 lucas, tengo 200" y el bot ignoró el 200. Sin
stock, una compra en grupo podía asignarle más unidades de las que tiene. El feedback de la mentoría pedía además un
descuento por liquidación al agotar el stock.

## Decisión
- El proveedor declara su stock por producto, opcional: en su lista (`/proveedor` > Productos, campo "Stock"), por
  WhatsApp ("vendo ... a $15.000, tengo 200" o después "tengo 200 impresoras") y en una oferta (`Oferta.stock`). Las
  ofertas automáticas desde su lista llevan su stock y se rehacen si cambia.
- Al cerrar, a ningún proveedor se le asigna más que su stock: cada línea va a la mejor oferta que tenga stock libre y
  lo que no cabe pasa a la siguiente mejor (o queda sin proveedor). Una línea se puede repartir entre dos proveedores.
- Si todos los que venden un producto declararon stock, la vista trae `quedan` (`unidadesDisponibles` en
  `shared/precios.ts`) y el comprador ve "Quedan N" al sumarse. Con un proveedor sin tope no hay "quedan".
- La compra con proveedor fijo de la demo no usa stock.

## Fuera por ahora
- **Descuento por liquidación** (bajar un porcentaje a todos cuando el grupo se lleva el stock completo): necesita una
  regla de precio nueva y su aviso en vivo. Queda como siguiente paso; por dentro sería un tramo más en el stock.
- El precio del grupo no considera el stock: si el más barato tiene poco, el precio publicado es el suyo y al cerrar el
  resto se factura al precio de la siguiente oferta.
