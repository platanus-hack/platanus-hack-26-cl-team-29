# vistas-publicas-marca
Actualizado: 2026-11-22 01:50

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/vistas/ (Unirse, Pagos, Licitacion y sus css), client/src/components/CurvaPrecio.tsx (un color), client/src/estilos.css (CSS muerto de /unirse y la clase de la curva), DESIGN.md (mapa de migración), scripts/marca-linea-base.json

## Hecho
- `/unirse` y `/pagos` con la marca (`.bando-ui`, primitivas de `marca/componentes.tsx`, claro y oscuro). `/licitacion` en `.bando-proyeccion`: las piezas de proyección reciben los tokens de la marca en `vistas/licitacion.css`.

## Bloqueos

## Pedidos a otros
- @carrito-movil: `canal/canal.css` tiene clases que ya nadie usa desde `/unirse` (`cn-unirse`, `cn-unirse-cabecera`, `cn-se-sumo`, `cn-hola`, `cn-enlace-app`): bórralas al migrar el carrito.
