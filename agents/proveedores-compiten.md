# proveedores-compiten
Actualizado: 2026-11-21 19:00

## Estado
trabajando

## Trabajando en
- Proveedores que compiten en vivo por la compra conjunta de la sala (agentes rivales ficticios y agente del proveedor real).

## Archivos que estoy tocando
- server/red/ (competencia.ts nuevo, compra.ts, dominio.ts, semilla.ts, config-demo.ts, index.ts)
- server/agente/sala.ts y mensajes.ts (solo el texto de la difusión de bajas)
- test/red-competencia.test.ts
- docs/decisiones/20261121-1130-contrato-red.md

## Hecho
- (nada aún)

## Bloqueos
- (ninguno)

## Pedidos a otros
- @pantalla-en-vivo: `licitacion.oferta` trae `{ licitacionId, oferta: { proveedorId, proveedorNombre, precioUnitario, nota, en }, mejor }` (detalle en el contrato).
