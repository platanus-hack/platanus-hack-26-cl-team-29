import type { Repositorio } from './repositorio.ts';
import type { DatosRed, EventoReputacion, Licitacion, Negocio } from './tipos.ts';

// Datos de demo, todos ficticios. Los teléfonos son de mentira (+56 9 0000 00xx);
// para la demo por WhatsApp se reemplazan con DEMO_TELEFONO_COMPRADOR y
// DEMO_TELEFONO_PROVEEDOR, sin commitear números reales.

export const COMPRADOR_DEMO = 'n-pica-nunoa';
export const PROVEEDOR_DEMO = 'n-panificadora-nuble';

const negocios: Negocio[] = [
  { id: PROVEEDOR_DEMO, nombre: 'Panificadora Ñuble', comuna: 'San Miguel', rol: 'proveedor', telefono: '+56 9 0000 0001' },
  { id: 'n-molinos-del-sur', nombre: 'Molinos del Sur', comuna: 'Puente Alto', rol: 'proveedor', telefono: '+56 9 0000 0002' },
  { id: 'n-harinas-andes', nombre: 'Harinas Andes', comuna: 'Maipú', rol: 'proveedor', telefono: '+56 9 0000 0003' },
  { id: 'n-distribuidora-sur', nombre: 'Distribuidora Sur', comuna: 'La Cisterna', rol: 'proveedor', telefono: '+56 9 0000 0004' },
  { id: COMPRADOR_DEMO, nombre: 'La Picá de Ñuñoa', comuna: 'Ñuñoa', rol: 'comprador', telefono: '+56 9 0000 0011' },
  { id: 'n-almacen-don-tito', nombre: 'Almacén Don Tito', comuna: 'Ñuñoa', rol: 'comprador', telefono: '+56 9 0000 0012' },
  { id: 'n-minimarket-los-aromos', nombre: 'Minimarket Los Aromos', comuna: 'Ñuñoa', rol: 'comprador', telefono: '+56 9 0000 0013' },
  { id: 'n-amasanderia-la-esquina', nombre: 'Amasandería La Esquina', comuna: 'Providencia', rol: 'comprador', telefono: '+56 9 0000 0014' },
];

// Historial previo para que el ranking parta Panificadora Ñuble 4,7, Molinos del Sur 4,6,
// Harinas Andes 4,5 y Distribuidora Sur 4,4 (base 4,4 + 0,1 por entrega conforme).
// Un reclamo a Molinos (-0,4) lo deja en 4,2 y cae del segundo al cuarto lugar.
const historial: [string, EventoReputacion['tipo'], number][] = [
  [PROVEEDOR_DEMO, 'entrega_conforme', 3],
  ['n-molinos-del-sur', 'entrega_conforme', 2],
  ['n-harinas-andes', 'entrega_conforme', 1],
];

const MINUTO = 60_000;
/** Lo que paga cada comprador si compra solo la harina; la licitación muestra cuánto ahorra el grupo. */
export const PRECIO_SOLO_HARINA = 21500;
export const DURACION_LICITACION_MS = 5 * MINUTO;

/** Licitación de demo: compradores que se fueron sumando y ofertas que llegaron entre medio. */
export function licitacionDemo(ahora: Date): Licitacion {
  const hace = (minutos: number) => new Date(ahora.getTime() - minutos * MINUTO).toISOString();
  return {
    id: 'L-1',
    producto: 'Harina 25 kg',
    comuna: 'Ñuñoa',
    cierraEn: new Date(ahora.getTime() + DURACION_LICITACION_MS).toISOString(),
    precioSolo: PRECIO_SOLO_HARINA,
    participantes: [
      { negocioId: 'n-almacen-don-tito', nombre: 'Almacén Don Tito', comuna: 'Ñuñoa', cantidad: 4, en: hace(14) },
      { negocioId: 'n-minimarket-los-aromos', nombre: 'Minimarket Los Aromos', comuna: 'Ñuñoa', cantidad: 2, en: hace(11) },
      { negocioId: 'n-amasanderia-la-esquina', nombre: 'Amasandería La Esquina', comuna: 'Providencia', cantidad: 6, en: hace(7) },
    ],
    // Molinos del Sur es el más barato, pero con su nota pierde contra Panificadora Ñuble.
    ofertas: [
      { proveedorId: 'n-distribuidora-sur', precioUnitario: 17900, plazoDias: 1, en: hace(12) },
      { proveedorId: 'n-harinas-andes', precioUnitario: 17450, plazoDias: 2, en: hace(9) },
      { proveedorId: 'n-molinos-del-sur', precioUnitario: 17100, plazoDias: 2, en: hace(5) },
      { proveedorId: PROVEEDOR_DEMO, precioUnitario: 17200, plazoDias: 1, en: hace(3) },
    ],
    estado: 'abierta',
  };
}

/** Siembra la demo completa sobre un repositorio vacío. */
export async function sembrar(repo: Repositorio, ahora = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const en = ahora.toISOString();
  for (const n of negocios) await repo.guardar('negocios', n);
  let i = 0;
  for (const [proveedorId, tipo, veces] of historial) {
    for (let k = 0; k < veces; k++) {
      await repo.guardar('eventosReputacion', { id: `historial-${++i}`, proveedorId, ordenId: 'historial', tipo, en });
    }
  }
  await repo.guardar('licitaciones', licitacionDemo(ahora));
  await aplicarTelefonosDemo(repo, env);
}

export async function sembrarSiVacio(repo: Repositorio, ahora = new Date()): Promise<void> {
  const actuales: DatosRed = await repo.cargar();
  if (actuales.negocios.length === 0) await sembrar(repo, ahora);
}

/** Asigna los teléfonos reales de la demo (si vienen por entorno) a los dos negocios de demo. */
export async function aplicarTelefonosDemo(repo: Repositorio, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const telefonos: Record<string, string | undefined> = {
    [COMPRADOR_DEMO]: env.DEMO_TELEFONO_COMPRADOR,
    [PROVEEDOR_DEMO]: env.DEMO_TELEFONO_PROVEEDOR,
  };
  const { negocios: actuales } = await repo.cargar();
  for (const n of actuales) {
    const telefono = telefonos[n.id];
    if (telefono && telefono !== n.telefono) await repo.guardar('negocios', { ...n, telefono });
  }
}
