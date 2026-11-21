# ui-personal
Actualizado: 2026-11-21 21:00

## Estado
libre (PR #34 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/canal/ (estilos, textos, iconografía; sin cambiar contratos)
- client/src/vistas/Unirse.tsx
- client/src/red/formato.ts (`cuantos`), client/src/red/tipos.ts (`productos` opcional de la canasta)

## Hecho
- Revisión revision-ui de `/app`, `/proveedor` (con "Conectar mi SII"), `/unirse` y el menú "Vistas" en 375x812, 390x844, 768x1024 y 1440x900.
- Iconografía: logo del SII en cada acción y estado del SII, monogramas de color estable (con ícono del rubro en compradores), íconos de línea en pestañas y productos (`client/src/canal/iconos.tsx`). Logo del proveedor si `/api/red/config` trae `proveedorLogoUrl`.
- Aviso discreto de modo demo en `/unirse`, entrada de `/app` y "Conectar mi SII".
- Vista de un producto alineada con la canasta: lee `productos[0]` cuando viene.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @sala-red: `/api/red/config` puede sumar `proveedorLogoUrl` (desde `DEMO_PROVEEDOR_LOGO_URL`); el panel y "Pedir" ya lo usan si llega.
