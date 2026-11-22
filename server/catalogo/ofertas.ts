// La lista de precios de cada proveedor compite sola: en cada compra en grupo sin proveedor fijo, el proveedor que
// tiene ese mismo producto (mismo nombre y unidad, o el mismo escrito distinto según Jev: equivalencias.ts) queda ofertando con sus tramos. Pasa al
// abrirse una compra (`licitacion.abierta`), al cambiar su lista y al arrancar, con su pedido mínimo si lo tiene. Si el proveedor mejora su oferta a mano
// en esa compra, la automática ya no la pisa.
// Decisión: docs/decisiones/20261121-2255-lista-de-productos-y-solicitudes.md
import { mismoProducto } from '../../shared/productos.ts';
import { crearEquivalencias, type Equivalencias } from './equivalencias.ts';
import type { Tramo } from '../../shared/precios.ts';
import type { EventoRed, LicitacionVista, NuevaOferta } from '../red/index.ts';
import type { Catalogos } from './index.ts';

/** Plazo de entrega con que entra una oferta automática, en días. */
const PLAZO_DIAS = 1;

interface RedConOfertas {
  estadoDeLaRed(): { licitaciones: LicitacionVista[] };
  ofertar(licitacionId: string, oferta: NuevaOferta): Promise<unknown>;
  escuchar(oyente: (evento: EventoRed) => void): () => void;
}

const mismosTramos = (a: readonly Tramo[] = [], b: readonly Tramo[] = []) =>
  a.length === b.length && a.every((t, i) => t.desde === b[i]!.desde && t.precioUnitario === b[i]!.precioUnitario);

export function conectarOfertasDeListas(
  red: RedConOfertas, catalogos: Pick<Catalogos, 'listas' | 'alCambiarLista'>,
  log: Pick<Console, 'warn'> = console, equivalencias: Equivalencias = crearEquivalencias(),
) {
  async function ofertarEn(l: LicitacionVista, soloDe?: string) {
    if (l.estado !== 'abierta' || l.proveedorId) return;
    const listas = catalogos.listas().filter(x => !soloDe || x.proveedorId === soloDe);
    const pedidos = l.productos.filter(x => !x.proveedorId);
    for (const p of pedidos) await equivalencias.aprender(p, listas.flatMap(x => x.productos));
    for (const { proveedorId, productos } of listas) {
      for (const p of pedidos) {
        const suyo = productos.find(x => mismoProducto(x, p)) ?? productos.find(x => equivalencias.mismo(x, p));
        const actual = p.ofertas.find(o => o.proveedorId === proveedorId);
        const igual = actual && mismosTramos(actual.tramos, suyo?.tramos) && actual.minimo === suyo?.minimo && actual.stock === suyo?.stock;
        if (!suyo || (actual && !actual.automatica) || igual) continue;
        try {
          await red.ofertar(l.id, {
            proveedorId, productoId: p.id, precioUnitario: suyo.tramos[0]!.precioUnitario, tramos: suyo.tramos, plazoDias: PLAZO_DIAS, automatica: true,
            ...(suyo.minimo ? { minimo: suyo.minimo } : {}), ...(suyo.stock !== undefined ? { stock: suyo.stock } : {}),
          });
        } catch (error) {
          log.warn(`[ofertas] no pude ofertar la lista de ${proveedorId} en ${l.id}:`, error instanceof Error ? error.message : error);
        }
      }
    }
  }
  const abiertas = () => red.estadoDeLaRed().licitaciones.filter(l => l.estado === 'abierta');
  const deLaRed = (id: string) => red.estadoDeLaRed().licitaciones.find(l => l.id === id);

  catalogos.alCambiarLista(proveedorId => { for (const l of abiertas()) void ofertarEn(l, proveedorId); });
  const dejar = red.escuchar(e => {
    const id = (e.datos as { licitacionId?: string } | null)?.licitacionId;
    const l = e.tipo === 'licitacion.abierta' && id ? deLaRed(id) : undefined;
    if (l) void ofertarEn(l);
  });
  for (const l of abiertas()) void ofertarEn(l);
  return { detener: dejar, ofertarEn };
}
