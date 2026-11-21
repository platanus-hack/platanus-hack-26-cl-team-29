# DESIGN.md

Cómo se ve y cómo habla Bando. Es la base del rediseño del frontend: toda vista nueva o que se rehace sigue esto. Para
agentes y personas por igual. El manual completo, con ejemplos visuales, está en
[`client/public/marca/manual-de-marca.html`](client/public/marca/manual-de-marca.html) (en la app: `/marca/manual-de-marca.html`).

La revisión de cada pantalla (tamaños, encimados, fricción) sigue en la skill `revision-ui`; este archivo dice *qué*
tiene que verse, esa skill revisa *que se vea bien*.

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

1. La vista rediseñada se envuelve en `.bando-ui`. Ahí los tokens de producto (`--color-primary`, `--color-border`,
   radios, tipografía) toman los valores de Bando; fuera de `.bando-ui` siguen los anteriores, así nada se rompe a medias.
2. Los colores de marca (`--bando-*`) son globales y sirven en cualquier vista.
3. No se mezclan los dos sistemas en una misma pantalla. Una sección anterior que tiene que vivir dentro de una vista
   migrada (mientras le llega su turno) va envuelta en `.puente-legado`, que les da a sus tokens viejos los valores de la marca.
4. Cuando todas estén migradas, los tokens de `.bando-ui` pasan a `:root` y se borra la capa anterior de `estilos.css`.

Tokens: [`client/src/marca/tokens.css`](client/src/marca/tokens.css) (ya importado en `estilos.css`).

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

## Componentes de producto

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

Corto, claro y en chileno amable. Tratamos de tú. Una idea por frase. **Primero el número y después la explicación.**

| Sí | No |
|---|---|
| Faltan 13 cajas para $27.000. | Aún no se ha alcanzado el umbral de volumen para acceder al siguiente tramo de precio. |
| Te sumaste. Ya van 45 de 50. | Su solicitud de participación ha sido procesada exitosamente. |
| El proveedor ya tiene la plata. | La transacción fue liquidada al beneficiario. |
| Lo que no llegó no se paga. | Los ítems no recepcionados serán descontados conforme a la política vigente. |

- Palabras nuestras: sumarse, juntos, bando, tramo, ruta, envío compartido, llega mañana.
- Evitar: transacción, usuario, sinergia, plataforma, «estimado cliente».
- **Privacidad**: nunca mostrar el nombre de otro comprador. «11 locales de Providencia», no «Café Kant y otros».

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

Las vistas nunca escriben estas rutas a mano: las importan de `client/src/marca/recursos.ts`. Si hace falta un vector o
una pieza nueva, se pide al equipo de diseño; no se dibuja una propia.
