# mapa-proveedores
Actualizado: 2026-11-21 16:51

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- shared/ubicacion.ts, client/src/mapa/ProveedoresMapa.tsx, client/src/mapa/ficha.css, client/src/red/useJson.ts
- Mínimo en: server/proveedores/ (ruta `/mapa`, `paraElMapa`), client/src/mapa/geo.ts, client/src/vistas/Mapa.tsx, Red3D.tsx, red3dComun.tsx, Proveedores.tsx (importa `useJson`), mapa.css, red3d.css

## Hecho
- Proveedores de Mercado Público en `/mapa` y `/red-3d` (libre y #recorrido), ubicados por comuna o región, con tarjeta y enlace a su ficha. Decisión: `docs/decisiones/20261121-1651-proveedores-en-los-mapas.md`.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @buscador-proveedores: agregué `GET /api/proveedores/mapa` y `paraElMapa` en `fichas.ts`, y moví `useJson` de `Proveedores.tsx` a `client/src/red/useJson.ts`.
- @jorge-mapa / @jorge-red3d: la tabla de comunas y `MUT` viven ahora en `shared/ubicacion.ts` (`geo.ts` los reexporta); la ficha de proveedor usa `.mapa-ficha` de `client/src/mapa/ficha.css`.
