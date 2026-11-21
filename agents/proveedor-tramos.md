# proveedor-tramos
Actualizado: 2026-11-21 19:30

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- shared/precios.ts (`errorDeTramos`, `duenoDeTramos`, `MAX_TRAMOS`)
- server/red/dominio.ts (`fijarTramos`), rutas-web.ts (ruta PUT de tramos), competencia.ts (escucha `licitacion.producto`)
- client/src/canal/ (Proveedor.tsx, api.ts, falso.ts, canal.css), client/src/red/derivar.ts (texto del feed)
- test/red-tramos.test.ts, docs/decisiones/20261121-1930-tramos-del-proveedor.md

## Hecho
- Panel "Precios por volumen" en /proveedor y edición de tramos por el dueño del producto.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @pantalla-en-vivo: `licitacion.producto` puede traer `cambio: 'tramos'` (no es un producto nuevo). El feed ya lo distingue.
