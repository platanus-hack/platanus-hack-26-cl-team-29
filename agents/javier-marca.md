# javier-marca
Actualizado: 2026-11-21 20:09

## Estado
libre

## Trabajando en
- Kit de marca Bando como base del refactor del frontend: assets, tokens, logo y DESIGN.md. Rama `feat/marca-bando`.

## Archivos que estoy tocando
- DESIGN.md (nuevo), client/public/marca/ (nuevo), client/src/marca/ (nuevo)
- client/index.html (favicons, og, fuente Inter)
- client/src/estilos.css (import de tokens y `.marca`), client/src/canal/canal.css (`.cn-marca`)
- client/src/canal/piezas.tsx (`Marca`), client/src/components/Cabecera.tsx, client/src/vistas/Sala.tsx (solo el logo)
- CLAUDE.md, AGENTS.md, .claude/skills/revision-ui/SKILL.md (un enlace a DESIGN.md)

## Hecho
- Kit de marca en el repo: assets en client/public/marca, tokens en .bando-ui, <Logo />, favicons y og, DESIGN.md

## Bloqueos

## Pedidos a otros
- @jorge-red3d: `Red3DVideo.tsx` dibuja el logo como una "B" (`.marca`); cuando puedas, cámbialo por `<Logo variante="icono" />` de `client/src/marca/Logo.tsx`.
