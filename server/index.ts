import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import pg from 'pg';
import { createWhatsApp } from './whatsapp/index.ts';
import { crearRutasRed, crearSesiones, crearSesionesPostgres, iniciarRed } from './red/index.ts';
import { iniciarConexionSii, resumenDeConexion } from './conexion-sii/index.ts';
import { conectarAgente, crearAlmacenBorradores } from './agente/index.ts';

import { crearCertificados } from './certificados/index.ts';
import { crearInterpreteDesdeEnv } from './ia/index.ts';
import { iniciarLocales } from './locales/index.ts';
import { iniciarMercadoPublico } from './mercado-publico/index.ts';
import { iniciarAvisos } from './avisos/index.ts';
import { iniciarProveedores } from './proveedores/index.ts';
import { iniciarPagos } from './pagos/index.ts';
import { crearRutasAvisos } from './avisos/rutas.ts';
import { crearRutasCatalogo, crearRutasOperacionCatalogo, iniciarCatalogos } from './catalogo/index.ts';
import type { Negocio } from './red/tipos.ts';

const app = express();
const http = createServer(app);
const io = new Server(http);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dbRed = process.env.DATABASE_URL ? db : null;
export const whatsapp = await createWhatsApp({ db: dbRed });
// SII de certificación: la conexión hecha por el proveedor desde el panel; si no está completa, las variables SII_*;
// sin ninguna de las dos, el SII falso de la red.
const conexionSii = await iniciarConexionSii(dbRed);
// Crédito Bando exige la tarjeta inscrita para entrar a una compra; se enlaza al crear los pagos, más abajo.
let antesDeEntrar: (n: Negocio) => void | Promise<void> = () => {};
export const red = await iniciarRed(dbRed, conexionSii.sii, { consultarContribuyente: conexionSii.consultarContribuyente, antesDeEntrar: n => antesDeEntrar(n) });
red.escuchar(evento => io.emit('red:evento', evento));
// Folios del SII: el mínimo de facturas sigue a la compra conjunta abierta, y sus avisos van por el mismo canal.
conexionSii.fijarDemanda(tipo => (tipo === 33 ? red.licitacionAbierta()?.totalNegocios ?? 0 : 0));
conexionSii.escuchar(evento => io.emit('red:evento', evento));
const certificados = await crearCertificados({ db: dbRed });
// Avisos de compra abierta a compradores registrados (BASTA para no recibir más): docs/decisiones/20261121-1604-avisos-de-compra-abierta.md
const avisos = await iniciarAvisos({ red, whatsapp, db: dbRed, emitir: evento => io.emit('red:evento', evento) });
// Cada proveedor registrado por WhatsApp conecta el SII de su empresa con el certificado que subió.
const conexionDeProveedores = {
  async conectar(rutEmpresa: string, rutTitular: string) {
    const certificado = await certificados.certificadoDe(rutTitular);
    if (!certificado) throw new Error('no encontré tu certificado conectado');
    await conexionSii.conectarProveedor(rutEmpresa, certificado);
  },
  estado: async (rutEmpresa: string) => resumenDeConexion(await conexionSii.estadoDeProveedor(rutEmpresa)),
};
// Catálogo de cada proveedor (su lista y lo que sugieren sus facturas): se arma solo al registrarse o al entrar a su panel (docs/decisiones/20261121-1941-catalogo-desde-facturas.md).
const catalogos = await iniciarCatalogos({ db: dbRed, emitir: evento => io.emit('red:evento', evento) });
export const agente = conectarAgente(whatsapp, red, {
  interprete: crearInterpreteDesdeEnv(process.env, red), certificados, conexionSii: conexionDeProveedores,
  almacenBorradores: await crearAlmacenBorradores(dbRed), avisos, productos: catalogos,
});
certificados.alConectar((telefono, rut) => agente.certificadoConectado(telefono, rut));
// Explorador de locales de Chile: corre en segundo plano y avisa cada celda recorrida desde el MUT.
const locales = await iniciarLocales(dbRed, hallazgo => io.emit('locales:evento', hallazgo));
// Proveedores y precios de referencia de Mercado Público: se actualizan en segundo plano y avisan por `red:evento`.
const mercadoPublico = await iniciarMercadoPublico(dbRed, evento => io.emit('red:evento', evento));
// Buscador de proveedores: la red y Mercado Público en una sola lista, con giros del SII y categoría.
const proveedores = await iniciarProveedores({ db: dbRed, red, mercadoPublico, emitir: evento => io.emit('red:evento', evento) });
// Crédito Bando: Bando le paga al proveedor al facturar y cobra al comprador a plazo en su tarjeta inscrita (docs/decisiones/20261121-2018-credito-bando.md).
const pagos = await iniciarPagos({
  db: dbRed, red, emitir: evento => io.emit('red:evento', evento),
  enviar: (telefono, texto) => whatsapp.send(telefono, texto, { source: 'pagos' }),
});
antesDeEntrar = pagos.exigirTarjeta;
red.escuchar(e => {
  const n = e.tipo === 'negocio.registrado' ? (e.datos as { negocio?: Negocio }).negocio : undefined;
  if (n?.vende) catalogos.asegurar({ id: n.id, ...(n.rut ? { rut: n.rut } : {}) });
});

app.set('trust proxy', 1); // Render pone un proxy delante: req.ip es la IP real (límite por IP del ingreso del proveedor)
app.use('/api/whatsapp', whatsapp.router); // antes de express.json(): el webhook firma el body crudo
app.use(certificados.rutas); // página y subida del certificado por link privado (antes del fallback del front)
app.use(express.json());
app.get('/api/health', async (_req, res) => {
  res.json((await db.query('select now()')).rows[0]);
});
app.use('/api/locales', locales.rutas);
app.use('/api/fuentes/mercado-publico', mercadoPublico.rutas);
app.use('/api/proveedores', proveedores.rutas);
// Una sola sesión web para /api/red y /api/avisos: se entra con el teléfono y un código por WhatsApp, y dura 90 días.
const sesiones = dbRed ? await crearSesionesPostgres(dbRed) : crearSesiones();
const ENVIO_CODIGO = { sent: 'enviado', held: 'retenido', failed: 'fallido' } as const;
app.use('/api/avisos', crearRutasAvisos(avisos, red, sesiones));
app.use('/api/pagos', pagos.rutas(sesiones));
app.use('/api/red', crearRutasRed(red, process.env, {
  conexionSii: conexionSii.rutas, sesiones,
  enviarCodigo: async (telefono, texto) => ENVIO_CODIGO[(await whatsapp.send(telefono, { body: texto }, { source: 'acceso' })).status],
  catalogo: { proveedor: crearRutasCatalogo(catalogos, red), operacion: crearRutasOperacionCatalogo(catalogos, red) },
}));
app.use(express.static('dist'));
app.use((_req, res) => res.sendFile('index.html', { root: 'dist' })); // fallback SPA (Express 5: no usar app.get('*'))

// Reenvía cada evento a todos los demás clientes conectados
io.on('connection', s => s.on('evento', (d: unknown) => s.broadcast.emit('evento', d)));

export const server = http.listen(process.env.PORT || 3000);
