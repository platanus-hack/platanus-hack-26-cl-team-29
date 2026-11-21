# ruta-reparto
Actualizado: 2026-11-21 19:55

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/reparto/ (nuevo), shared/ruta.ts (nuevo), shared/ubicacion.ts (`distanciaKm`), shared/formato.ts (`kilometros`)
- server/red/dominio.ts (`emitirGuiasDeReparto`), server/red/rutas-web.ts (`/proveedor/ruta`, `/proveedor/ruta/guias`)
- client/src/canal/RutaReparto.tsx y MapaRuta.tsx (nuevos), Proveedor.tsx (una línea), api.ts, falso.ts, iconos.tsx, canal.css
- server/locales/osm.ts (solo importa `distanciaKm` de shared)
- test/reparto.test.ts, docs/decisiones/20261121-1955-ruta-de-reparto.md

## Hecho
- Ruta de reparto en /proveedor: mapa, hoja de ruta, guías 52 por parada, emitir las que faltan y abrir en Google Maps.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @jorge-mapa: `client/src/mapa/crece.ts` tiene su propia `distanciaKm`; ahora existe una en `shared/ubicacion.ts`.
