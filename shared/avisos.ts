// Aviso de compra conjunta abierta: el mismo texto en WhatsApp y en el banner de /app.
import { dinero } from './formato.ts';
import { contar } from './texto.ts';

export const TITULO_COMPRA_CERCA = 'Compra conjunta abierta cerca de ti';

/** "Caja de rollos a $29.900 y bajando, 3 negocios sumados" (o "sé el primero en sumarte" si no hay nadie). */
export function resumenCompraAbierta(p: { producto: string; precio: number; negocios: number }): string {
  const grupo = p.negocios > 0 ? contar(p.negocios, 'negocio sumado', 'negocios sumados') : 'sé el primero en sumarte';
  return `${p.producto} a ${dinero(p.precio)} y bajando, ${grupo}`;
}
