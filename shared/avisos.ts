// Aviso de compra conjunta abierta: el mismo texto en WhatsApp y en el banner de /app.
import { dinero } from './formato.ts';
import { contar } from './texto.ts';

export const TITULO_COMPRA_CERCA = 'Compra conjunta abierta cerca de ti';

/** "Caja de rollos a $29.900 y bajando, 3 negocios sumados" (o "sé el primero en sumarte" si no hay nadie). */
export function resumenCompraAbierta(p: { producto: string; precio: number; negocios: number }): string {
  const grupo = p.negocios > 0 ? contar(p.negocios, 'negocio sumado', 'negocios sumados') : 'sé el primero en sumarte';
  // Sin precio todavía (una solicitud sin referencia): los proveedores lo ponen al ofertar.
  return `${p.producto} ${p.precio > 0 ? `a ${dinero(p.precio)} y bajando` : 'esperando ofertas de proveedores'}, ${grupo}`;
}

// ---------- Trae a tu vecino ----------

/** Lo que el invitado manda al bot desde el enlace wa.me: el código atribuye su llegada a quien lo invitó. */
export const mensajeAlBotConCodigo = (codigo: string) => `Hola, quiero sumarme a la compra conjunta. Código de invitación: ${codigo}`;

/** Ruta de la invitación por la web. */
export const rutaInvitacion = (codigo: string) => `/unirse?ref=${encodeURIComponent(codigo)}`;

/** El texto que se comparte con otro negocio (WhatsApp, Web Share o copiar). Sin enlaces vacíos. */
export function textoInvitacion(p: { nombre: string; web: string | null; whatsapp: string | null }): string {
  const enlaces = [p.web && `Súmate aquí: ${p.web}`, p.whatsapp && `o por WhatsApp: ${p.whatsapp}`].filter(Boolean).join(' ');
  return `${p.nombre} te invita a la compra conjunta de Bando: mientras más negocios se suman, más baja el precio para todos. ${enlaces}`.trim();
}

/** "Almacén Uno invitó a Botillería Dos", la línea pública (solo nombres de negocios). */
export const lineaInvitacion = (invita: string, invitado: string) => `${invita} invitó a ${invitado}`;
