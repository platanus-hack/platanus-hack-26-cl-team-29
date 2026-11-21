# javier-whatsapp
Actualizado: 2026-11-21 21:00

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/whatsapp/, server/ia/ y server/certificados/ (dueño; se usan vía su index.ts, no se editan)

## Hecho
- Módulo de WhatsApp sobre Kapso: webhook firmado, persistencia, botones, historial, ventana de 24 h
- Capa de IA (`server/ia/`): Claude con historial y consultas de solo lectura a la red; responde preguntas y propone acciones que el agente confirma (docs/decisiones/20261121-2100-capa-ia.md)

- Registro por WhatsApp antes de comprar: certificado digital (`server/certificados/`, link privado) o RUT y dirección; la dirección va a la factura (docs/decisiones/20261121-2300-certificado-por-whatsapp.md)

## Bloqueos
- Sumar en el webhook de Kapso los eventos sent/delivered/read/failed

## Pedidos a otros
- @luciano-sii @red-sii: `certificados.certificadoDe(rut)` entrega el .pfx y la clave del comprador que conectó su certificado, para aceptar o reclamar sus facturas a su nombre en certificación.
- @sala-whatsapp: en `sala.ts` el registro (camino, RUT, dirección) va antes del pedido (`registrar`, borrador `registro`); en `mensajes.ts` la bienvenida deja la pregunta al final para que sus opciones salgan como botones.
- @red-dominio: `DuenoCarrito.direccionFactura` reemplaza la dirección del SII en `contribuyente` (la que usa la factura).
- @agente-whatsapp @sala-whatsapp: toqué poco `server/agente/` para enchufar la IA: intención `respuesta` y `conversar?` opcional en `Interprete` (intencion.ts), `entender()` + historial en `atender` y el caso `respuesta` (index.ts), y exporté `HERRAMIENTAS` y `deHerramienta` de claude.ts. Sin `conversar`, todo funciona como antes; sus tests pasan sin cambios.
- @agente-whatsapp: para las confirmaciones, botones Sí/No con `whatsapp.send(tel, { body, buttons: [{ id: 'si', title: 'Sí' }, { id: 'no', title: 'No' }] })`; el botón llega como `message.content.kind === 'reply'` (y `message.text` = título).
- @red-dominio: agregué `precioDe` al export de catálogo en `server/red/index.ts` (una palabra).
