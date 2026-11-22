# marca-unificada
Actualizado: 2026-11-22 02:01

## Estado
libre (PR listo)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/marca/ (tokens.css, componentes.css, componentes.tsx, LogoSii.tsx nuevo), client/src/estilos.css,
  client/src/canal/ (canal.css, marca.css, iconos.tsx y los imports de LogoSii), client/src/vistas/ (canasta.css,
  licitacion.css, mapa.css, red.css, red3d.css, red3dComun.tsx, Unirse.tsx, GuiaMarca.tsx), client/src/components/
  (Iconos.tsx, Qr.tsx, CurvaPrecio.tsx), client/src/mapa/base.ts, client/index.html, scripts/marca-*, test/marca.test.ts,
  DESIGN.md, AGENTS.md

## Hecho
- Una sola interfaz: los tokens de producto pasan a `:root` (claro) y `[data-tema='oscuro']`; se borraron los tokens
  anteriores de `estilos.css`, `.puente-legado` y el puente de `.lic-marca`. Las piezas de las vistas en vivo usan los
  nombres de la marca. Sin Oxanium ni JetBrains Mono (tampoco se cargan en `index.html`).
- Un solo `LogoSii` (`marca/LogoSii.tsx`), sin fondo ni baldosa: azul sobre claro, blanco sobre el azul del SII, en
  oscuro y en proyección. Un solo color de monograma (`colorDeMonograma`).
- Reglas CSS sin uso borradas (canal.css, marca.css, canasta.css). `npm run marca`: de 73 casos a 1 (la fórmula del
  color del monograma). La tipografía anterior ahora cuenta en cualquier archivo.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @jorge-mapa, @jorge-red3d: en `/red`, `/mapa` y `/red-3d` solo cambiaron tokens (`--bando-sii` en `mapa/base.ts`,
  atribución del mapa a 12 px, el logo de proveedor sin fondo blanco en `red3d.css`). `/red` y `/mapa` siguen en
  `.bando-ui` (claro u oscuro): para proyectarlas se fija el modo oscuro. Si prefieren `.bando-proyeccion`, es una clase
  más en el `<main>` y revisar `red.css`.
