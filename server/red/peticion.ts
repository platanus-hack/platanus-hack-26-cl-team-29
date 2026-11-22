import type { Request } from 'express';

// Lectura del cuerpo de una petición a las rutas de la red (WhatsApp, pantallas y web): se lee con cuidado, sin confiar en tipos.

export const cuerpo = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});

/** El texto si lo es; si no, undefined. */
export const texto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Nombre, comuna y rubro de quien se registra como comprador desde la web, con su RUT. */
export const nuevoComprador = (b: Record<string, unknown>, rut: string) => {
  const direccion = texto(b.direccion)?.trim(), comuna = texto(b.comuna)?.trim();
  return { nombre: texto(b.nombre) ?? '', comuna: texto(b.comuna), rubro: texto(b.rubro), rut, ...(direccion && comuna ? { direccionFactura: { direccion, comuna } } : {}) };
};
