# marca-sistema
Actualizado: 2026-11-22 01:45

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/marca/ (tokens.css, componentes.tsx y componentes.css nuevos, recursos.ts)
- client/src/vistas/GuiaMarca.tsx y guia-marca.css (nuevos, ruta `/marca`)
- scripts/marca-reglas.ts, scripts/revisar-marca.ts, scripts/marca-linea-base.json, test/marca.test.ts
- DESIGN.md, CLAUDE.md (comando `npm run marca`), .claude/skills/revision-ui/SKILL.md
- Lo mínimo en archivos de otros: sacar de comprador.css y proveedor.css las reglas de las primitivas (se movieron, no se copiaron), una línea en main.tsx, Navegador.tsx y estilos.css

## Hecho
- Sistema de diseño exigible: fundamentos en tokens.css (espaciado, sombras, movimiento, capas, quiebres), modo proyección `.bando-proyeccion`, primitivas en `marca/componentes.tsx`, guía viva en `/marca`, `npm run marca` con trinquete y DESIGN.md v2 (reglas, primitivas, proyección y mapa de migración).

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-marca: DESIGN.md ahora abre con "Reglas" (siempre y nunca) y suma Fundamentos, Primitivas, Modo proyección y Mapa de migración; lo tuyo sigue igual. Las reglas `bm-boton`, `bm-tarjeta`, `bm-etiqueta`, `bm-vacio`, `bm-barra`, `bm-chip`, `bm-modal` y `bm-boton-sii` se movieron de comprador.css a `marca/componentes.css` (globales). La voz pasó de "chileno amable" a "cercano, en español neutro".
- @javier-proveedor-ui: `bp-estado` y `bp-boton-sii` ya comparten regla con `Estado` y `Boton variante="sii"` en `marca/componentes.css`; al tocar esas filas, usa los componentes y borra los nombres viejos.
- @todos: antes de commitear, `npm run marca`. Si migras una vista y baja su deuda, `npm run marca -- --actualizar` en el mismo PR.
