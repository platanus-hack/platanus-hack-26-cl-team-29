# Sistema de diseño de Bando: tokens, primitivas y una regla que se revisa sola

Fecha: 2026-11-22 01:39
Autor: Luciano (con agente)

## Contexto
El kit de marca ya estaba en el repo (DESIGN.md, `client/src/marca/`, `client/public/marca/`), pero solo como texto:
cada vista migrada volvía a dibujar sus botones, tarjetas y estados en su propio CSS (había tres versiones del botón del
SII y dos de la píldora de estado), no había escala de espaciado, sombras ni movimiento, las pantallas que se proyectan
no tenían versión de la marca y nada impedía que entrara un color escrito a mano. Varias personas y agentes migran
vistas en paralelo, así que la consistencia tiene que salir del sistema, no de la memoria de cada uno.

## Decisión
- **Tokens como única fuente:** `tokens.css` suma espaciado en múltiplos de 4, elevación casi plana (la tarjeta se separa
  con borde; solo lo que flota lleva sombra), duraciones y curvas que pasan a cero con `prefers-reduced-motion`, capas
  (`--z-*`) y el color de estado `info`. Los quiebres quedan fijos en 640, 768, 1024 y 1440 px.
- **Modo proyección (`.bando-proyeccion`)** para `/red`, `/licitacion` y `/mapa`: siempre oscuro, texto crema, la miel
  para el número héroe, escala en `vh` con mínimos en px y nada bajo 18 px. Mismos nombres de tokens que `.bando-ui`.
- **Primitivas React** en `marca/componentes.tsx` (`Boton`, `BotonEnlace`, `Tarjeta`, `Etiqueta`, `Cifra`, `Estado`,
  `Barra`, `ProgresoGrupo`, `EstadoVacio`) con sus estilos en `marca/componentes.css`, global. Las reglas que ya existían
  en comprador.css y proveedor.css se movieron ahí; los nombres viejos (`bp-estado`, `bp-boton-sii`) comparten la misma
  regla hasta que su vista los cambie por el componente. Los modificadores llevan el prefijo de su pieza porque la
  interfaz anterior tiene clases globales como `.error` y `.ahorro`.
- **Guía viva en `/marca`:** lee los tokens del CSS real (no copia valores) y calcula el contraste de cada color.
- **`npm run marca`** (trinquete): cuenta por archivo colores escritos a mano, tipografía anterior en vistas migradas,
  `toLocaleString`, letra bajo 12 px y emojis. La deuda actual queda en `scripts/marca-linea-base.json` y no bloquea;
  un archivo que empeora sí. Es obligatorio junto a `build`, `test` y `duplicados`.

## Consecuencias
- Una vista nueva o migrada se arma con las primitivas y no escribe CSS para botones, tarjetas ni estados.
- La deuda baja con cada migración y se guarda con `npm run marca -- --actualizar`; cuando llegue a cero, los tokens de
  `.bando-ui` pasan a `:root` y se borra la capa anterior.
- Descartado: un linter de CSS con dependencias nuevas (stylelint). El script con `node:fs` alcanza para las reglas que
  importan y no suma instalación.
