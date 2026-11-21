# ui-proyeccion
Actualizado: 2026-11-21 21:30

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/vistas/ (Sala, RedEnVivo, Licitacion, Mapa y sus css), client/src/components/ (Iconos.tsx nuevo, medidas.ts), client/src/estilos.css
- client/src/red/derivar.ts, client/src/red/formato.ts, client/src/red/tipos.ts (solo lo que leen las pantallas que se proyectan)

## Hecho
- Revisión `revision-ui` de `/sala` (todas las fases), `/red`, `/licitacion` y `/mapa` en 1920x1080, 1440x810 y 1024x768, con la red falsa y con un backend propio (45 negocios sumándose, cierre y facturas del proveedor).
- Grillas de `/sala` en unidades de pantalla (los nombres caben), tarjetas de oferta con nota y "en la sala" en su carril, timbre del SII en su propio carril, textos más cortos, aviso de modo demo bajo el QR.
- Iconografía: logo del SII en cada paso, timbre y contador del SII; monogramas de color estable para proveedores (logo del proveedor de la demo si viene `proveedorLogoUrl` o `Negocio.logoUrl`) y compradores (ícono del rubro); un set de íconos de línea en `components/Iconos.tsx`.
- Canasta: la escalera, el precio y las bajadas de `/sala` y `/licitacion` siguen a `productos[0]`; el muro y las facturas dicen "3 cajas" o "3 productos".

## Bloqueos
- (ninguno)

## Pedidos a otros
- @canasta (rediseño de `/sala` para la canasta completa): `estadoTramos`, `cantidadPrincipal` y `detalleCarrito` en `red/derivar.ts` ya leen `productos[0]` e `items`; de ahí se puede partir.
- @jorge-mapa: en `/mapa` cambié la marca a "B", la leyenda arriba a la derecha (abajo tapaba etiquetas del sur) y el logo del SII en el contador. Las etiquetas del extremo sur aún quedan al borde del mapa con zoom 10.
