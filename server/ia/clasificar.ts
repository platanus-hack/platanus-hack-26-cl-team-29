// Clasificación de un proveedor ambiguo en la taxonomía de Bando (shared/categorias.ts): con su nombre, giros del SII y
// productos. Con ANTHROPIC_API_KEY la decide Claude con una herramienta de salida fija; sin clave, las reglas de
// palabras de siempre. Quien la llama guarda el resultado por RUT: nunca se pregunta dos veces por el mismo proveedor.
import type Anthropic from '@anthropic-ai/sdk';
import { CATEGORIAS, categoriaDeTexto, esCategoria, type IdCategoria } from '../../shared/categorias.ts';
import type { ClienteClaude } from './asistente.ts';

export interface EntradaProveedor {
  nombre: string;
  giros: string[];
  productos: string[];
}

export interface ResultadoClasificacion {
  categoria: IdCategoria;
  porque: string;
  fuente: 'ia' | 'reglas';
}

const HERRAMIENTA: Anthropic.Beta.BetaTool = {
  name: 'clasificar_proveedor',
  description: 'Deja la categoría principal del proveedor en la taxonomía de Bando y una frase corta (máx. 15 palabras) del porqué.',
  input_schema: {
    type: 'object',
    properties: {
      categoria: { type: 'string', enum: CATEGORIAS.map(c => c.id) },
      porque: { type: 'string' },
    },
    required: ['categoria', 'porque'],
  },
};

const SISTEMA = `Clasificas proveedores de restaurantes y almacenes de Chile en una sola categoría principal.
Categorías: ${CATEGORIAS.map(c => `${c.id} (${c.nombre})`).join(', ')}.
Usa solo los datos entregados (nombre, giros del SII, productos). Si no alcanzan, elige "otros" y dilo.`;

/** Sin clave: la primera categoría que calce con las palabras del nombre, los giros o los productos. */
export function clasificarConReglas(e: EntradaProveedor): ResultadoClasificacion | null {
  const categoria = categoriaDeTexto([e.nombre, ...e.giros, ...e.productos].join(' '));
  return categoria && { categoria, porque: 'Por las palabras de su nombre, giros o productos.', fuente: 'reglas' };
}

export function crearClasificador(o: { cliente: ClienteClaude; modelo: string; tiempoMaximoMs?: number }) {
  return async (e: EntradaProveedor): Promise<ResultadoClasificacion | null> => {
    const respuesta = await o.cliente.create({
      model: o.modelo,
      max_tokens: 300,
      system: SISTEMA,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: HERRAMIENTA.name },
      messages: [{ role: 'user', content: JSON.stringify({ nombre: e.nombre, giros: e.giros, productos: e.productos.slice(0, 15) }) }],
    }, { signal: AbortSignal.timeout(o.tiempoMaximoMs ?? 15_000), maxRetries: 1 });
    const uso = respuesta.content.find((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
    const input = uso?.input as { categoria?: unknown; porque?: unknown } | undefined;
    if (!esCategoria(input?.categoria) || typeof input.porque !== 'string') return clasificarConReglas(e);
    return { categoria: input.categoria, porque: input.porque.trim().slice(0, 160), fuente: 'ia' };
  };
}
