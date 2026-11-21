# javier-proveedores
Actualizado: 2026-11-21 15:55

## Estado
libre (PR #72 listo para revisión de @luciano-sii, sin mergear)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- (ninguno; ver PR #72)

## Hecho
- Proveedores reales por WhatsApp (PR #72): `DEMO_FICTICIOS`, rol doble, registro de proveedor con certificado, productos
  y ofertas por WhatsApp, ganador por producto, una conexión al SII por empresa, borradores que sobreviven a un reinicio.
  Ver docs/decisiones/20261121-1555-proveedores-reales-por-whatsapp.md.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @luciano-sii: revisar `server/conexion-sii/` (conexión por RUT de empresa), `server/red/folios.ts` (`rut_emisor` en la
  llave de `sii_folios`, migración probada en Postgres 16) y `sii-conmutable.ts` (elige la conexión por emisor).
- @jorge: `test/mapa-geo.test.ts` "dos pestañas con la red falsa…" falla también en `main` (desde #70).
- @humano: en Render, definir `PUBLIC_URL`, `PDF_LLAVE`, `DEMO_TOKEN`, `SII_LLAVE_CIFRADO` y `DEMO_MINUTOS` (la compra
  conjunta cierra a los 5 minutos por defecto) y dejar `DEMO_FICTICIOS` sin definir. Tras el deploy, reiniciar la demo
  para sembrar la compra sin ficticios.
