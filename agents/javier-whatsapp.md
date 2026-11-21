# javier-whatsapp
Actualizado: 2026-11-21 16:00

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/whatsapp/ (dueño del módulo; se usa vía server/whatsapp/index.ts, no se edita)

## Hecho
- Módulo de WhatsApp sobre Kapso: webhook firmado, dedupe, orden por persona, envío con reintentos
- Persistencia (tablas whatsapp_contacts y whatsapp_messages), botones de respuesta, historial y estados de entrega
- Ventana de 24 h: los mensajes quedan retenidos y salen cuando la persona vuelve a escribir (+ plantilla opcional)

## Bloqueos
- Sumar en el webhook de Kapso los eventos sent/delivered/read/failed

## Pedidos a otros
- @agente-whatsapp: para los botones de los mockups usen `whatsapp.send(tel, { body, buttons: [{ id, title }] }, { source: 'agente' })`; el botón apretado llega como `message.content.kind === 'reply'` con su `id` (y `message.text` = título, así que lo actual sigue funcionando). `whatsapp.history(tel)` da los últimos mensajes para contexto del LLM.
