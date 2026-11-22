# DESIGN.md

Cómo se ve y cómo habla Bando. Es la base del rediseño del frontend: toda vista nueva o que se rehace sigue esto. Para
agentes y personas por igual. El manual completo, con ejemplos visuales, está en
[`client/public/marca/manual-de-marca.html`](client/public/marca/manual-de-marca.html) (en la app: `/marca/manual-de-marca.html`).

La revisión de cada pantalla (tamaños, encimados, fricción) sigue en la skill `revision-ui`; este archivo dice *qué*
tiene que verse, esa skill revisa *que se vea bien*. La guía viva está en la app, en **`/marca`**: muestra los tokens
leídos del CSS real, las primitivas en todos sus estados y el modo proyección. Es la referencia para comparar una captura.

## Reglas (léelas antes de tocar una vista)

El sistema tiene tres piezas, y cada una tiene un único lugar en el código:

| Pieza | Dónde | Qué decide |
|---|---|---|
| Tokens | [`client/src/marca/tokens.css`](client/src/marca/tokens.css) | Color, tipografía, espaciado, radios, sombras, movimiento, capas |
| Primitivas | [`client/src/marca/componentes.tsx`](client/src/marca/componentes.tsx) y `componentes.css` | Botón, tarjeta, etiqueta, cifra, estado, progreso, vacío, modal |
| Recursos | [`client/src/marca/recursos.ts`](client/src/marca/recursos.ts) | Logo, íconos de flujo, ilustraciones, abejas, logo del SII |

**Siempre:**

1. Envolver la vista en `.bando-ui` (uso personal) o `.bando-proyeccion` (pantallas que se proyectan).
2. Armar la pantalla con las primitivas: `Boton`, `Tarjeta`, `Etiqueta`, `Cifra`, `Estado`, `ProgresoGrupo`, `EstadoVacio`, `Modal`.
3. Tomar todo valor de un token: color, espacio (`--espacio-*`), radio, sombra, duración, capa (`--z-*`).
4. Separar bloques con `gap`, no con márgenes sueltos.
5. Un número grande y una acción principal por pantalla.
6. Montos con `dinero()` y cantidades con `contar()`, de `shared/`.
7. El logo del SII en toda acción o estado que queda en el SII (`Boton variante="sii"`, `Estado tono="sii"`).
8. Correr `npm run marca` antes de commitear, junto a `build`, `test` y `duplicados`.

**Nunca:**

1. Un color escrito a mano fuera de `tokens.css` (ni hex, ni `rgb()`).
2. Miel como color de texto sobre blanco: para texto, `--bando-miel-texto`.
3. Más de un botón miel por pantalla, ni un botón miel junto a uno primario.
4. Sombra en una tarjeta: se separa con borde. La sombra es solo para lo que flota.
5. Texto de menos de 12 px (18 px en proyección), emojis, Oxanium o JetBrains Mono en una vista con la marca.
6. Un botón, una tarjeta o un estado dibujado de nuevo en el CSS de una vista: si falta una variante, se agrega a la primitiva.
7. El nombre de otro comprador.
8. Subir la línea base de `npm run marca` para que pase un cambio.

### Cómo se hace cumplir

`npm run marca` (`scripts/revisar-marca.ts`) lee `client/src` y cuenta, por archivo, los colores escritos a mano, la
tipografía anterior en vistas migradas, `toLocaleString` sueltos, textos bajo 12 px y emojis. Funciona como trinquete:
la deuda que ya existía está en `scripts/marca-linea-base.json` y no bloquea, pero ningún archivo puede empeorar. Al
migrar una vista la deuda baja, y `npm run marca -- --actualizar` guarda la línea base nueva en el mismo PR.
Lo que no se puede leer en el código (jerarquía, una acción por pantalla, voz) lo revisa la skill `revision-ui`.

## Esencia

**La red de compras de los locales.** Bando junta a los locales que le compran a los mismos proveedores: cuantos más se
suman, más baja el precio y más se comparten los envíos. Lo que nos distingue es la **integración nativa al SII**: de
las facturas de cada local salen sus insumos, sus precios reales y sus proveedores. Cuando se comunica Bando, eso va primero.

Eslogan: **Ahorra dinero encontrando al mejor proveedor.**

