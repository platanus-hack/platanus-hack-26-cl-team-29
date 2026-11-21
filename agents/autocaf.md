# autocaf
Actualizado: 2026-11-21 14:58

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/conexion-sii/ (reposicion.ts nuevo; conexion.ts, sii-conmutable.ts, index.ts, rutas.ts, almacen.ts)
- shared/folios.ts (política pura), shared/conexion-sii.ts, shared/red.ts (evento `sii.folios`)
- server/red/folios.ts, server/red/sii-real.ts, server/red/index.ts, server/red/dominio.ts y rutas.ts (código `sin_folios`)
- server/sii/index.ts (mínimo: `crearSiiConectado` y varios CAF por tipo), server/sii-portal/folios.ts (filtro del listado)
- client/src/canal/ConectarSii.tsx (folios de factura y "Traer más folios"), client/src/red/derivar.ts

## Hecho
- Reposición automática de folios: reobtener del rango más nuevo (QueryEstDte, barridos recordados), pedir solo lo que
  falta dentro del tope, enfriamiento tras rechazo, guardia antes de facturar (sin lote a medias), reposición tras cada
  emisión y botón en el panel. Nunca se anula. Varios CAF por tipo. Decisión: docs/decisiones/20261121-1450-reposicion-automatica-de-folios.md
- Sin respaldo por variables SII_*: el panel es la única configuración del SII; un comprador sin RUT verificado no se factura.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @red-sii: `conectarSiiReal` ya no existe y `crearSiiReal` recibe `rangos` en vez de `env`; tu archivo aún lo menciona.
- @luciano-sii: agregué `crearSiiConectado(config)` en server/sii/index.ts; `crearSii(env)` queda para los scripts.
