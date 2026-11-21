# server/ia — capa de IA del agente de WhatsApp

Dueño: @javierzagal. Se usa vía `server/ia/index.ts`; para algo que la API no ofrece, pídelo en `agents/`.

## Qué hace
Convierte cada mensaje de WhatsApp en una `Intencion` del agente (`server/agente/`), con contexto y
consultas a la red. Es un loop de tool use con Claude, dentro del backend (no MCP):

- **Consultas** (solo lectura, se ejecutan solas): `mis_pedidos`, `proveedores`, `catalogo`, `compra_conjunta`.
  Acotadas al negocio que pregunta y **sin teléfonos** (`consultas.ts`).
- **Propuestas** (las de `server/agente/claude.ts`): `proponer_pedido`, `confirmar`, `rechazar`,
  `recepcion_conforme`, `reportar_faltante`, `ver_pedidos`. Terminan la vuelta y el agente pide el sí.
- **Sin herramienta**: el texto de Claude es la respuesta (`{ tipo: 'respuesta', texto }`).

**La IA nunca ejecuta nada con efecto legal.** Eso sigue siendo de la máquina de estados del agente,
que solo actúa después de un sí explícito (`docs/decisiones/20261121-1120-agente-whatsapp-confirmacion.md`).

## Contexto que recibe el modelo
Nombre, comuna y rol del negocio; los últimos 10 mensajes (`whatsapp.history`); lo que está pendiente
de confirmar; y el mensaje nuevo. Nunca el teléfono.

## Si algo falla
Tope de 10 s por mensaje (todas las vueltas). Error, demora o rechazo de Claude → responden las reglas
de siempre (`interpretarConReglas`). Sin `ANTHROPIC_API_KEY`, todo funciona con reglas.

## Uso
```ts
// server/index.ts
conectarAgente(whatsapp, red, { interprete: crearInterpreteDesdeEnv(process.env, red) });
```

## Configuración
| Variable | Por defecto |
|---|---|
| `ANTHROPIC_API_KEY` | sin ella, reglas fijas |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5`: responde más rápido que Opus en WhatsApp (esfuerzo `low`, fallback del servidor ante rechazos) |

## Agregar una consulta
1. El método en `Consultas` y su implementación en `crearConsultasRed` (solo lectura, sin teléfonos).
2. La herramienta en `CONSULTAS` (`herramientas.ts`, `strict: true`) y su caso en `consultar`.
3. Un test en `test/ia-asistente.test.ts`.

Una acción nueva (algo con efecto) **no** es una consulta: va como propuesta en el agente, con su confirmación.