Somos colaborativos (un panal, no un catálogo), cercanos (el vecino del local de al lado), simples (un número grande y
una acción por pantalla) y honestos (precios claros, sin letra chica). No somos un marketplace frío, un ERP ni una app
de delivery: nada de tono corporativo ni fotos de stock.

El panal es la metáfora: cada celda es un local, la miel es el ahorro que se acumula y las abejas son la red.

## Cómo migrar (regla del refactor)

La interfaz actual (oscura, neón, Oxanium y JetBrains Mono) es la anterior. Se migra **vista por vista**:

1. La vista rediseñada se envuelve en `.bando-ui` (o `.bando-proyeccion` si se proyecta) y se arma con las primitivas. Ahí los tokens de producto (`--color-primary`, `--color-border`,
   radios, tipografía) toman los valores de Bando; fuera de `.bando-ui` siguen los anteriores, así nada se rompe a medias.
2. Los colores de marca (`--bando-*`) son globales y sirven en cualquier vista.
3. No se mezclan los dos sistemas en una misma pantalla. Una sección anterior que tiene que vivir dentro de una vista
   migrada (mientras le llega su turno) va envuelta en `.puente-legado`, que les da a sus tokens viejos los valores de la marca.
4. Cuando todas estén migradas, los tokens de `.bando-ui` pasan a `:root` y se borra la capa anterior de `estilos.css`.

