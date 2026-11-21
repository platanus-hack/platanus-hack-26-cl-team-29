# Agente de WhatsApp: Claude interpreta, el código ejecuta solo tras un sí

Fecha: 2026-11-21 15:00
Autor: agente-whatsapp

## Contexto
El agente de WhatsApp dispara acciones con efecto legal en el SII (factura, reclamo, nota de crédito). Un modelo de lenguaje no puede ser quien decide ejecutarlas.

## Decisión
- Claude (`claude-opus-5-5` por defecto, `ANTHROPIC_MODEL` para cambiarlo) solo **clasifica** el mensaje con herramientas que son propuestas (`proponer_pedido`, `confirmar`, `rechazar`, `recepcion_conforme`, `reportar_faltante`, `ver_pedidos`). No tiene herramientas que ejecuten nada.
- `server/agente/` guarda una cola de acciones pendientes por negocio. La acción se ejecuta en el dominio solo cuando la persona responde que sí, y se saca de la cola **antes** de ejecutarla: un segundo "sí" no la repite.
- Sin `ANTHROPIC_API_KEY`, o si Claude falla o rechaza, se usa un intérprete de reglas que cubre las frases de la demo.
- Cuando una acción afecta a la contraparte (reclamo, nota de crédito, pedido nuevo, factura) el agente le escribe a esa persona; si ya tiene una pregunta abierta, la nueva espera su turno.
- El módulo de WhatsApp no tiene botones interactivos: las opciones van numeradas ("1. Sí, emítela").

## Consecuencias
- El agente depende de un puerto (`server/agente/puerto.ts`) que refleja las funciones del contrato de la red; el dominio real lo implementa sin que el agente cambie.
- Plazo de reclamo mostrado al comprador: 8 días contados desde que el agente le avisó la factura.
