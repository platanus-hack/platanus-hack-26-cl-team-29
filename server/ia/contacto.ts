// Canal de contacto de un proveedor: ni el dataset OCDS, ni la API de órdenes de compra, ni la ficha pública de
// Mercado Público traen teléfono o correo (ver docs/hallazgos/20261121-1934-contacto-proveedores.md). Claude lo busca en la
// web por razón social y RUT y lo deja con la URL de donde salió; lo que no tenga forma válida se descarta.
import type Anthropic from '@anthropic-ai/sdk';
import type { ClienteClaude } from './asistente.ts';

export interface EntradaContacto {
  rut: string;
  nombre: string;
  region: string;
  comuna: string;
  giros: string[];
}

export interface Contacto {
  /** Dígitos con código de país (56 + 9 dígitos), o null. */
  telefono: string | null;
  email: string | null;
  web: string | null;
  /** Página donde se encontró. */
  fuente: string;
}

const HERRAMIENTA: Anthropic.Beta.BetaTool = {
  name: 'dejar_contacto',
  description: 'Deja el contacto comercial encontrado. Campos vacíos ("") si no hay un dato seguro.',
  input_schema: {
    type: 'object',
    properties: {
      telefono: { type: 'string', description: 'Teléfono o WhatsApp comercial, con código de país si aparece.' },
      email: { type: 'string' },
      web: { type: 'string', description: 'Sitio propio de la empresa.' },
      fuente: { type: 'string', description: 'URL de la página donde aparece el contacto.' },
    },
    required: ['telefono', 'email', 'web', 'fuente'],
  },
};

const SISTEMA = `Buscas el contacto comercial público de una empresa chilena que vende alimentos o insumos a negocios.
Busca en la web por su razón social y su RUT. Acepta solo datos publicados por la propia empresa o por un directorio
que la identifique sin duda (mismo nombre o mismo RUT). Nunca inventes ni completes un número o correo.
Al terminar llama a dejar_contacto; si no encontraste nada seguro, deja los campos vacíos.`;

const BUSQUEDA: Anthropic.Beta.BetaWebSearchTool20250305 = {
  type: 'web_search_20250305', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', country: 'CL' },
};

const url = (texto: unknown): string | null => {
  try {
    const u = new URL(String(texto ?? '').trim());
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null;
  } catch {
    return null;
  }
};

/** Teléfono chileno a 56 + 9 dígitos (celulares 9…, fijos 2…/otros); cualquier otra forma, null. */
export function telefonoChileno(texto: unknown): string | null {
  const d = String(texto ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const local = d.startsWith('56') && d.length === 11 ? d.slice(2) : d;
  return /^[2-9]\d{8}$/.test(local) ? `56${local}` : null;
}

/** Lo que devolvió el modelo, validado: sin fuente o sin teléfono ni correo válidos, no hay contacto. */
export function validarContacto(input: { telefono?: unknown; email?: unknown; web?: unknown; fuente?: unknown } | undefined): Contacto | null {
  const fuente = url(input?.fuente);
  const telefono = telefonoChileno(input?.telefono);
  const email = String(input?.email ?? '').trim().toLowerCase();
  const emailValido = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? email : null;
  if (!fuente || (!telefono && !emailValido)) return null;
  return { telefono, email: emailValido, web: url(input?.web), fuente };
}

export function crearBuscadorContacto(o: { cliente: ClienteClaude; modelo: string; tiempoMaximoMs?: number }) {
  return async (e: EntradaContacto): Promise<Contacto | null> => {
    const respuesta = await o.cliente.create({
      model: o.modelo,
      max_tokens: 1500,
      system: SISTEMA,
      tools: [BUSQUEDA, HERRAMIENTA],
      messages: [{ role: 'user', content: JSON.stringify({ razonSocial: e.nombre, rut: e.rut, region: e.region, comuna: e.comuna, giros: e.giros.slice(0, 3) }) }],
    }, { signal: AbortSignal.timeout(o.tiempoMaximoMs ?? 60_000), maxRetries: 1 });
    const uso = respuesta.content.find((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use' && b.name === HERRAMIENTA.name);
    // Sin respuesta final (corte o pausa): error, para reintentarlo en el próximo arranque en vez de guardarlo como "sin contacto".
    if (!uso) throw new Error(`sin respuesta de contacto (stop_reason ${respuesta.stop_reason})`);
    return validarContacto(uso.input as Record<string, unknown>);
  };
}
