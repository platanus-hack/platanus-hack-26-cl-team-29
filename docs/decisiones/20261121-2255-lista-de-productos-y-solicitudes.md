# La compra en grupo la inicia el comprador; el proveedor publica su lista de precios

Fecha: 2026-11-21 22:55
Autor: javier-proveedor-ui

## Contexto
La compra en grupo solo se abría al reiniciar la demo. #104 dejó que el proveedor la abriera con su producto como
proveedor único, pero eso es una oferta del proveedor, no una compra en grupo: se salta la competencia entre
proveedores y no la impulsa la demanda de los compradores.

## Decisión
Son dos cosas distintas:

1. **Lista de productos del proveedor.** Cada producto tiene nombre, unidad de venta, precio base por unidad y sus
   tramos por cantidad, que escribe el proveedor (con una sugerencia de 5, 10 y 15 % menos a un toque). Vive en
   `server/catalogo` junto a las sugerencias que salen de sus facturas, que puede copiar a su lista y editar. Se arma en
   el panel (Productos, con un + arriba) o por WhatsApp ("vendo café 1 kg a $12.000 la bolsa").
2. **Solicitud de compra en grupo del comprador.** Un comprador la inicia desde la web (+ en Compras en
   grupo) o por WhatsApp ("quiero comprar 10 kilos de café"), otros se suman y pueden estar varias abiertas a la vez.
   Cada proveedor con ese producto en su lista compite solo con sus tramos y puede mejorarlos para esa solicitud. Antes
   de la primera oferta se muestra un precio de referencia (las listas publicadas o Mercado Público). Al cerrar gana
   automáticamente el mejor precio para el volumen del grupo; si empatan, la mejor nota.

## Consecuencias
- Se deshace la parte de #104 en que el proveedor abría compras (`abrirCompra`, `POST /proveedor/compras`,
  `POST /proveedor/licitacion/:id/productos`, `licitacion.abierta`). La portada común de /app y /proveedor se queda.
- Rutas nuevas en `/api/red/proveedor/catalogo`: `POST /productos` y `PUT /productos/:clave` (`{ nombre, unidad,
  tramos }`; el primer tramo, desde 1, es el precio base) y `DELETE /productos/:clave`. Solo se editan o quitan los de
  su lista; las sugerencias de sus facturas no.
- El agente recibe la lista (`productos` en `conectarAgente`): "vendo ..." sin compra abierta propone agregarlo a ella.
- Solicitudes (PR 2): `abrirSolicitud` y `cerrarVencidas` en el dominio, `POST /yo/solicitudes`, + y pestañas Abiertas y
  Cerradas en /app, y por WhatsApp "quiero comprar N de X" sin precio fijo ofrece abrirla. Falta que los proveedores
  compitan solos con su lista (PR 3): hoy una solicitud sin ofertas cierra sin proveedor.
- Competencia (PR 3): las ofertas pueden traer tramos y valen lo que cobra su tramo para el volumen del grupo
  (`precioDeOferta`). `server/catalogo/ofertas.ts` hace entrar sola la lista de cada proveedor en las compras sin
  proveedor fijo que piden el **mismo producto**: mismo nombre (sin tildes, mayúsculas, espacios ni signos) y misma
  unidad. Una oferta a mano no la pisa la automática. El proveedor ve dónde compite y mejora su oferta en "Compras en
  grupo" de su panel.
- Las unidades son un listado fijo (`shared/unidades.ts`) y hay una biblioteca de productos de la plataforma
  (`server/catalogo/biblioteca.ts`, `GET /api/red/productos?q=`): la web sugiere un nombre existente con su unidad
  al escribir y el bot pregunta "¿cuál es?" si lo escrito se parece a productos que ya existen ("cocacola" →
  "Coca-Cola 3 lts", "Coca-Cola lata 330 ml" u otro nuevo). Un índice con códigos UNSPSC y clasificación con IA
  queda para después.
- El comprador elige el producto de su compra en grupo de la biblioteca con un selector con buscador (no lo escribe):
  así su compra calza con las listas de los proveedores. El proveedor sí escribe productos nuevos en su lista.
- Solo para la demo, `DEMO_COMPRA_A_SI_MISMO=1` deja que un proveedor gane las compras en grupo en que él mismo compra
  y que se pida a sí mismo por WhatsApp, para probar todo con un solo teléfono. Apagarlo antes de un uso real.
