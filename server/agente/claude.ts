// Intérprete con Claude: entiende lenguaje libre y lo reduce a una Intencion.
// Las herramientas son PROPUESTAS: el modelo nunca ejecuta una acción con efecto legal.
// El código guarda la acción pendiente y solo la ejecuta tras un sí explícito.
import Anthropic from '@anthropic-ai/sdk';
import type { Intencion, Interprete } from './intencion.ts';
import { interpretarConReglas } from './intencion.ts';

const SISTEMA = `Eres el intérprete de un agente de WhatsApp para una red de compras entre negocios pequeños de Chile.
Tu única tarea es clasificar el último mensaje de la persona llamando exactamente UNA herramienta.
No ejecutas acciones: lo que elijas es una propuesta que la persona confirmará después.
Si el agente hizo una pregunta, interpreta el mensaje como respuesta a esa pregunta:
"sí", "dale", "emítela", "factura todo", "reclámala" son confirmar; "no", "mejor no", "cancela" son rechazar.
Si la persona dice que recibió todo bien, usa recepcion_conforme. Si dice que faltaron unidades, usa reportar_faltante.
Si nada aplica, no llames ninguna herramienta.`;

const objeto = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'object' as const, properties, required, additionalProperties: false });

const HERRAMIENTAS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: 'proponer_pedido',
    description: 'La persona quiere pedir un producto a un proveedor. Ej: "pide 4 sacos de harina".',
    input_schema: objeto({
      producto: { type: 'string', description: 'Producto con su unidad, en plural si corresponde. Ej: "sacos de harina".' },
      cantidad: { type: 'integer', description: 'Cantidad pedida, mayor que cero.' },
    }, ['producto', 'cantidad']),
    strict: true,
  },
  { name: 'confirmar', description: 'La persona dice que sí a lo que el agente propuso.', input_schema: objeto({}, []), strict: true },
  { name: 'rechazar', description: 'La persona dice que no o cancela lo que el agente propuso.', input_schema: objeto({}, []), strict: true },
  { name: 'recepcion_conforme', description: 'La persona recibió el pedido completo y conforme.', input_schema: objeto({}, []), strict: true },
  {
    name: 'reportar_faltante',
    description: 'Llegaron menos unidades que las facturadas. Ej: "faltaron 2 sacos".',
    input_schema: objeto({ cantidad: { type: 'integer', description: 'Unidades que faltaron.' } }, ['cantidad']),
    strict: true,
  },
  { name: 'ver_pedidos', description: 'Un proveedor quiere ver sus pedidos nuevos.', input_schema: objeto({}, []), strict: true },
];

export function crearInterpreteClaude(apiKey: string, model: string): Interprete {
  const client = new Anthropic({ apiKey });
  return {
    async interpretar(texto, pregunta) {
      try {
        const contenido = pregunta ? `El agente preguntó: "${pregunta}"\n\nLa persona respondió: "${texto}"` : texto;
        const respuesta = await client.beta.messages.create({
          model,
          max_tokens: 2048,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: SISTEMA,
          tools: HERRAMIENTAS,
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
          messages: [{ role: 'user', content: contenido }],
        });
        if (respuesta.stop_reason === 'refusal') return interpretarConReglas(texto);
        const uso = respuesta.content.find(b => b.type === 'tool_use');
        return uso ? deHerramienta(uso.name, uso.input) : { tipo: 'otro' };
      } catch (error) {
        console.warn('[agente] Claude no respondió, uso reglas:', error instanceof Error ? error.message : error);
        return interpretarConReglas(texto);
      }
    },
  };
}

function deHerramienta(nombre: string, input: unknown): Intencion {
  const datos = (input ?? {}) as { producto?: unknown; cantidad?: unknown };
  const cantidad = Number(datos.cantidad);
  switch (nombre) {
    case 'proponer_pedido':
      return typeof datos.producto === 'string' && cantidad > 0
        ? { tipo: 'pedir', producto: datos.producto, cantidad }
        : { tipo: 'otro' };
    case 'reportar_faltante':
      return cantidad > 0 ? { tipo: 'faltante', cantidad } : { tipo: 'otro' };
    case 'confirmar': return { tipo: 'si' };
    case 'rechazar': return { tipo: 'no' };
    case 'recepcion_conforme': return { tipo: 'conforme' };
    case 'ver_pedidos': return { tipo: 'ver_pedidos' };
    default: return { tipo: 'otro' };
  }
}
