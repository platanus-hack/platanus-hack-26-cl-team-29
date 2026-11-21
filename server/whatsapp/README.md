# server/whatsapp — módulo de WhatsApp (Kapso)

Dueño: @javierwb. **No modifiques este módulo para construir una feature: úsalo.**
Si necesitas algo que la API no ofrece, pídelo (PR o en `agents/`), no lo parches desde afuera.

## Regla de uso
Fuera de esta carpeta **solo se importa `server/whatsapp/index.ts`**. Nada de `kapso/*`:
el resto del repo no sabe que existe Kapso. Hay un test que lo verifica.

## Cómo se usa
```ts
import { whatsapp } from './index.ts'; // desde server/: instancia única, ya montada en /api/whatsapp

whatsapp.onMessage(async (message, ctx) => {
  await ctx.markRead({ typing: true });          // ✓✓ azul + "escribiendo…"
  if (message.content.kind === 'location') { /* message.content.lat / lng */ }
  await ctx.reply(`Recibí: ${message.text}`);    // textos > 4096 se parten solos
});
```
- `message.text`: texto legible (cuerpo, caption, transcripción de audio o botón apretado).
- `message.content`: unión discriminada `text | media | location | unsupported`.
- `reply`, `markRead` y `sendText` **nunca lanzan**: devuelven `{ ok: true, messageIds } | { ok: false, error }`.
- Responder con texto libre solo funciona dentro de 24 h desde el último mensaje del usuario (regla de Meta).

## Garantías
- El webhook responde 200 antes de correr cualquier handler (Kapso corta a los 10 s).
- Cada mensaje llega **una vez** a los handlers, aunque Kapso reintente (dedupe por wamid).
- Mensajes de una misma conversación se procesan **en orden y de a uno**; conversaciones distintas, en paralelo.
- Un handler que lanza se loguea y no afecta a los demás.
- Se ignoran nuestros propios mensajes salientes y los eventos que no son `whatsapp.message.received`.

## Configuración
| Variable | Sin ella |
|---|---|
| `KAPSO_WEBHOOK_SECRET` | el webhook responde 503 |
| `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` | los envíos se loguean en consola (modo dev) |

Webhook a configurar en Kapso: `https://<deploy>/api/whatsapp/webhook`, evento `whatsapp.message.received`.

## Probar en local
```sh
KAPSO_WEBHOOK_SECRET=dev npm start
KAPSO_WEBHOOK_SECRET=dev node scripts/whatsapp-simulate.ts "hola"
```

## Estructura
```
index.ts         API pública: createWhatsApp → { router, onMessage, sendText }
types.ts         tipos de dominio (sin nada de Kapso)
dispatcher.ts    dedupe, orden por conversación, aislamiento de errores
text-chunks.ts   parte textos largos en mensajes válidos
recent-ids.ts    set acotado con TTL para dedupe
log-sender.ts    sender de desarrollo
kapso/           adaptador: webhook, firma HMAC, parser del payload, cliente HTTP
```
