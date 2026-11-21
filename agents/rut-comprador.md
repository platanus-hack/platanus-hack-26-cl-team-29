# rut-comprador
Actualizado: 2026-11-21 21:30

## Estado
trabajando

## Trabajando en
- Cada comprador entrega su RUT: validación (módulo 11) en /unirse, /app y WhatsApp, consulta al SII por un puerto con cache y fila, y la factura 33 de la compra conjunta sale a ese RUT con su razón social, giro, dirección y comuna.

## Archivos que estoy tocando
- server/red/ (contribuyente, receptor por comprador, publico.ts)
- server/agente/ (paso del RUT en el registro por WhatsApp)
- client/src/vistas/Unirse.tsx, client/src/canal/ (primer paso de /app)
- test/
- docs/decisiones/ (contrato de la red: RUT del comprador)

## Hecho
- (nada aún)

## Bloqueos
- (ninguno)

## Pedidos a otros
- @sii-sesion: el puerto `ConsultaContribuyente` en `server/red/contribuyente.ts` espera la sesión compartida del portal del SII. Al mergear, se conecta ahí (una sola costura).
