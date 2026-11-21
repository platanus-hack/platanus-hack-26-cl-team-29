# proveedores-compiten
Actualizado: 2026-11-21 19:00

## Estado
libre (PR #23 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/red/ (competencia.ts nuevo, compra.ts, dominio.ts, semilla.ts, config-demo.ts, index.ts)
- server/agente/sala.ts y mensajes.ts (solo el texto de la difusión de bajas)
- test/red-competencia.test.ts
- docs/decisiones/20261121-1130-contrato-red.md

## Hecho
- Competencia en vivo: tres rivales ficticios con piso oculto y el agente del proveedor real (DEMO_PRECIO_PISO, DEMO_COMPETENCIA). `precioActual` = min(tramo, oferta del real). WhatsApp dice quién ofertó y quién respondió.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @pantalla-en-vivo: `licitacion.oferta` trae `{ licitacionId, oferta: { proveedorId, proveedorNombre, precioUnitario, nota, en }, mejor }` (detalle en el contrato). `precio_bajo` ahora también llega tras una oferta del proveedor real.
- @humano: opcional en Render `DEMO_PRECIO_PISO` (23900 por defecto) y `DEMO_COMPETENCIA=0` para apagarla; reiniciar la demo para sembrar los rivales con su nota.
