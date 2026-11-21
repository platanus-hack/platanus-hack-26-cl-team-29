import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import pg from 'pg';
import { createWhatsApp } from './whatsapp/index.ts';
import { crearRutasRed, iniciarRed } from './red/index.ts';
import { iniciarConexionSii } from './conexion-sii/index.ts';
import { conectarAgente } from './agente/index.ts';
import { crearInterpreteDesdeEnv } from './ia/index.ts';

const app = express();
const http = createServer(app);
const io = new Server(http);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dbRed = process.env.DATABASE_URL ? db : null;
export const whatsapp = await createWhatsApp({ db: dbRed });
// SII de certificación: la conexión hecha por el proveedor desde el panel; si no está completa, las variables SII_*;
// sin ninguna de las dos, el SII falso de la red.
const conexionSii = await iniciarConexionSii(dbRed);
export const red = await iniciarRed(dbRed, conexionSii.sii);
red.escuchar(evento => io.emit('red:evento', evento));
export const agente = conectarAgente(whatsapp, red, { interprete: crearInterpreteDesdeEnv(process.env, red) });

app.set('trust proxy', 1); // Render pone un proxy delante: req.ip es la IP real (límite por IP de /api/red)
app.use('/api/whatsapp', whatsapp.router); // antes de express.json(): el webhook firma el body crudo
app.use(express.json());
app.get('/api/health', async (_req, res) => {
  res.json((await db.query('select now()')).rows[0]);
});
app.use('/api/red', crearRutasRed(red, process.env, { conexionSii: conexionSii.rutas }));
app.use(express.static('dist'));
app.use((_req, res) => res.sendFile('index.html', { root: 'dist' })); // fallback SPA (Express 5: no usar app.get('*'))

// Reenvía cada evento a todos los demás clientes conectados
io.on('connection', s => s.on('evento', (d: unknown) => s.broadcast.emit('evento', d)));

export const server = http.listen(process.env.PORT || 3000);
