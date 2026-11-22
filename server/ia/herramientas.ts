// Dos clases de herramientas, y la diferencia es la regla dura del agente:
//  - CONSULTAS: solo leen la red; se ejecutan solas y su resultado vuelve al modelo.
//  - PROPUESTAS: las del intérprete de siempre (server/agente/claude.ts). Terminan la vuelta:
//    el agente guarda la acción y la ejecuta solo si la persona dice que sí.
import type Anthropic from '@anthropic-ai/sdk';
import { HERRAMIENTAS as PROPUESTAS_DEL_AGENTE } from '../agente/claude.ts';
import type { Consultas } from './consultas.ts';

const objeto = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'object' as const, properties, required, additionalProperties: false });

const CONSULTAS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: 'mis_pedidos',
    description: 'Los pedidos recientes de este negocio (como comprador o proveedor): productos, total, estado y facturas o notas de crédito con su folio y estado en el SII.',
    input_schema: objeto({}, []),
    strict: true,
  },
  {
    name: 'proveedores',
    description: 'Proveedores de la red con su comuna y su nota (1 a 5, sale de entregas y reclamos reales). Con un producto, solo los que lo tienen en su lista, con su precio neto base y su pedido mínimo.',
    input_schema: objeto({
      producto: { type: 'string', description: 'Producto por el que se pregunta, como lo dijo la persona. Ej: "harina".' },
    }, []),
    strict: true,
  },
  {
    name: 'catalogo',
    description: 'Los productos que hoy venden los proveedores de Bando (sus listas), con su unidad, el precio neto base más bajo y cuántos proveedores lo venden.',
    input_schema: objeto({}, []),
    strict: true,
  },
  {
    name: 'compra_conjunta',
    description: 'Las compras en grupo abiertas: sus productos con precio actual por volumen y cuánto falta para el siguiente tramo, cuántos negocios se sumaron, cuándo cierran (hora de Chile), si la abrió este negocio (laAbristeTu) y lo que lleva en cada una (tuPedido). El proveedor se elige al cierre.',
    input_schema: objeto({}, []),
    strict: true,
  },
];

export const HERRAMIENTAS: Anthropic.Beta.BetaToolUnion[] = [...CONSULTAS, ...PROPUESTAS_DEL_AGENTE];

export const NOMBRES_PROPUESTA = new Set(PROPUESTAS_DEL_AGENTE.flatMap(h => ('name' in h ? [h.name] : [])));

/** Ejecuta una consulta. Lanza si el nombre no es una consulta conocida. */
export function consultar(consultas: Consultas, nombre: string, input: unknown, negocioId: string): unknown {
  switch (nombre) {
    case 'mis_pedidos': return consultas.misPedidos(negocioId);
    case 'proveedores': {
      const producto = (input as { producto?: unknown } | null)?.producto;
      return consultas.proveedores(typeof producto === 'string' && producto.trim() ? producto.trim() : null);
    }
    case 'catalogo': return consultas.catalogo();
    case 'compra_conjunta': return consultas.compraConjunta(negocioId);
    default: throw new Error(`herramienta desconocida: ${nombre}`);
  }
}
