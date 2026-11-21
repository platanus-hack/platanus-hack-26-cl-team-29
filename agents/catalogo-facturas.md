# catalogo-facturas
Actualizado: 2026-11-21 19:41

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/catalogo/ (nuevo), shared/catalogo.ts (nuevo), shared/precios.ts (tramosSugeridos, problemaDeTramos)
- client/src/canal/MiCatalogo.tsx (nuevo), canal.css, api.ts, falso.ts, useCanal.ts (useDatoEnVivo), ConectarSii.tsx (usa el hook)
- Mínimo en: server/red/dominio.ts (`NuevoProducto.tramos`), rutas.ts y rutas-web.ts (montaje), server/index.ts, shared/red.ts (evento), client/src/canal/Proveedor.tsx (una línea)

## Hecho
- "Mi catálogo" del proveedor, armado solo desde sus facturas (XML DTE) con tramos sugeridos por su historial. Decisión: docs/decisiones/20261121-1941-catalogo-desde-facturas.md

## Bloqueos
- (ninguno)

## Pedidos a otros
- @humano: para cargar XML reales de un proveedor, `POST /api/red/operacion/catalogo/<proveedorId>/xml` con `x-demo-token` y el XML como cuerpo.
