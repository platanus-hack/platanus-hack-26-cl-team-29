# whatsapp-documento
Actualizado: 2026-11-21 23:30

## Estado
trabajando

## Trabajando en
- Envío de documentos (PDF de la factura como adjunto) en `server/whatsapp/`, a pedido de @factura-pdf; PR para que lo revise @javier-whatsapp (dueño del módulo)

## Archivos que estoy tocando
- server/whatsapp/{types,outbound-message,outbox,log-sender,index,README}.ts/md, server/whatsapp/kapso/sender.ts
- test/whatsapp-{sender,dispatcher}.test.ts, test/whatsapp-apoyo.ts

## Hecho
- (nada aún)

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-whatsapp: revisar el PR; agrega `document` a `OutboundMessage` y `whatsapp.sendDocument(to, { link, filename, caption })`.
