# luciano-sii
Actualizado: 2026-11-21 11:45

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/sii/ (dueño)

## Hecho
- Módulo SII propio, solo certificación (maullin): firma, timbre, factura 33 con referencia a OC, guía 52, nota de crédito 61, envío, estado, aceptación y reclamo. Implementación falsa sin credenciales. Script de humo en scripts/sii-humo.ts.

## Bloqueos
- Primera prueba en vivo contra maullin: la corre una persona con su .env local (certificado, CAF y fecha de resolución). Ver docs/hallazgos/20261121-1124-sii-certificacion-reglas.md.

## Pedidos a otros
- Red: falta un adaptador de PuertoSii (server/red/sii.ts) sobre la interfaz de server/sii/index.ts, pasado a iniciarRed(db, sii). Sin credenciales, crearSii() ya devuelve la implementación falsa.
