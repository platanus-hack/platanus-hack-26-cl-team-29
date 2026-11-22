// Prueba de carga local: una sala de compradores que se suma de golpe a la compra conjunta, como el público de la demo.
//
//   npm run carga              # 60 compradores
//   npm run carga -- 120       # otra cantidad
//
// Levanta su propio backend (PORT=3200, en memoria, SII y WhatsApp falsos, consulta de RUT de prueba) y nunca toca
// producción. Los códigos de acceso se leen del log del backend (el WhatsApp falso solo los anota), como haría una
// persona en su teléfono: no hay atajos ni puertas traseras. Cada comprador pide su código, entra, se registra con un
// RUT ficticio válido y arma su carrito; tres pantallas escuchan el socket. Después el proveedor de la demo cierra y
// factura. Imprime latencias (p50/p95) por paso, errores y si el estado final cuadra.
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { digitoVerificador } from '../shared/rut.ts';

const COMPRADORES = Number(process.argv[2] ?? 60);
const PUERTO = 3200;
const BASE = `http://127.0.0.1:${PUERTO}`;
const TOKEN_DEMO = 'carga-local';
const TELEFONO_PROVEEDOR = '+56900000099';

const codigos = new Map<string, (codigo: string) => void>();
const servidor = spawn(process.execPath, ['server/index.ts'], {
  env: {
    PATH: process.env.PATH, PORT: String(PUERTO), DEMO_FICTICIOS: '1', DEMO_MINUTOS: '60', DEMO_TOKEN: TOKEN_DEMO,
    DEMO_TELEFONO_PROVEEDOR: TELEFONO_PROVEEDOR, PAGOS_EXIGIR_TARJETA: '0', SII_CONSULTA_RUT: 'falsa',
    REPARTO_CALLES: '0', REPARTO_GEOCODIFICAR: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const leerLog = (trozo: Buffer) => {
  for (const m of trozo.toString().matchAll(/→ (\d+): Tu código para entrar a Bando:?\s*(?:es\s*)?\*?`*\s*(\d{6})/g)) {
    codigos.get(m[1]!)?.(m[2]!);
  }
};
servidor.stdout.on('data', leerLog);
servidor.stderr.on('data', leerLog);

const tiempos = new Map<string, number[]>();
const errores = new Map<string, string[]>();
async function medir<T>(paso: string, f: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  try {
    return await f();
  } catch (error) {
    errores.set(paso, [...(errores.get(paso) ?? []), error instanceof Error ? error.message : String(error)]);
    throw error;
  } finally {
    tiempos.set(paso, [...(tiempos.get(paso) ?? []), performance.now() - inicio]);
  }
}

async function api<T>(ruta: string, { metodo = 'POST', cuerpo, token }: { metodo?: string; cuerpo?: unknown; token?: string } = {}): Promise<T> {
  const r = await fetch(`${BASE}/api/red${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-demo-token': TOKEN_DEMO },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const datos = await r.json().catch(() => null) as { mensaje?: string } | null;
  if (!r.ok) throw new Error(`${r.status} ${datos?.mensaje ?? ruta}`);
  return datos as T;
}

/** Pide el código y lo espera en el log (como leerlo en WhatsApp). */
async function pedirCodigo(telefono: string): Promise<string> {
  let tope: ReturnType<typeof setTimeout> | undefined;
  const llega = new Promise<string>((resolver, rechazar) => {
    codigos.set(telefono.replace(/\D/g, ''), resolver);
    tope = setTimeout(() => rechazar(new Error('el código no llegó en 10 s')), 10_000);
  });
  llega.catch(() => {});
  try {
    await api('/acceso/codigo', { cuerpo: { telefono } });
    return await llega;
  } finally {
    clearTimeout(tope);
  }
}

const rutFicticio = (i: number) => {
  const cuerpo = String(30_000_000 + i);
  return `${cuerpo}-${digitoVerificador(cuerpo)}`;
};
const telefonoDe = (i: number) => `+5693${String(i).padStart(7, "0")}`;
const percentil = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

interface Estado { licitaciones: { id: string; estado: string; participantes: { cantidad: number }[]; productos: { id: string; totalUnidades?: number; precioActual?: number }[] }[] }

async function esperarServidor() {
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/red/estado`); return; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  throw new Error('el backend de prueba no levantó');
}

async function main() {
  await esperarServidor();
  const estado = await api<Estado>('/estado', { metodo: 'GET' });
  const lic = estado.licitaciones.find(l => l.estado === 'abierta');
  if (!lic) throw new Error('no hay compra abierta');

  // Tres pantallas proyectadas escuchando en vivo.
  let eventos = 0;
  const pantallas = [0, 1, 2].map(() => io(BASE, { transports: ['websocket'] }));
  for (const p of pantallas) p.on('red:evento', () => { eventos++; });

  const pedidos = new Map<number, { productoId: string; cantidad: number }[]>();
  const inicio = performance.now();
  const resultados = await Promise.allSettled(Array.from({ length: COMPRADORES }, async (_, i) => {
    // Llegan escalonados en ~5 s, como una sala que escanea el QR.
    await new Promise(r => setTimeout(r, Math.random() * 5000));
    const telefono = telefonoDe(i);
    const codigo = await medir('1 pedir código', () => pedirCodigo(telefono));
    await medir('2 entrar (número nuevo)', () => api('/acceso/entrar', { cuerpo: { telefono, codigo } }));
    const { token } = await medir('3 registrarse', () => api<{ token: string }>('/acceso/entrar', {
      cuerpo: { telefono, codigo, rut: rutFicticio(i), nombre: `Almacén ${i}`, comuna: 'Ñuñoa', direccion: `Calle Prueba ${i}` },
    }));
    const items = lic.productos.filter(() => Math.random() < 0.6).map(p => ({ productoId: p.id, cantidad: 1 + Math.floor(Math.random() * 6) }));
    if (!items.length) items.push({ productoId: lic.productos[0]!.id, cantidad: 2 });
    await medir('4 sumarse (carrito)', () => api('/yo/carrito', { metodo: 'PUT', token, cuerpo: { licitacionId: lic.id, items } }));
    pedidos.set(i, items);
  }));
  const duracionSuma = performance.now() - inicio;

  // El estado final cuadra con lo que pidió cada uno.
  const final = (await api<Estado>('/estado', { metodo: 'GET' })).licitaciones.find(l => l.id === lic.id)!;
  const esperado = new Map<string, number>();
  for (const items of pedidos.values()) for (const i of items) esperado.set(i.productoId, (esperado.get(i.productoId) ?? 0) + i.cantidad);
  const cuadra = final.productos.every(p => (p.totalUnidades ?? 0) === (esperado.get(p.id) ?? 0));

  // El proveedor de la demo cierra y factura (SII falso).
  const codigoProveedor = await pedirCodigo(TELEFONO_PROVEEDOR);
  const { token: tokenProveedor } = await api<{ token: string }>('/acceso/entrar', { cuerpo: { telefono: TELEFONO_PROVEEDOR, codigo: codigoProveedor } });
  const ordenes = await medir('5 cerrar la compra', () => api<unknown[]>(`/proveedor/licitacion/${lic.id}/cerrar`, { token: tokenProveedor, cuerpo: { confirmado: true } }));
  await medir('6 facturar todo', () => api(`/proveedor/licitacion/${lic.id}/facturar`, { token: tokenProveedor, cuerpo: { confirmado: true } }));
  await new Promise(r => setTimeout(r, 1500));

  const fallidos = resultados.filter(r => r.status === 'rejected').length;
  console.log(`\n${COMPRADORES} compradores en ${(duracionSuma / 1000).toFixed(1)} s · ${fallidos} fallaron · ${eventos} eventos vistos por 3 pantallas`);
  console.log(`Estado final: ${final.participantes.length} participantes · unidades ${cuadra ? 'cuadran' : 'NO cuadran'} · ${Array.isArray(ordenes) ? ordenes.length : '?'} órdenes al cerrar\n`);
  console.log('Paso'.padEnd(26), 'n'.padStart(4), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'máx ms'.padStart(8), 'errores'.padStart(8));
  for (const [paso, xs] of [...tiempos].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(paso.padEnd(26), String(xs.length).padStart(4), percentil(xs, 50).toFixed(0).padStart(8), percentil(xs, 95).toFixed(0).padStart(8),
      Math.max(...xs).toFixed(0).padStart(8), String(errores.get(paso)?.length ?? 0).padStart(8));
  }
  for (const [paso, lista] of errores) console.log(`\n${paso}: ${[...new Set(lista)].join(' | ')}`);
  for (const p of pantallas) p.close();
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => servidor.kill());
