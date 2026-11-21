# Detalle de cada evento en el feed "Pasando ahora"

Fecha: 2026-11-21 16:46
Autor: agente feed-detalle

## Contexto
El feed de /red y /mapa mostraba una sola frase por evento ("Almacén Uno pidió 4 cajas a Papelera Austral"). En la pantalla proyectada no se veían los datos que hacen creíble la red: productos y total, folio y estado del SII, cuánto bajó un precio o cómo cambió la nota.

## Decisión
- `detalleEvento(e, estado, eventos)` en `client/src/red/derivar.ts` (pura, testeada en `test/feed-detalle.test.ts`) devuelve `{ resumen, filas, pdfUrl? }`. Comparte con `describirEvento` la lectura del evento (`contextoEvento`), así los nombres que aparecen son los mismos que hoy.
- `resumen` es la segunda línea, siempre visible, en una sola línea con "…" si no cabe. `filas` es el detalle completo (ítems con precio y subtotal, documento, estado del SII con su logo, etc.).
- El documento muestra su estado más reciente de la foto (`estado.documentos`), no el del momento del evento. El efecto en la nota de un reclamo o una nota de crédito sale del `nota.cambiada` del mismo proveedor que llega justo después; la oferta anterior, del `licitacion.oferta` previo del mismo proveedor y producto.
- Clic, Enter o Espacio en una fila abre un panel sobre las filas de abajo (posición absoluta dentro de la tarjeta), así el alto de la lista no cambia y `useFilasQueCaben` sigue contando filas enteras; se vuelve a medir con cada evento nuevo. Escape o el botón cierra.
- El enlace al PDF solo aparece si el evento trae `documento.pdfUrl`. El enlace es privado (`server/red/pdf-enlace.ts`): el estado público y los eventos públicos no lo traen, así que en las pantallas proyectadas no aparece.

## Consecuencias
Un tipo de evento nuevo agrega su caso en `detalleEvento` junto al de `describirEvento`; si no lo hace, la fila queda con su frase y sin panel.
