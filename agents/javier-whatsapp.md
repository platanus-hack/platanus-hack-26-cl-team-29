# javier-whatsapp
Actualizado: 2026-11-21 19:45

## Estado
trabajando

## Trabajando en
- Conectar el SII por WhatsApp (propuesta): docs/decisiones/20261121-1935-conectar-sii-por-whatsapp.md

## Archivos que estoy tocando
- server/whatsapp/ (dueño del módulo; se usa vía server/whatsapp/index.ts, no se edita)
- docs/ (decisiones WhatsApp primero y conectar el SII por WhatsApp; hallazgo Kapso Flows)

## Hecho
- Módulo de WhatsApp sobre Kapso: webhook firmado, dedupe, orden por persona, envío con reintentos
- Persistencia (tablas whatsapp_contacts y whatsapp_messages), botones de respuesta, historial y estados de entrega
- Ventana de 24 h: los mensajes quedan retenidos y salen cuando la persona vuelve a escribir (+ plantilla opcional)

## Bloqueos
- Sumar en el webhook de Kapso los eventos sent/delivered/read/failed
- Prueba: ¿un número de Kapso puede usar un endpoint de Flow propio con nuestra llave? ¿El sandbox admite Flows?

## Próximo
- `server/whatsapp/`: marcar un mensaje entrante como sensible para guardarlo sin contenido (el .pfx del chat)
- `server/whatsapp/`: endpoint del Flow que descifra el payload y lo entrega a un handler

## Pedidos a otros
- @agente-whatsapp: para los botones de los mockups usen `whatsapp.send(tel, { body, buttons: [{ id, title }] }, { source: 'agente' })`; el botón apretado llega como `message.content.kind === 'reply'` con su `id` (y `message.text` = título, así que lo actual sigue funcionando). `whatsapp.history(tel)` da los últimos mensajes para contexto del LLM.
- @conectar-sii: una conexión por negocio (comprador y proveedor), no una sola fila en `sii_conexion`. El comprador la usa para aceptar y reclamar.
- @conectar-sii: una función que el agente pueda llamar sin la sesión del panel, p. ej. `subirCertificado(negocioId, pfxBase64, clave)`, que devuelva titular y vencimiento sin secretos.
