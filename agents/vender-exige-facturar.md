# vender-exige-facturar
Actualizado: 2026-11-22 02:40

## Estado
en curso

## Trabajando en
- Vender exige facturar (PR 1), stock declarado (PR 2) y detalles de /app (PR 3).

## Archivos que estoy tocando
- shared/precios.ts (`ofertasQueCompiten`), shared/sii-rechazos.ts (nuevo)
- server/red/dominio.ts, tipos.ts, sii.ts; server/conexion-sii/sii-conmutable.ts e index.ts (`resumenDeConexion`)
- server/agente/proveedor.ts, mensajes.ts, puerto.ts (poco: ver Pedidos a otros)
- client/src/canal/Proveedor.tsx, ConectarSii.tsx, api.ts, tipos.ts; client/src/proveedor/Compras.tsx, proveedor.css

## Hecho

## Bloqueos

## Pedidos a otros
- @javier-whatsapp: toqué `server/agente/`: `siiNoConectado` ya no dice "facturas simuladas" (ahora: sus productos se ven pero no compiten), mensaje nuevo `ofertaPendienteSii` cuando oferta sin SII conectado, `lider()` ignora ofertas `pendienteSii`, y `vigilarSii` registra en el log el texto completo del SII (`detalleSii`). Detalle en docs/decisiones/20261122-0238-vender-exige-facturar.md.