Tokens en [`client/src/marca/tokens.css`](client/src/marca/tokens.css) y primitivas en `client/src/marca/componentes.css`,
los dos importados en `estilos.css`. Lo que falta migrar está en el [mapa de migración](#mapa-de-migración).

## Modo proyección

Para las pantallas que se ven en un proyector desde el fondo de una sala: `/red`, `/licitacion` y `/mapa`. Se usa
`.bando-proyeccion` en lugar de `.bando-ui`: mismos nombres de tokens, otros valores.

- **Siempre oscuro.** Un proyector lava los blancos y un fondo claro encandila la sala. Lienzo carbón profundo, texto
  crema (16,9:1) y tarjetas un tono más claro. No sigue al botón sol/luna.
- **La miel es la protagonista:** el número héroe (precio de hoy, ahorro del grupo), la barra del grupo y la acción.
  La oliva clara es el ahorro. El azul del SII va lleno, con texto blanco.
- **Escala en pantalla, no en píxeles fijos:** `--proy-heroe`, `--proy-display`, `--proy-titulo`, `--proy-cuerpo`,
  `--proy-etiqueta`, `--proy-margen` y `--proy-hueco` usan `vh` con un mínimo en px. La misma vista llena 1024x768 y
  1920x1080 sin scroll.
- **Legible a distancia:** nada bajo 18 px, peso 500 o más bajo 32 px (el trazo fino se pierde en el proyector) y
  bordes de 1 px.
- **Una idea por pantalla:** el número héroe ocupa al menos un cuarto del alto. Sin párrafos: etiqueta, número y una
  línea de contexto.
- **Movimiento visible pero corto:** los cambios en vivo usan `--duracion-celebracion` para que se noten desde lejos;
  un aviso a pantalla completa va en `--z-aviso` y se cierra solo.

## Logo

Panal + «bando» en minúscula. **Es un dibujo: siempre se usa el archivo, nunca se escribe con una tipografía ni se
redibuja.** En código, `<Logo />` de [`client/src/marca/Logo.tsx`](client/src/marca/Logo.tsx).

| Versión | Uso | En código |
|---|---|---|
| Horizontal | Sobre blanco o crema | `<Logo />` |
| Horizontal sobre oscuro | Sobre carbón o fondos oscuros | `<Logo fondo="oscuro" />` |
| Ícono (hexágono miel) | Menos de 120 px de ancho: favicon, avatar, cabeceras chicas | `<Logo variante="icono" />` |

- Mínimo: logo horizontal 120 px de ancho; ícono 16 px. Más chico que eso, el ícono.
- Resguardo: alrededor, libre el alto de una celda del panal (≈ 25% del alto del logo).
- No estirar, no cambiar colores, no rotar, sin sombras ni efectos, nunca sobre miel ni sobre fondos que compitan.

## Color

La interfaz es **mayormente blanca y neutra; la marca aparece en momentos puntuales.**
Proporción: 60% blanco, 25% neutros, 10% miel, 5% oliva. Si la pantalla se ve amarilla, sobra miel.

| Color | Token | Significa | Uso |
|---|---|---|---|
| Miel `#E2B031` | `--bando-miel` | Progreso del grupo, «faltan X», destacado | Rellenos, barras de progreso, ícono. **Nunca texto sobre blanco** (2,0:1) |
| Miel texto `#8A6A10` | `--bando-miel-texto` | | Texto miel sobre blanco o crema (5,1:1) |
| Miel 600 `#B8892A` | `--bando-miel-600` | | Bordes, barras oscuras, hover de miel |
| Oliva `#928C3E` | `--bando-oliva` | La red | Rellenos secundarios, ilustración. Como texto, solo números de 24 px o más |
| Oliva texto `#5F6B28` | `--bando-oliva-texto` | **Ahorro**: precio que bajó, «$0 envío» | Todo ahorro en texto (5,8:1) |
| Crema `#F3E9D0` | `--bando-crema` | La cera | Celdas y tarjetas cálidas |
| Fondo crema `#FCF4DC` | `--bando-fondo-crema` | | Fondo de ilustraciones, imagen para compartir |
| Carbón `#343532` | `--bando-carbon` | | Trazo de ilustración, fondo oscuro de marca |
| Tinta `#1D1D1F` | `--bando-tinta` | | Texto sobre miel (8,4:1) |

Producto (dentro de `.bando-ui`): lienzo `#FFFFFF` con borde `#EDEADE`, lateral `#F4F1E7`, bloques de apoyo `#F6F4EF`,
texto `#000000` / `#404040` / `#6E6A5E`, **botón primario negro `#171717`**. Estados: éxito `#21C45D`, aviso `#FBBD23`,
error `#EF4343`. El azul del SII (`#0061A0`) sigue marcando todo lo que queda registrado en el SII.

### Modo oscuro

La interfaz de marca (`.bando-ui`) tiene modo oscuro: carbón y crema, como el logo sobre oscuro. Por defecto sigue al
sistema; el botón sol/luna (`<BotonTema />`, en el marco y en la entrada) lo fija en el dispositivo
([`client/src/marca/tema.ts`](client/src/marca/tema.ts) pone `data-tema` en `<html>` antes de dibujar).

- Los valores viven solo en `tokens.css` (`[data-tema='oscuro'] .bando-ui`): una vista que usa los tokens ya funciona en
  los dos modos. Nada de colores escritos a mano en los estilos de una vista.
- Lienzo `#1F201D`, lateral `#161714`, bordes `#3A3B35`, texto crema `#F3EEE0`. El botón primario pasa a crema con texto
  tinta. La miel no cambia; miel texto y oliva texto se aclaran (`#E8BE52`, `#B9BE74`) para leerse sobre oscuro.
- El logo va con `<Logo />` (`fondo="tema"`): cambia solo a la versión sobre oscuro.
- Ilustraciones, abejas e íconos de flujo llevan la clase `ilustracion`: en oscuro van sobre una baldosa crema, porque su
  trazo es negro y la marca los pide sobre blanco o crema.

## Tipografía

Una sola familia: **Inter** (400, 500, 600, 700; ya cargada en `client/index.html`). Titulares grandes, en bold y
apretados; textos chicos con aire.

| Estilo | Tamaño / interlineado | Peso | Espaciado | Ejemplo |
|---|---|---|---|---|
| Display | 72 / 76 | 700 | −0,045em | Compran juntos. |
| Número héroe | 60 / 60 | 600 | −1,5px | $184.300 |
| Título | 36 / 40 | 700 | −0,03em | Te sumaste. |
| Subtítulo | 24 / 32 | 700 | −0,025em | Rollos térmicos 80 mm |
| Cuerpo | 16 / 24 · 14 / 20 | 400–500 | 0 | Faltan 13 cajas para $27.000. |
| Etiqueta | 12 / 16 | 600, MAYÚSCULAS | +0,05em | CIERRA EN |

- **Un número grande por pantalla.**
- `font-variant-numeric: tabular-nums` en contadores y precios.
- Montos en pesos, sin decimales y con separador de miles, siempre con `dinero()` de `shared/formato.ts` ($27.000).
- Nada bajo 12 px.

## Fundamentos

Viven en `:root` (globales): valen igual en claro, oscuro y proyección.

**Espaciado.** Múltiplos de 4 y nada fuera de la escala. El número del token es la cantidad de pasos de 4 px.

| Token | Valor | Uso |
|---|---|---|
| `--espacio-1` | 4 px | Entre ícono y texto |
| `--espacio-2` | 8 px | Dentro de un grupo |
| `--espacio-3` | 12 px | Entre filas de una lista |
| `--espacio-4` | 16 px | Relleno de tarjeta, borde de pantalla en el teléfono |
| `--espacio-6` | 24 px | Entre bloques de una pantalla |
| `--espacio-8` | 32 px | Entre secciones |
| `--espacio-12` | 48 px | Aire alrededor del número héroe |
| `--espacio-16` | 64 px | Márgenes de pantallas grandes |

Regla de proximidad: apretado dentro de un grupo, generoso entre grupos. Si dos bloques tienen el mismo espacio
alrededor, no se entiende qué va con qué.

**Elevación.** La interfaz es casi plana. Las tarjetas se separan con borde (`--sombra-ninguna`). Solo lo que flota
sobre el contenido lleva sombra: `--sombra-flotante` (menú, vista previa, barra de acción fija) y `--sombra-modal`.

**Movimiento.** Corto y con propósito: algo cambió en vivo. Lo que entra usa `--curva-salida` (rápido al inicio, frena
suave); lo que se va, `--curva-entrada`.

| Token | Valor | Uso |
|---|---|---|
| `--duracion-rapida` | 120 ms | Hover, foco, presionar |
| `--duracion-base` | 200 ms | Abrir, cerrar, aparecer |
| `--duracion-lenta` | 400 ms | Barras de progreso, cifras que cambian |
| `--duracion-celebracion` | 800 ms | Un cuadro del panal que se llena, un tramo alcanzado |

Con `prefers-reduced-motion` todas las duraciones pasan a 0 en `tokens.css`: una animación que usa los tokens ya lo respeta.

**Capas.** Un solo orden: `--z-contenido` (0), `--z-fijo` (10, barras y cabeceras pegadas), `--z-navegador` (50, menú
de vistas), `--z-modal` (100) y `--z-aviso` (200, avisos a pantalla completa). Nada de `z-index: 9999`.

**Quiebres.** En media queries no se pueden usar variables, así que estos son los únicos valores permitidos:
640 px (teléfono grande), 768 px (tableta), 1024 px (escritorio, aparece el lateral) y 1440 px (amplio). Se diseña
desde el teléfono hacia arriba (`min-width`).

## Primitivas

En [`client/src/marca/componentes.tsx`](client/src/marca/componentes.tsx), con sus estilos en `componentes.css`. Una
vista nueva no escribe CSS para estas piezas: si le falta algo, se agrega a la primitiva para todos.

| Primitiva | Cuándo | Reglas |
|---|---|---|
| `Boton` / `BotonEnlace` | Toda acción. `BotonEnlace` cuando lleva a otra pantalla | `primario` una vez por pantalla; `secundario` para el resto; `miel` como máximo una vez y solo en momentos de marca; `sii` (azul, con logo) para emitir o registrar en el SII; `texto` para cancelar o ver más. 44 px de alto en el teléfono, 36 en escritorio |
| `Tarjeta` | Agrupar un tema | Borde fino, radio 12, sin sombra. `calida` (fondo miel 50) para un solo destacado por pantalla |
| `Etiqueta` | El nombre corto de un número o bloque | 12 px, 600, MAYÚSCULAS con aire |
| `Cifra` | Un número con su etiqueta | `heroe` una vez por pantalla; `grande` y `normal` para el resto. `tono="ahorro"` (oliva) para lo que bajó. Recibe el valor ya formateado |
| `Estado` | En qué va algo; no se toca | `aviso` pide una acción, `info` avanza solo, `exito` terminó bien, `error` hay un problema, `sii` quedó en el SII |
| `Barra` / `ProgresoGrupo` | El avance de una compra en grupo | Barra miel; debajo el resumen y, en oliva, lo que falta para el siguiente tramo |
| `EstadoVacio` | Lista o pantalla sin datos | Una ilustración, qué pasa y qué hacer. Nunca una pantalla en blanco |
| `Modal` | Confirmar algo con efecto legal o irreversible | Se cierra con Escape, la X o tocando afuera |
| `Logo`, `BotonTema` | Cabeceras y marcos | Ver "Logo" y "Modo oscuro" |

Los modificadores llevan el nombre de su pieza (`bm-estado-error`, `bm-cifra-heroe`): la interfaz anterior tiene
clases globales con nombres comunes (`.error`, `.ahorro`) que se colarían.

## Medidas de producto

Las primitivas ya traen estas medidas; quedan aquí como referencia para diseñar.

- **Botón**: 36 px de alto, radio 12, texto 14/600. El primario es negro. El **botón miel**, como máximo uno por
  pantalla y solo en momentos de marca (sumarse, destacado).
- **Progreso del grupo**: barra miel sobre `--color-secondary`; el ahorro al lado en oliva texto.
  Ejemplo: «11 locales · 37 de 50 cajas», «Faltan 13 para $27.000».
- **Tarjeta**: fondo blanco, borde 0,8 px `#EDEADE`, radio 12, relleno 16, título 14/600. Sin sombras (salvo vistas previas flotantes).
- **Lateral** (escritorio): 224 px, fondo `#F4F1E7`; arriba el logo, luego el menú (ítems de 38 px, el activo en blanco
  y 600) y abajo la configuración y el negocio.
- **Lienzo principal**: blanco, radio 16.

## Íconos

Dos familias que **no se mezclan en una misma fila**:

- **Íconos de interfaz**: de línea, trazo 2 px, estilo Lucide; un solo set en toda la app.
- **Íconos de flujo** (ilustrados, a color, mínimo 32 px): uno por cada cosa que hace Bando. Van en índices, tarjetas de
  cada flujo, onboarding y estados vacíos. En código, `ICONO_FLUJO` de [`client/src/marca/recursos.ts`](client/src/marca/recursos.ts).

| Flujo | Clave | Dibujo |
|---|---|---|
| 1 · Entrar | `entrar` | Una abeja entra al panal |
| 2 · Comprar en grupo | `comprarEnGrupo` | Se llena la miel y baja el $ |
| 3 · Recibir y pagar | `recibirYPagar` | QR y moneda |
| 4 · Pedido por WhatsApp | `pedidoPorWhatsapp` | Chat con ✓ y caja |
| 5 · Cómo vende | `comoVende` | Escalones que bajan (tramos, stock, reparto) |
| 6 · Más paradas | `masParadas` | Camión con ruta |
| 7 · Sumar proveedores | `sumarProveedores` | Lupa, contacto y + |

Logos de terceros: el del SII en cada acción del SII; proveedores y comercios con su logo o un monograma.

## Ilustración y abejas

Dibujadas a mano con trazo negro. Le dan calidez a una herramienta de números. En código, `ILUSTRACION`, `ABEJA` y
`PANAL_SE_LLENA` de `client/src/marca/recursos.ts`.

- **Dónde**: estados vacíos, confirmaciones, onboarding, láminas y marketing. **Nunca dentro de tablas ni formularios.**
- **Una por pantalla**, sobre blanco o crema, con espacio alrededor.
- No recolorear, recortar ni deformar; no ponerlas sobre miel; no mezclarlas con fotos ni 3D.
- Son PNG raster con fondo transparente: no agrandarlas más allá de su tamaño original (las escenas miden entre 340 y
  1.140 px de ancho).

| Abeja | Cuándo |
|---|---|
| `volando` | Cargando, «buscando proveedores…» |
| `celebra` | Confirmaciones: «te sumaste», «tramo alcanzado» |
| `senala` | Llamar la atención: «faltan 13 cajas» |

**El panal se llena** (`PANAL_SE_LLENA`, 4 cuadros de vacío a lleno): la animación del ahorro mientras entran locales,
0,8 s por cuadro y el último con confeti. Respeta `prefers-reduced-motion` (sin animación, el cuadro que corresponde).

## Voz

Corto, claro y cercano, en español neutro (sin modismos de ningún país). Tratamos de tú. Una idea por frase. **Primero el número y después la explicación.**

| Sí | No |
|---|---|
| Faltan 13 cajas para $27.000. | Aún no se ha alcanzado el umbral de volumen para acceder al siguiente tramo de precio. |
| Te sumaste. Ya van 45 de 50. | Su solicitud de participación ha sido procesada exitosamente. |
| El proveedor ya recibió el pago. | La transacción fue liquidada al beneficiario. |
| Lo que no llegó no se paga. | Los ítems no recepcionados serán descontados conforme a la política vigente. |

- Palabras nuestras: sumarse, juntos, bando, tramo, ruta, envío compartido, llega mañana.
- Evitar: transacción, usuario, sinergia, plataforma, «estimado cliente».
- **Privacidad**: nunca mostrar el nombre de otro comprador. «11 locales de Providencia», no «Café Kant y otros».

## Mapa de migración

Qué vista ya usa la marca y qué falta, en el orden recomendado. «Parcial» quiere decir que el marco es nuevo pero
quedan secciones anteriores dentro de `.puente-legado`. El dueño sale de `agents/*.md`: quien migra una vista lo
coordina con su dueño en `Pedidos a otros`.

| Orden | Ruta | Archivo principal | Estado | Dueño | Qué falta |
|---|---|---|---|---|---|
| | `/marca` | `vistas/GuiaMarca.tsx` | Migrada | marca-sistema | |
| | entrada de `/app` y `/proveedor` | `canal/Acceso.tsx` | Migrada | javier-acceso | |
| | `/red` | `vistas/RedEnVivo.tsx` | Migrada a `.bando-ui` | jorge-red3d | Pasar a `.bando-proyeccion` |
| | `/mapa` | `vistas/Mapa.tsx` | Migrada a `.bando-ui` | jorge-mapa | Pasar a `.bando-proyeccion` |
| | `/red-3d` | `vistas/Red3D.tsx` | Migrada | jorge-red3d | |
| 1 | `/app` | `canal/MiNegocio.tsx` y `comprador/` | Parcial | javier-comprador | Secciones en `.puente-legado` (pedir, carrito, crédito) y `canal.css` |
| 2 | `/proveedor` | `canal/Proveedor.tsx` y `proveedor/` | Parcial | javier-proveedor-ui | `ConectarSii`, ruta de reparto, catálogo; pasar `bp-estado` y `bp-boton-sii` a `Estado` y `Boton` |
| | `/licitacion` | `vistas/Licitacion.tsx` | Parcial: `.bando-proyeccion` | ui-proyeccion | Las piezas de proyección (`tarjeta`, `numero-grande`, escalera, curva, ofertas) siguen en `estilos.css` con tokens remapeados en `licitacion.css` |
| | `/unirse` | `vistas/Unirse.tsx` | Parcial | carrito-movil | El carrito y el botón de WhatsApp (`canal/Carrito.tsx`, `piezas.tsx`) en `.puente-legado` |
| | `/pagos` | `vistas/Pagos.tsx` | Migrada | credito-pantallas | |

`/proveedores` ya no existe como vista: redirige a la sección Proveedores de `/app`.

Cuando no quede ninguna vista anterior: los tokens de `.bando-ui` pasan a `:root`, se borra la capa anterior de
`estilos.css` y `.puente-legado`, y `npm run marca` deja de aceptar deuda (línea base vacía).

## Archivos

Todo en [`client/public/marca/`](client/public/marca/), con la estructura del kit (servido en `/marca/...`):

```
manual-de-marca.html   el manual completo
01-logo/               logo, logo sobre oscuro, ícono, favicons (16 a 512 y .ico)
02-iconos-flujos/      flujo-1 … flujo-7
03-ilustraciones/      escenas y panal-0 … panal-3
04-abejas/             volando, celebra, señala
06-aplicaciones/       ícono de app 1024, perfil de WhatsApp 640, imagen para compartir 1200×630
```

Las vistas nunca escriben estas rutas a mano: las importan de `client/src/marca/recursos.ts` (también el logo del SII, `LOGO_SII`). Si hace falta un vector o
una pieza nueva, se pide al equipo de diseño; no se dibuja una propia.
