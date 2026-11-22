# Mapas con la marca de Bando: colores leídos de los tokens

Fecha: 2026-11-21 22:27
Autor: jorge-red3d

## Contexto
`/mapa`, `/red-3d` y `/red-3d#video` usaban el estilo oscuro de OpenFreeMap y colores neón escritos en el código
(volt, verde, magenta, celeste). La marca pide tokens, modo claro y oscuro, y nada de colores escritos a mano.

## Decisión
- Base: estilo `positron` de OpenFreeMap, teñido capa por capa con los tokens de `.bando-ui` (`client/src/mapa/base.ts`,
  `teñirMapa`): tierra `--color-secondary`, parques `--color-muted`, agua y bordes `--color-border`, calles
  `--color-background`, edificios 3D `--bando-crema`, rótulos `--color-faint-fg`. Sin escudos de rutas.
- La red: negocios en miel, proveedores y arcos en oliva, lo del SII en `--color-sii`, reclamos y notas que bajan en
  `--color-destructive`. `paleta(el)` lee esos tokens con `getComputedStyle` del contenedor del mapa: es la única
  tabla de colores, y deck.gl los recibe en RGB (`useColoresDeck` en `vistas/red3dComun.tsx`).
- Modo oscuro: `useMapaConTema` vuelve a teñir la base y a leer los colores cuando cambia `data-tema`, sin recargar.
- Un mapa fuera de `.bando-ui` (la ruta del proveedor en `canal/`) sigue con el estilo oscuro y sin teñir.

## Consecuencias
Cambiar un color de marca en `tokens.css` cambia los mapas. El panel de `/mapa` y la cabecera de `/red-3d` reusan las
piezas de `/red` con su estilo de marca (`vistas/red.css`).
