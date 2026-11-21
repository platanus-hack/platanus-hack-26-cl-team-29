import type { Repositorio } from './repositorio.ts';
import type { DatosRed, EventoReputacion, Negocio } from './tipos.ts';

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

// Historial previo para que las notas partan distintas: Harinas Andes 4.8,
// Panificadora Ñuble 4.7, Distribuidora Sur 4.6, Molinos del Sur 3.9.
const historial: [string, EventoReputacion['tipo'], number][] = [
  ['n-harinas-andes', 'entrega_conforme', 4],
  [PROVEEDOR_DEMO, 'entrega_conforme', 2],
  ['n-molinos-del-sur', 'entrega_conforme', 2],
  ['n-molinos-del-sur', 'reclamo', 1],
];

export async function sembrarSiVacio(repo: Repositorio, ahora = new Date()): Promise<void> {
  const actuales: DatosRed = await repo.cargar();
  if (actuales.negocios.length > 0) return;
  const en = ahora.toISOString();
  for (const n of negocios) await repo.guardar('negocios', n);
  let i = 0;
  for (const [proveedorId, tipo, veces] of historial) {
    for (let k = 0; k < veces; k++) {
      await repo.guardar('eventosReputacion', { id: `historial-${++i}`, proveedorId, ordenId: 'historial', tipo, en });
    }
  }
  await repo.guardar('licitaciones', {
    id: 'L-1',
    producto: 'Harina 25 kg',
    comuna: 'Ñuñoa',
    cierraEn: new Date(ahora.getTime() + 2 * 3600_000).toISOString(),
    participantes: [
      { negocioId: 'n-almacen-don-tito', nombre: 'Almacén Don Tito', comuna: 'Ñuñoa', cantidad: 4 },
      { negocioId: 'n-minimarket-los-aromos', nombre: 'Minimarket Los Aromos', comuna: 'Ñuñoa', cantidad: 2 },
    ],
    ofertas: [
      { proveedorId: 'n-molinos-del-sur', precioUnitario: 17900, plazoDias: 2 },
      { proveedorId: 'n-harinas-andes', precioUnitario: 19500, plazoDias: 1 },
    ],
    estado: 'abierta',
  });
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
