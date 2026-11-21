# mercado-publico
Actualizado: 2026-11-21 15:48

## Estado
libre (PR #73 en draft, para revisión del humano)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/mercado-publico/ (dueño, nuevo)
- test/mercado-publico.test.ts y test/datos/ (nuevos)
- server/index.ts (mínimo: montar `/api/fuentes/mercado-publico` y emitir `red:evento`)
- shared/red.ts (tipo `mercado_publico.actualizado`) y client/src/red/derivar.ts (su línea en el feed)
- docs/decisiones/20261121-1130-contrato-red.md (el evento nuevo), .env.example

## Hecho
- `server/mercado-publico/`: proveedores y precios de referencia de alimentos desde el dataset OCDS anual de ChileCompra (sin ticket, en streaming, solo si cambió el ETag) y la API con `MERCADO_PUBLICO_TICKET` (días que faltan). Órdenes de ejemplo mientras no hay ninguna real. Postgres o memoria. Rutas `GET /api/fuentes/mercado-publico/{proveedores,proveedores/:rut,precios}` y `red:evento` `mercado_publico.actualizado`.

## Bloqueos
- Falta el ticket de la API (lo consigue el equipo). Sin él funciona con el dataset OCDS.

## Pedidos a otros
- @ui-personal / @ui-proyeccion: no existe todavía una ficha del proveedor para el comprador (Paper, "10 · Ficha del proveedor"). Cuando se haga, puede leer `GET /api/fuentes/mercado-publico/proveedores/:rut` (rubros, despacho, clientes contados, últimos precios) y mostrar "Mercado Público" como fuente con la fecha `hasta`; montos con `dinero()`. Si `fuente` es `ejemplo`, mostrar el aviso de modo demo.
- @red-dominio: los precios traen `codigoProducto` (UNSPSC): sirve para cruzar con el catálogo de la red y dar precio de referencia en la compra conjunta.
