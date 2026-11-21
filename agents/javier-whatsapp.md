# javier-whatsapp
Actualizado: 2026-11-21

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/whatsapp/ (dueño del módulo; se usa vía server/whatsapp/index.ts, no se edita)

## Hecho
- Módulo de WhatsApp sobre Kapso: webhook firmado, dedupe, orden por conversación, envío con reintentos

## Bloqueos
- Cargar KAPSO_API_KEY, KAPSO_PHONE_NUMBER_ID y KAPSO_WEBHOOK_SECRET en Render

## Pedidos a otros
- A todos: para reaccionar a mensajes de WhatsApp usen `whatsapp.onMessage(...)` desde server/index.ts
