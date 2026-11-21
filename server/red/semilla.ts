import { configDemo } from './config-demo.ts';
import type { ConfigDemo } from './config-demo.ts';
import type { Repositorio } from './repositorio.ts';
import type { DatosRed, EventoReputacion, Licitacion, Negocio } from './tipos.ts';

// Datos de demo. Los negocios de la historia de /red son ficticios, con teléfonos de mentira
// (+56 9 0000 00xx); DEMO_TELEFONO_COMPRADOR reemplaza el del comprador de demo.
// El proveedor de "la sala compra junta" (`PROVEEDOR_SALA`) es una empresa real: su nombre, comuna
// y WhatsApp (DEMO_TELEFONO_PROVEEDOR) salen solo de variables de entorno.

export const COMPRADOR_DEMO = 'n-pica-nunoa';
export const PROVEEDOR_DEMO = 'n-panificadora-nuble';
export const PROVEEDOR_SALA = 'n-proveedor-demo';
export const LICITACION_SALA = 'L-1';

/**
 * Proveedores ficticios que compiten contra el real por la compra conjunta. `sobrePiso` es cuánto
 * más arriba del piso del proveedor real (DEMO_PRECIO_PISO) está su piso oculto: siempre por encima,
 * para que gane y facture la empresa real. Notas 4,6, 4,5 y 4,4 (la del real parte en 4,8).
 */
export const COMPETIDORES_SALA = [
  { id: 'n-papelera-central', nombre: 'Papelera Central', comuna: 'Quilicura', telefono: '+56 9 0000 0021', sobrePiso: 400, entregas: 2 },
  { id: 'n-insumos-del-sur', nombre: 'Insumos del Sur', comuna: 'San Bernardo', telefono: '+56 9 0000 0022', sobrePiso: 700, entregas: 1 },
  { id: 'n-rollos-express', nombre: 'Rollos Express', comuna: 'Renca', telefono: '+56 9 0000 0023', sobrePiso: 1100, entregas: 0 },
] as const;

const competidores: Negocio[] = COMPETIDORES_SALA.map(({ id, nombre, comuna, telefono }) => ({ id, nombre, comuna, rol: 'proveedor', telefono }));

const negocios: Negocio[] = [
  { id: PROVEEDOR_DEMO, nombre: 'Panificadora Ñuble', comuna: 'San Miguel', rol: 'proveedor', telefono: '+56 9 0000 0001' },
  { id: 'n-molinos-del-sur', nombre: 'Molinos del Sur', comuna: 'Puente Alto', rol: 'proveedor', telefono: '+56 9 0000 0002' },
  { id: 'n-harinas-andes', nombre: 'Harinas Andes', comuna: 'Maipú', rol: 'proveedor', telefono: '+56 9 0000 0003' },
  { id: 'n-distribuidora-sur', nombre: 'Distribuidora Sur', comuna: 'La Cisterna', rol: 'proveedor', telefono: '+56 9 0000 0004' },
  { id: COMPRADOR_DEMO, nombre: 'La Picá de Ñuñoa', comuna: 'Ñuñoa', rol: 'comprador', telefono: '+56 9 0000 0011', rubro: 'restaurante' },
  { id: 'n-almacen-don-tito', nombre: 'Almacén Don Tito', comuna: 'Ñuñoa', rol: 'comprador', telefono: '+56 9 0000 0012', rubro: 'almacen' },
  { id: 'n-minimarket-los-aromos', nombre: 'Minimarket Los Aromos', comuna: 'Ñuñoa', rol: 'comprador', telefono: '+56 9 0000 0013', rubro: 'minimarket' },
  { id: 'n-amasanderia-la-esquina', nombre: 'Amasandería La Esquina', comuna: 'Providencia', rol: 'comprador', telefono: '+56 9 0000 0014', rubro: 'panaderia' },
];

// Historial previo para que el ranking parta Panificadora Ñuble 4,7, Molinos del Sur 4,6,
// Harinas Andes 4,5 y Distribuidora Sur 4,4 (base 4,4 + 0,1 por entrega conforme).
// Un reclamo a Molinos (-0,4) lo deja en 4,2 y cae del segundo al cuarto lugar.
const historial: [string, EventoReputacion['tipo'], number][] = [
  [PROVEEDOR_DEMO, 'entrega_conforme', 3],
  ['n-molinos-del-sur', 'entrega_conforme', 2],
  ['n-harinas-andes', 'entrega_conforme', 1],
  // Compra conjunta: el proveedor real con mejor nota que sus competidores.
  [PROVEEDOR_SALA, 'entrega_conforme', 4],
  ...COMPETIDORES_SALA.map(c => [c.id, 'entrega_conforme', c.entregas] as [string, EventoReputacion['tipo'], number]),
];

