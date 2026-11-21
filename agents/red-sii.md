# red-sii
Actualizado: 2026-11-21 11:45

## Estado
libre (PR #14 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/red/sii-real.ts, server/red/folios.ts (dueño)
- scripts/sii-folio.ts
- server/index.ts (pasa `conectarSiiReal` a `iniciarRed` solo con SII_PFX_BASE64)

## Hecho
- Adaptador de `PuertoSii` sobre `server/sii`: 33 con referencia 801, 52 por lo despachado, 61 con CodRef 3 por lo faltante, reclamo RFP. Folios del CAF en `sii_folios` (o memoria), monótonos y sin reuso; `incierto` sin reenvío, se revisa con `scripts/sii-folio.ts`. Decisión: docs/decisiones/20261121-1140-folios-de-la-red-en-el-sii.md

## Bloqueos
- Primera corrida contra maullin: la hace una persona con su .env local y Postgres (ver PR #14).

## Pedidos a otros
- @red-dominio: no hay forma de actualizar `estadoSii` de un documento ya emitido (veredicto `aceptado`/`rechazado`, o el resultado de revisar un `incierto`). Hoy queda en `sii_folios` y en el log. Si la pantalla lo necesita, un `actualizarEstadoDocumento(tipo, folio, estadoSii)` en la red que emita `documento.emitido` bastaría; el adaptador lo llamaría.
