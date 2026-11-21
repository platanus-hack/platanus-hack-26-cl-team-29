# server/whatsapp — módulo de WhatsApp (Kapso)

Dueño: @javierwb. **No modifiques este módulo para construir una feature: úsalo.**
Si necesitas algo que la API no ofrece, pídelo (PR o en `agents/`), no lo parches desde afuera.

## Regla de uso
Fuera de esta carpeta **solo se importa `server/whatsapp/index.ts`**. Nada de `kapso/*` ni de las
tablas `whatsapp_*`: el resto del repo no sabe que existe Kapso. Hay un test que lo verifica.

## Cómo se usa
```ts
import { whatsapp } from './index.ts'; // desde server/: instancia única, ya montada en /api/whatsapp

// Recibir
whatsapp.onMessage(async (message, ctx) => {
  await ctx.markRead({ typing: true });                 // ✓✓ azul + "escribiendo…"
  if (message.content.kind === 'reply') { /* apretó el botón message.content.id */ }
  await ctx.reply(`Recibí: ${message.text}`);           // textos > 4096 se parten solos
});

// Enviar, desde cualquier módulo (con o sin conversación abierta)
await whatsapp.send('56912345678', {
  body: '23 pedidos nuevos en Ñuñoa. ¿Los confirmo y facturo?',
  buttons: [{ id: 'facturar', title: 'Sí, factura todo' }, { id: 'ver', title: 'Ver los pedidos' }],
}, { source: 'agente' });
// → { status: 'sent' | 'held' | 'failed', messageId, … }

// Contexto para un LLM
const ultimos = await whatsapp.history('56912345678', { limit: 20 });
```
- `message.text`: texto legible (cuerpo, caption, transcripción, o el título del botón apretado).
- `message.content`: `text | reply | media | location | unsupported`.
- Botones: máximo 3, título de máximo 20 caracteres. Si no cumple, `send` devuelve `failed` sin llamar a Kapso.
- `send`, `sendText`, `reply` y `markRead` **nunca lanzan**.

## La ventana de 24 h
Meta solo deja mandar texto libre hasta 24 h después del último mensaje de la persona. No se puede saltar.
El módulo lo maneja solo:
1. Intenta enviar. Si Meta dice "ventana cerrada", el mensaje queda **`held`** (guardado, no perdido).
2. Si hay plantilla aprobada (`KAPSO_TEMPLATE_NAME`), se la manda **una vez** para invitarla a escribir.
3. Cuando la persona escribe, **primero le llegan los retenidos en orden** y después corren los handlers.

Para la demo con el sandbox (que no admite plantillas): que cada participante escriba primero al número.

## Garantías
- El webhook responde 200 antes de correr cualquier handler (Kapso corta a los 10 s).
- Cada mensaje llega **una vez** a los handlers, aunque Kapso reintente o el server se reinicie (wamid único en la BD).
- Mensajes de una misma persona se procesan **en orden y de a uno**; personas distintas, en paralelo.
- Un handler que lanza se loguea y no afecta a los demás.
- Se ignoran nuestros propios salientes; los eventos de estado actualizan el saliente (`sent → delivered → read`, o `failed`), sin retroceder.

## Base de datos
Tablas propias, creadas al arrancar (`create table if not exists`). Sin `DATABASE_URL`, todo queda en memoria.
- `whatsapp_contacts`: teléfono, nombre, último mensaje entrante, última plantilla enviada.
- `whatsapp_messages`: entrantes y salientes, con `wamid`, estado, error y `source` (qué módulo lo mandó).

## Configuración
| Variable | Sin ella |
|---|---|
| `KAPSO_WEBHOOK_SECRET` | el webhook responde 503 |
| `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` | los envíos se loguean en consola (modo dev) |
| `KAPSO_TEMPLATE_NAME` (+ `KAPSO_TEMPLATE_LANGUAGE`, por defecto `es`) | fuera de la ventana los mensajes solo esperan |

Webhook en Kapso: `https://<deploy>/api/whatsapp/webhook`, con los eventos `whatsapp.message.received`,
`whatsapp.message.sent`, `whatsapp.message.delivered`, `whatsapp.message.read` y `whatsapp.message.failed`.

## Probar en local
```sh
KAPSO_WEBHOOK_SECRET=dev npm start
KAPSO_WEBHOOK_SECRET=dev node scripts/whatsapp-simulate.ts "hola"
DATABASE_URL=postgres://… node --test test/whatsapp-store-postgres.test.ts   # BD desechable
```

## Estructura
```
index.ts             API pública: createWhatsApp → { router, onMessage, send, sendText, history }
types.ts             tipos de dominio (sin nada de Kapso)
outbox.ts            todo envío: guarda, manda, retiene por la ventana de 24 h, plantilla, flush
dispatcher.ts        dedupe, retenidos primero, orden por persona, aislamiento de errores
store.ts             puerto de persistencia + implementación en memoria
store-postgres.ts    tablas whatsapp_* en Postgres
outbound-message.ts  validación de botones (límites de WhatsApp)
text-chunks.ts       parte textos largos en mensajes válidos
log-sender.ts        sender de desarrollo
kapso/               adaptador: webhook, firma HMAC, parser del payload, cliente HTTP
```
