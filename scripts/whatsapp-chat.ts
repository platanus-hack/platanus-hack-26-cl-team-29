// Chatea con Bando desde la terminal, sin WhatsApp: el mismo cableado que server/index.ts (red en
// memoria, agente, capa de IA) y los mensajes entran por el webhook firmado, igual que desde Kapso.
// Las respuestas se muestran aquí; nada se envía por WhatsApp. Con ANTHROPIC_API_KEY responde Claude.
//
//   node --env-file=.env scripts/whatsapp-chat.ts                 # como el comprador de la demo
//   node --env-file=.env scripts/whatsapp-chat.ts --como proveedor
//   node --env-file=.env scripts/whatsapp-chat.ts --tel 56911112222   # un número desconocido (público)
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { createWhatsApp } from '../server/whatsapp/index.ts';
import { signPayload } from '../server/whatsapp/kapso/signature.ts';
import { iniciarRed } from '../server/red/index.ts';
import { conectarAgente } from '../server/agente/index.ts';
import { crearInterpreteDesdeEnv } from '../server/ia/index.ts';

const args = process.argv.slice(2);
const flag = (nombre: string) => {
  const i = args.indexOf(`--${nombre}`);
  return i === -1 ? undefined : args[i + 1];
};

const SECRETO = 'chat-local';
const silencio = { info() {}, warn() {}, error: console.error };
// Sin credenciales de Kapso: el módulo usa su sender de desarrollo y nada sale por WhatsApp.
const env: NodeJS.ProcessEnv = { ...process.env, KAPSO_API_KEY: '', KAPSO_PHONE_NUMBER_ID: '', KAPSO_WEBHOOK_SECRET: SECRETO };

const whatsapp = await createWhatsApp({ env, log: silencio });
const red = await iniciarRed(null);
conectarAgente(whatsapp, red, { interprete: crearInterpreteDesdeEnv(env, red), env });

const rol = flag('como') === 'proveedor' ? 'proveedor' : 'comprador';
const negocio = red.estadoDeLaRed().negocios.find(n => n.rol === rol && n.telefono);
const telefono = (flag('tel') ?? negocio?.telefono ?? '56900000000').replace(/\D/g, '');

const app = express();
app.use('/api/whatsapp', whatsapp.router);
const server = app.listen(0);
const url = `http://localhost:${(server.address() as AddressInfo).port}/api/whatsapp/webhook`;

console.log(`\nHablas como ${flag('tel') ? `el número ${telefono}` : `${negocio?.nombre} (${rol}, ${negocio?.comuna})`}.`);
console.log(`Responde ${env.ANTHROPIC_API_KEY ? 'Claude' : 'el agente con reglas fijas (no hay ANTHROPIC_API_KEY)'}. Ctrl+D para salir.\n`);

let n = 0;
async function enviar(texto: string) {
  const antes = (await whatsapp.history(telefono, { limit: 1000 })).length;
  const body = JSON.stringify({
    message: { id: `wamid.chat.${Date.now()}.${n++}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', from: telefono, text: { body: texto }, kapso: { direction: 'inbound' } },
    conversation: { id: `conv_${telefono}`, phone_number: telefono },
  });
  const inicio = Date.now();
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'whatsapp.message.received', 'X-Webhook-Signature': signPayload(body, SECRETO) },
    body,
  });
  // El agente responde después del 200: se espera su respuesta (y una posible segunda) en el historial.
  let ultimoCambio = Date.now();
  let vistos = antes + 1;
  while (Date.now() - inicio < 30_000) {
    await new Promise(r => setTimeout(r, 200));
    const historial = await whatsapp.history(telefono, { limit: 1000 });
    if (historial.length > vistos) {
      for (const m of historial.slice(vistos)) if (m.direction === 'out') console.log(`\nBando › ${m.text}`);
      vistos = historial.length;
      ultimoCambio = Date.now();
    } else if (vistos > antes + 1 && Date.now() - ultimoCambio > 1500) break;
  }
  console.log(`        (${((Date.now() - inicio) / 1000).toFixed(1)} s)\n`);
}

const consola = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
for await (const linea of consola) {
  const texto = linea.trim();
  if (texto) {
    if (!process.stdin.isTTY) console.log(`Tú › ${texto}`);
    await enviar(texto);
  }
  if (process.stdin.isTTY) process.stdout.write('Tú › ');
}
server.close();
process.exit(0);
