import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import pg from 'pg';
import { createWhatsApp } from './whatsapp/index.ts';
import { conectarSiiReal, crearRutasRed, iniciarRed } from './red/index.ts';
import { conectarAgente } from './agente/index.ts';

const app = express();
const http = createServer(app);
const io = new Server(http);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const whatsapp = createWhatsApp();
const dbRed = process.env.DATABASE_URL ? db : null;
// Con certificado, la red emite en el SII de certificación; sin él, usa su SII falso.
export const red = await iniciarRed(dbRed, process.env.SII_PFX_BASE64 ? await conectarSiiReal(dbRed) : undefined);
red.escuchar(evento => io.emit('red:evento', evento));
export const agente = conectarAgente(whatsapp, red);

app.set('trust proxy', 1); // Render pone un proxy delante: req.ip es la IP real (límite por IP de /api/red)
app.use('/api/whatsapp', whatsapp.router); // antes de express.json(): el webhook firma el body crudo
app.use(express.json());
app.get('/api/health', async (_req, res) => {
  res.json((await db.query('select now()')).rows[0]);
});
app.use('/api/red', crearRutasRed(red));
app.use(express.static('dist'));
app.use((_req, res) => res.sendFile('index.html', { root: 'dist' })); // fallback SPA (Express 5: no usar app.get('*'))

// Reenvía cada evento a todos los demás clientes conectados
io.on('connection', s => s.on('evento', (d: unknown) => s.broadcast.emit('evento', d)));

export const server = http.listen(process.env.PORT || 3000);
