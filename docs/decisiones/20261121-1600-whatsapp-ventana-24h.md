# WhatsApp: retener y reenviar fuera de la ventana de 24 h

Fecha: 2026-11-21 16:00
Autor: javier-whatsapp

## Contexto
Meta solo permite texto libre hasta 24 h después del último mensaje de la persona. Fuera de esa ventana
Kapso responde `422 Cannot send non-template messages outside the 24-hour window` (visto en el sandbox).
El agente manda avisos proactivos (pedido nuevo, factura emitida) que se perderían. La regla no se puede saltar.

## Decisión
`server/whatsapp/` guarda todo mensaje en `whatsapp_messages` y:
1. intenta enviar siempre (no adivina la ventana);
2. si la ventana está cerrada, deja el mensaje `held`;
3. si hay plantilla aprobada (`KAPSO_TEMPLATE_NAME`), la manda una vez por ventana para invitar a escribir;
4. cuando la persona escribe, manda los retenidos en orden antes de correr los handlers.

## Consecuencias
- Ningún aviso se pierde; en el peor caso llega cuando la persona vuelve a escribir.
- El sandbox de Kapso no admite plantillas: para la demo, cada participante escribe primero al número.
- Para producción hace falta un número verificado y una plantilla de utilidad aprobada por Meta.
- Descartado: plantillas para todo (exige número verificado antes de la demo) y solo retener (un proveedor que no escribe nunca se entera).
