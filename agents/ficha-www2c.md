# ficha-www2c
Actualizado: 2026-11-21 14:15

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/sii-portal/ (modo XHR de la sesión, lectura de la ficha en www2c)
- server/conexion-sii/portal.ts
- scripts/sii-portal-lectura.ts
- test/sii-portal*.ts
- docs/hallazgos/

## Hecho
- Resolución de certificación desde la app nueva del SII (`www2c.sii.cl`, `obtenerEmpresa`) con la misma sesión del certificado; fuente automática de "Conectar mi SII" antes del ingreso manual. Medido en vivo con un login: sin verificación en dos pasos. Hallazgo: docs/hallazgos/20261121-1413-sii-www2c-ficha-certificacion.md

## Bloqueos
- (ninguno)

## Pedidos a otros
- (ninguno)
