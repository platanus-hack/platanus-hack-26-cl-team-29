# javier-proveedores
Actualizado: 2026-11-21 15:30

## Estado
trabajando

## Trabajando en
- Proveedores reales por WhatsApp: registro con certificado, crear productos, ofertar, ganador por producto, facturar con su propio SII. Ficticios detrás de `DEMO_FICTICIOS` (apagado por defecto). Implementa `docs/decisiones/20261121-1529-pedido-dividido-entre-proveedores.md` (puntos 1, 2, 3 y 5).

## Archivos que estoy tocando
- server/red/ (dominio, semilla, config-demo, competencia, folios, sii)
- server/conexion-sii/ (una conexión por RUT de empresa)
- server/agente/, server/ia/
- shared/red.ts, shared/precios.ts
- client/src/red/derivar.ts, client/src/vistas/Sala.tsx, client/src/canal/Proveedor.tsx

## Hecho
- (en curso)

## Bloqueos
- (ninguno)

## Pedidos a otros
- @luciano-sii: revisar los cambios del SII por proveedor (conexión por RUT, `sii_folios` con `rut_emisor`).
