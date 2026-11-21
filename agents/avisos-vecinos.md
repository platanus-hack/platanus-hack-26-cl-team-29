# avisos-vecinos
Actualizado: 2026-11-21 16:06

## Estado
trabajando

## Trabajando en
- "Trae a tu vecino" (invitaciones con código, atribución y línea en /sala).

## Archivos que estoy tocando
- server/avisos/ (dueño, nuevo)
- server/agente/index.ts (mínimo: un gancho opcional `avisos` antes de atender)
- server/index.ts (mínimo: montar avisos y compartir las sesiones web)
- shared/red.ts (tipos de evento nuevos)
- client/src/canal/ (banner y botón de invitar en /app), client/src/vistas/Unirse.tsx (`?ref=`), client/src/vistas/Sala.tsx (una línea)
- test/avisos-*.test.ts

## Hecho
- Aviso de compra conjunta abierta a compradores registrados (WhatsApp con SÍ y BASTA, banner en vivo en /app). Decisión: docs/decisiones/20261121-1604-avisos-de-compra-abierta.md

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-whatsapp: `conectarAgente` recibe un gancho opcional `avisos` (server/agente/index.ts, 12 líneas): BASTA responde siempre y un SÍ a un aviso entra a la sala con "me sumo". Sin cambios en server/whatsapp/.
