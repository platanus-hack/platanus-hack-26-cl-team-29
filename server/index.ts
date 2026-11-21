import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import pg from 'pg';
import { createWhatsApp } from './whatsapp/index.ts';
import { crearRutasRed, iniciarRed } from './red/index.ts';
import { iniciarConexionSii } from './conexion-sii/index.ts';
import { conectarAgente } from './agente/index.ts';
import { crearCertificados } from './certificados/index.ts';
import { crearInterpreteDesdeEnv } from './ia/index.ts';
import { iniciarLocales } from './locales/index.ts';
import { iniciarMercadoPublico } from './mercado-publico/index.ts';

const app = express();
const http = createServer(app);
const io = new Server(http);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dbRed = process.env.DATABASE_URL ? db : null;
export const whatsapp = await createWhatsApp({ db: dbRed });
// SII de certificación: la conexión hecha por el proveedor desde el panel; si no está completa, las variables SII_*;
// sin ninguna de las dos, el SII falso de la red.
const conexionSii = await iniciarConexionSii(dbRed);
export const red = await iniciarRed(dbRed, conexionSii.sii, { consultarContribuyente: conexionSii.consultarContribuyente });
red.escuchar(evento => io.emit('red:evento', evento));
// Folios del SII: el mínimo de facturas sigue a la compra conjunta abierta, y sus avisos van por el mismo canal.
conexionSii.fijarDemanda(tipo => (tipo === 33 ? red.licitacionAbierta()?.totalNegocios ?? 0 : 0));
conexionSii.escuchar(evento => io.emit('red:evento', evento));
const certificados = await crearCertificados({ db: dbRed });
export const agente = conectarAgente(whatsapp, red, { interprete: crearInterpreteDesdeEnv(process.env, red), certificados });
certificados.alConectar((telefono, rut) => agente.certificadoConectado(telefono, rut));
// Explorador de locales de Chile: corre en segundo plano y avisa cada celda recorrida desde el MUT.
const locales = await iniciarLocales(dbRed, hallazgo => io.emit('locales:evento', hallazgo));
// Proveedores y precios de referencia de Mercado Público: se actualizan en segundo plano y avisan por `red:evento`.
const mercadoPublico = await iniciarMercadoPublico(dbRed, evento => io.emit('red:evento', evento));

app.set('trust proxy', 1); // Render pone un proxy delante: req.ip es la IP real (límite por IP de /api/red)
app.use('/api/whatsapp', whatsapp.router); // antes de express.json(): el webhook firma el body crudo
app.use(certificados.rutas); // página y subida del certificado por link privado (antes del fallback del front)
app.use(express.json());
app.get('/api/health', async (_req, res) => {
  res.json((await db.query('select now()')).rows[0]);
});
app.use('/api/locales', locales.rutas);
app.use('/api/fuentes/mercado-publico', mercadoPublico.rutas);
app.use('/api/red', crearRutasRed(red, process.env, { conexionSii: conexionSii.rutas }));
app.use(express.static('dist'));
app.use((_req, res) => res.sendFile('index.html', { root: 'dist' })); // fallback SPA (Express 5: no usar app.get('*'))

// Reenvía cada evento a todos los demás clientes conectados
io.on('connection', s => s.on('evento', (d: unknown) => s.broadcast.emit('evento', d)));

export const server = http.listen(process.env.PORT || 3000);
