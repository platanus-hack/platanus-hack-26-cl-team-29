// Intérprete con Claude: entiende lenguaje libre y lo reduce a una Intencion.
// Las herramientas son PROPUESTAS: el modelo nunca ejecuta una acción con efecto legal.
// El código guarda la acción pendiente y solo la ejecuta tras un sí explícito.
import Anthropic from '@anthropic-ai/sdk';
import type { DatosSala, Intencion, Interprete } from './intencion.ts';
import { interpretarConReglas, interpretarSalaConReglas } from './intencion.ts';

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

const SISTEMA_SALA = `Eres el intérprete de un agente de WhatsApp. Una sala completa de pequeños negocios de Chile se está sumando a una compra conjunta.
El agente le preguntó a la persona cómo se llama su negocio y cuántas unidades quiere.
Si el mensaje trae el nombre del negocio o la cantidad, llama a datos_para_sumarse con lo que traiga (puede faltar uno de los dos).
El nombre va tal como lo escribió la persona, sin palabras como "somos" o "mi negocio se llama". La cantidad es en la unidad de venta.
Si el mensaje es una pregunta, un saludo o no trae ninguno de los dos datos, no llames ninguna herramienta.`;

const HERRAMIENTA_SALA: Anthropic.Beta.BetaToolUnion = {
  name: 'datos_para_sumarse',
  description: 'Nombre del negocio y/o cantidad que la persona quiere en la compra conjunta.',
  input_schema: objeto({
    nombre: { type: 'string', description: 'Nombre del negocio. Ej: "Almacén Rosita".' },
    cantidad: { type: 'integer', description: 'Cantidad en la unidad de venta, mayor que cero.' },
  }, []),
  strict: true,
};

/** Con 30 a 80 personas escribiendo a la vez, mejor responder con reglas que hacer esperar. */
const TIEMPO_MAXIMO_SALA_MS = 8000;

export function crearInterpreteClaude(apiKey: string, model: string): Interprete {
  const client = new Anthropic({ apiKey });
  return {
    async interpretarSala(texto, pregunta, unidad): Promise<DatosSala> {
      try {
        const respuesta = await client.beta.messages.create({
          model,
          max_tokens: 2048,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: SISTEMA_SALA,
          tools: [HERRAMIENTA_SALA],
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
          messages: [{
            role: 'user',
            content: `Unidad de venta: ${unidad.singular} (plural: ${unidad.plural}).\nEl agente preguntó: "${pregunta}"\n\nLa persona respondió: "${texto}"`,
          }],
        }, { timeout: TIEMPO_MAXIMO_SALA_MS, maxRetries: 1 });
        if (respuesta.stop_reason === 'refusal') return interpretarSalaConReglas(texto, unidad);
        const uso = respuesta.content.find(b => b.type === 'tool_use');
        if (!uso) return { claro: true };
        const datos = (uso.input ?? {}) as { nombre?: unknown; cantidad?: unknown };
        const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim().slice(0, 40) : '';
        const cantidad = Number(datos.cantidad);
        return {
          ...(nombre ? { nombre } : {}),
          ...(Number.isInteger(cantidad) && cantidad > 0 ? { cantidad } : {}),
          claro: true,
        };
      } catch (error) {
        console.warn('[agente] Claude no respondió (sala), uso reglas:', error instanceof Error ? error.message : error);
        return interpretarSalaConReglas(texto, unidad);
      }
    },
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
