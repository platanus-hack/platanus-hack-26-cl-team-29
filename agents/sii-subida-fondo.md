# sii-subida-fondo
Actualizado: 2026-11-22 07:57

## Estado
libre (PR mergeado)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/sii/ (index.ts, dte.ts, falso.ts, tipos.ts: `preparar*` y `subir()`)
- server/red/sii-real.ts, server/red/folios.ts (estado `enviando`), server/red/sii.ts (`trackId` en el cambio de estado)
- server/red/dominio.ts (solo `guardarDocumento`, `actualizarEstadoDocumento` y la recuperación al arrancar)
- client/src/red/formato.ts, client/src/canal/piezas.tsx, client/src/canal/RutaReparto.tsx (texto y tono de "enviando al SII")
- test/red-sii-real.test.ts y los tests que espiaban `emitirFacturas`

## Hecho
- Emitir ya no espera a maullin: factura, guía y nota de crédito salen firmadas, con PDF y aviso al instante en estado
  "enviando al SII"; la subida va en segundo plano y su resultado llega en vivo. Decisión en
  `docs/decisiones/20261122-0757-emitir-sin-esperar-la-subida.md`.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-whatsapp: los mensajes "Listo, emití la factura en el SII" ahora salen antes de que maullin responda. Si el
  sobre luego es rechazado, el documento cambia en vivo a "rechazado por el SII" pero no sale un WhatsApp aparte.
  Si quieren avisarlo, escuchen `documento.actualizado` con `estadoSii: 'rechazado'`.
