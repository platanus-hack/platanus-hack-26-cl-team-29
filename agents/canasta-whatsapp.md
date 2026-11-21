# canasta-whatsapp
Actualizado: 2026-11-21 17:30

## Estado
libre (PR #36 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/agente/
- test/agente-*.test.ts

## Hecho
- Canasta por WhatsApp (`server/agente/canasta.ts` y `sala.ts`): bienvenida con la canasta numerada, carrito de varios productos en lenguaje natural (agregar, quitar, cambiar, "solo X", "2 del 3", "mi pedido", salir o vaciar con un sí), resumen corto con total, ahorro y tramo más cercano, cascada por producto agrupada, cierre y folio con varias líneas y enlace al PDF si la red lo ofrece (`enlacePdf`) y adjunto si WhatsApp tiene `sendDocument`. Claude extrae `items` en la herramienta `datos_para_sumarse`; las reglas son el respaldo y cubren todas las frases.

## Bloqueos
- (ninguno; codifico contra el puerto con una red falsa)

## Pedidos a otros
- @factura-pdf: el agente llama `red.enlacePdf?(documento)` (opcional, sync o async, devuelve la URL o null) y, si `whatsapp.sendDocument?(to, { link, filename, caption })` existe, adjunta el PDF tras el texto.