const MINUTO = 60_000;
/** Lo que paga cada comprador si compra solo la harina (historia de /red). */
export const PRECIO_SOLO_HARINA = 21500;

// El logo viaja en el negocio solo si es https (corto); un data: va solo en GET /api/red/config.
const proveedorSala = (c: ConfigDemo): Negocio => ({
  id: PROVEEDOR_SALA, nombre: c.proveedor.nombre, comuna: c.proveedor.comuna, rol: 'proveedor', telefono: c.proveedor.telefono,
  ...(c.proveedorLogoUrl?.startsWith('https://') ? { logoUrl: c.proveedorLogoUrl } : {}),
});

/**
 * "La sala compra junta": abierta, sin participantes, con la canasta de la demo. El proveedor real vende a
 * todo el grupo y cada producto baja por sus propios tramos. Los pisos de competencia no se guardan aquí (son ocultos).
 */
export function licitacionDemo(ahora: Date, c: ConfigDemo = configDemo()): Licitacion {
  return {
    id: LICITACION_SALA,
    productos: c.productos.map(({ id, nombre, unidad, unidadPlural, precioSolo, tramos }) =>
      ({ id, nombre, unidad, unidadPlural, precioSolo, tramos: structuredClone(tramos), ofertas: [] })),
    producto: c.producto,
    unidad: c.unidad,
    unidadPlural: c.unidadPlural,
    comuna: c.proveedor.comuna,
    cierraEn: new Date(ahora.getTime() + c.minutos * MINUTO).toISOString(),
    precioSolo: c.precioSolo,
    proveedorId: PROVEEDOR_SALA,
    tramos: structuredClone(c.tramos),
    participantes: [],
    ofertas: [],
    estado: 'abierta',
  };
}

/** Siembra la demo completa sobre un repositorio vacío. */
export async function sembrar(repo: Repositorio, ahora = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const c = configDemo(env);
  const en = ahora.toISOString();
  for (const n of [...negocios, ...competidores]) await repo.guardar('negocios', n);
  await repo.guardar('negocios', proveedorSala(c));
  let i = 0;
  for (const [proveedorId, tipo, veces] of historial) {
    for (let k = 0; k < veces; k++) {
      await repo.guardar('eventosReputacion', { id: `historial-${++i}`, proveedorId, ordenId: 'historial', tipo, en });
    }
  }
  await repo.guardar('licitaciones', licitacionDemo(ahora, c));
  await aplicarDatosDemo(repo, env);
}

export async function sembrarSiVacio(repo: Repositorio, ahora = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const actuales: DatosRed = await repo.cargar();
  if (actuales.negocios.length === 0) await sembrar(repo, ahora, env);
}

/**
 * Aplica lo que viene por entorno sobre una base ya sembrada: el teléfono del comprador de demo, el
 * proveedor real de la sala y sus competidores (los crea si faltan, p. ej. en una base sembrada antes de existir).
 */
export async function aplicarDatosDemo(repo: Repositorio, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { negocios: actuales } = await repo.cargar();
  const comprador = actuales.find(n => n.id === COMPRADOR_DEMO);
  if (comprador && env.DEMO_TELEFONO_COMPRADOR && env.DEMO_TELEFONO_COMPRADOR !== comprador.telefono) {
    await repo.guardar('negocios', { ...comprador, telefono: env.DEMO_TELEFONO_COMPRADOR });
  }
  for (const c of competidores) if (!actuales.some(n => n.id === c.id)) await repo.guardar('negocios', c);
  // Una base sembrada antes de los rubros recibe el de los compradores de la demo.
  for (const n of negocios) {
    const actual = actuales.find(x => x.id === n.id);
    if (actual && n.rubro && !actual.rubro) await repo.guardar('negocios', { ...actual, rubro: n.rubro });
  }
  const deseado = proveedorSala(configDemo(env));
  const actual = actuales.find(n => n.id === PROVEEDOR_SALA);
  if (!actual || JSON.stringify(actual) !== JSON.stringify(deseado)) await repo.guardar('negocios', deseado);
}
