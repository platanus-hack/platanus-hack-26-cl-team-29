// Simula un mensaje entrante de WhatsApp: firma un payload igual al de Kapso y lo
// manda al server local. Sirve para probar handlers sin teléfono ni Kapso.
//
//   KAPSO_WEBHOOK_SECRET=dev node scripts/whatsapp-simulate.ts "hola" [--from 56912345678] [--url http://localhost:3000]
import { randomUUID } from 'node:crypto';
import { signPayload } from '../server/whatsapp/kapso/signature.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1]!;
};
const text = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'hola';
const from = flag('from', '56912345678');
const url = flag('url', 'http://localhost:3000');
const secret = process.env.KAPSO_WEBHOOK_SECRET;
if (!secret) {
  console.error('Falta KAPSO_WEBHOOK_SECRET (el mismo con el que corre el server).');
  process.exit(2);
}

const body = JSON.stringify({
  message: {
    id: `wamid.sim.${randomUUID()}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    from,
    text: { body: text },
    kapso: { direction: 'inbound', status: 'received', content: text },
  },
  conversation: { id: `conv_sim_${from}`, contact_name: 'Simulador', phone_number: from },
});

const response = await fetch(`${url}/api/whatsapp/webhook`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Event': 'whatsapp.message.received',
    'X-Webhook-Signature': signPayload(body, secret),
  },
  body,
});
console.log(response.status, await response.text());
