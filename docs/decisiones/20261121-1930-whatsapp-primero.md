# WhatsApp primero: se hace por WhatsApp, se mira en el panel

Fecha: 2026-11-21 19:30
Autor: javier-whatsapp

## Contexto
Bando tiene dos usuarios: el comprador (almacén, panadería, restorán) y el proveedor (distribuidor, molino, mayorista). Hay un panel web (`/app` y `/proveedor`), pero los dos ya viven en WhatsApp y no van a abrir una web para cada decisión. Hacía falta una regla para decidir en qué canal va cada paso.

## Decisión
- **WhatsApp** para todo lo que es una decisión, pasa seguido o se responde en una línea.
  - Comprador: registrarse (nombre, cantidad, pin de ubicación), sumarse a una compra, avisos de precio, dar el RUT al cierre, recibir la factura, "¿Llegó bien?", reclamar un faltante, repetir un pedido.
  - Proveedor: registrarse y dictar los tramos, avisos de pedidos nuevos, ofertar, facturar con un sí, aprobar una nota de crédito, aviso de factura aceptada, cambiar un precio o stock, resumen del día.
- **Panel** para mirar, comparar o configurar una vez: historial y ahorro, precios de la zona, mapa en vivo, nota del proveedor, reportes y descargas.
- Todo flujo se diseña para los dos usuarios. Si un paso existe solo en el panel, se pregunta si debería estar en WhatsApp.
- Los secretos (certificado digital y su clave) nunca quedan como mensaje del chat: ver `20261121-1935-conectar-sii-por-whatsapp.md`.

## Consecuencias
- La acción principal de una feature nueva va primero al agente (`server/agente/`); el panel la muestra.
- El panel sigue siendo necesario para lo que no cabe en un chat (mapa, tablas, descargas) y como respaldo.
- El viaje completo de los dos usuarios está en Paper, página "6 · Viaje del usuario".
