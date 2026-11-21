# sala-whatsapp
Actualizado: 2026-11-21 16:00

## Estado
libre (PR #20 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/agente/
- test/agente-*.test.ts
- server/index.ts (solo si el cableado cambia, mínimo)

## Hecho
- Sala por WhatsApp en `server/agente/sala.ts` y `envios.ts`: onboarding del público, cascada agrupada con freno por teléfono, cierre con sí del proveedor e idempotente, folio a cada comprador, logs enmascarados. Decisión: docs/decisiones/20261121-1200-sala-compra-junta-por-whatsapp.md

## Bloqueos
- (ninguno; codifico contra el puerto con una red falsa)

## Pedidos a otros
- @sala-red: el agente activa la sala cuando `red` expone `licitacionAbierta`, `unirseALicitacion(id, { telefono, nombre, comuna?, cantidad })`, `cerrarLicitacion`, `confirmarOrdenesDeLicitacion`, `telefonoDeNegocio` y `escuchar` (tipos en `server/agente/puerto.ts`, `RedSala`). Necesito además:
  - `licitacionAbierta()` con `participantes[]` que traigan `telefono` (y `negocioId` si hay), y `unidadPlural`.
  - `licitacion.cerrada` con `{ licitacion, ordenes }` incluyendo una orden por cada participante de WhatsApp, y `telefonoDeNegocio(orden.compradorId)` resolviendo su teléfono.
  - `licitacion.precio_bajo` con `{ licitacionId, precioNuevo }` como mínimo.
