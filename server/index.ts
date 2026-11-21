import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import pg from 'pg';
import { createWhatsApp } from './whatsapp/index.ts';

const app = express();
const http = createServer(app);
const io = new Server(http);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const whatsapp = createWhatsApp();

app.use('/api/whatsapp', whatsapp.router); // antes de express.json(): el webhook firma el body crudo
app.use(express.json());
app.get('/api/health', async (_req, res) => {
  res.json((await db.query('select now()')).rows[0]);
});
app.use(express.static('dist'));
app.use((_req, res) => res.sendFile('index.html', { root: 'dist' })); // fallback SPA (Express 5: no usar app.get('*'))

// Reenvía cada evento a todos los demás clientes conectados
io.on('connection', s => s.on('evento', (d: unknown) => s.broadcast.emit('evento', d)));

export const server = http.listen(process.env.PORT || 3000);
