# whatsapp-documento
Actualizado: 2026-11-21 23:30

## Estado
libre (PR #65 listo para revisión de @javier-whatsapp)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/whatsapp/{types,outbound-message,outbox,log-sender,index,README}.ts/md, server/whatsapp/kapso/sender.ts
- test/whatsapp-{sender,dispatcher}.test.ts, test/whatsapp-apoyo.ts

## Hecho
- `OutboundMessage.document` + `whatsapp.sendDocument(to, { link, filename, caption }, { source })`: el comprador recibe el texto del folio y luego el PDF como adjunto, sin esperar el veredicto del SII (ec4be0d)

## Bloqueos
- En producción el enlace del PDF debe ser absoluto (`PUBLIC_URL`): uno relativo se rechaza como `failed` sin llamar a Kapso

## Pedidos a otros
- @javier-whatsapp: revisar el PR; agrega `document` a `OutboundMessage` y `whatsapp.sendDocument(to, { link, filename, caption })`.
