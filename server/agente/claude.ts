// Intérprete con Claude: entiende lenguaje libre y lo reduce a una Intencion.
// Las herramientas son PROPUESTAS: el modelo nunca ejecuta una acción con efecto legal.
// El código guarda la acción pendiente y solo la ejecuta tras un sí explícito.
import Anthropic from '@anthropic-ai/sdk';
import type { Intencion, Interprete } from './intencion.ts';
import { interpretarConReglas } from './intencion.ts';
import type { AccionCanasta, CambioCarrito, Catalogo, DatosCanasta, ModoCambio } from './canasta.ts';
import { interpretarCanastaConReglas } from './canasta.ts';

const SISTEMA = `Eres el intérprete de un agente de WhatsApp para una red de compras entre negocios pequeños de Chile.
Tu única tarea es clasificar el último mensaje de la persona llamando exactamente UNA herramienta.
No ejecutas acciones: lo que elijas es una propuesta que la persona confirmará después.
Si el agente hizo una pregunta, interpreta el mensaje como respuesta a esa pregunta:
"sí", "dale", "emítela", "factura todo", "reclámala" son confirmar; "no", "mejor no", "cancela" son rechazar.
Si la persona dice que recibió todo bien, usa recepcion_conforme. Si dice que faltaron unidades, usa reportar_faltante.
Si nada aplica, no llames ninguna herramienta.`;

const objeto = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'object' as const, properties, required, additionalProperties: false });

export const HERRAMIENTAS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: 'proponer_pedido',
    description: 'La persona quiere pedir un producto a un proveedor. Ej: "pide 4 sacos de harina".',
    input_schema: objeto({
      producto: { type: 'string', description: 'Producto con su unidad, en plural si corresponde. Ej: "sacos de harina".' },
      cantidad: { type: 'integer', description: 'Cantidad pedida, mayor que cero.' },
      proveedor: { type: 'string', description: 'Nombre del proveedor, solo si la persona eligió uno. Ej: "Molinos del Sur". Si no lo dijo, se omite y el sistema elige el mejor evaluado.' },
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

const SISTEMA_SALA = `Eres el intérprete de un agente de WhatsApp. Una sala completa de pequeños negocios de Chile arma una compra conjunta de varios productos.
Cada persona tiene un carrito y lo cambia escribiendo en lenguaje libre. Lee el último mensaje y llama a datos_para_sumarse con lo que traiga:
- nombre: el nombre del negocio tal como lo escribió, sin "somos" ni "mi negocio se llama".
- items: un cambio por producto. operacion "fijar" deja esa cantidad ("4 cajas de rollos", "cambia las etiquetas a 5"), "sumar" agrega ("agrega 3 bolsas"), "quitar" resta esa cantidad o, con cantidad 0, saca el producto ("quita los guantes"). "2 del 3" son 2 del producto número 3 de la lista. La cantidad es en la unidad de venta del producto.
- solo_estos: true si pide solo esos productos y el resto sale del carrito ("solo rollos, 6").
- cantidad: un número sin producto claro ("mejor 6").
- accion: "ver" si pide su pedido o resumen, "lista" si pregunta qué productos o precios hay, "salir" si quiere salir o vaciar el carrito, "si" o "no" si responde a una pregunta del agente.
Si el mensaje es un saludo o una pregunta que no trae nada de esto, no llames ninguna herramienta.`;

function herramientaSala(cat: Catalogo): Anthropic.Beta.BetaToolUnion {
  return {
    name: 'datos_para_sumarse',
    description: 'Nombre del negocio, cambios al carrito o una acción sobre la compra conjunta.',
    input_schema: objeto({
      nombre: { type: 'string', description: 'Nombre del negocio. Ej: "Almacén Rosita".' },
      items: {
        type: 'array',
        description: 'Cambios al carrito, uno por producto.',
        items: objeto({
          productoId: { type: 'string', enum: cat.productos.map(p => p.id), description: 'Id del producto de la canasta.' },
          cantidad: { type: 'integer', description: 'Cantidad en la unidad de venta; 0 con "quitar" saca el producto.' },
          operacion: { type: 'string', enum: ['fijar', 'sumar', 'quitar'] },
        }, ['productoId', 'cantidad', 'operacion']),
      },
      solo_estos: { type: 'boolean', description: 'El carrito queda solo con estos productos.' },
      cantidad: { type: 'integer', description: 'Cantidad sin producto claro.' },
      accion: { type: 'string', enum: ['ver', 'lista', 'salir', 'si', 'no'] },
    }, []),
    strict: true,
  };
}

const MODOS: readonly ModoCambio[] = ['fijar', 'sumar', 'quitar'];
const ACCIONES: readonly AccionCanasta[] = ['ver', 'lista', 'salir', 'si', 'no'];
const entero = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);

/** La salida de la herramienta, validada contra la canasta (nunca se confía en ids ni cantidades sin revisar). */
function deHerramientaSala(input: unknown, cat: Catalogo): DatosCanasta {
  const d = (input ?? {}) as { nombre?: unknown; items?: unknown; solo_estos?: unknown; cantidad?: unknown; accion?: unknown };
  const nombre = typeof d.nombre === 'string' ? d.nombre.trim().slice(0, 40) : '';
  let fueraDeRango = false;
  const cambios: CambioCarrito[] = (Array.isArray(d.items) ? d.items : []).flatMap((x: { productoId?: unknown; cantidad?: unknown; operacion?: unknown }) => {
    const cantidad = entero(x?.cantidad);
    const modo = MODOS.find(m => m === x?.operacion);
    if (!cat.productos.some(p => p.id === x?.productoId) || cantidad === undefined || !modo) return [];
    if (modo !== 'quitar' && cantidad > cat.maximo) { fueraDeRango = true; return []; }
    return [{ productoId: String(x.productoId), cantidad, modo: modo === 'fijar' && cantidad === 0 ? 'quitar' : modo }];
  });
  const suelta = entero(d.cantidad);
  const accion = ACCIONES.find(a => a === d.accion);
  return {
    ...(nombre ? { nombre } : {}),
    cambios,
    ...(d.solo_estos === true && cambios.length ? { soloEstos: true } : {}),
    ...(accion ? { accion } : {}),
    ...(suelta && suelta <= cat.maximo ? { suelta: { cantidad: suelta, modo: 'fijar' as const } } : {}),
    ...(fueraDeRango || (suelta && suelta > cat.maximo) ? { fueraDeRango: true } : {}),
    claro: true,
  };
}

/** Con 30 a 80 personas escribiendo a la vez, mejor responder con reglas que hacer esperar. */
const TIEMPO_MAXIMO_SALA_MS = 8000;

export function crearInterpreteClaude(apiKey: string, model: string): Interprete {
  const client = new Anthropic({ apiKey });
  return {
    async interpretarCanasta(texto, pregunta, cat): Promise<DatosCanasta> {
      try {
        const lista = cat.productos.map((p, i) => `${i + 1}. id ${p.id}: ${p.corto}, se vende por ${p.unidad} (plural: ${p.unidadPlural})`).join('\n');
        const respuesta = await client.beta.messages.create({
          model,
          max_tokens: 2048,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: SISTEMA_SALA,
          tools: [herramientaSala(cat)],
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
          messages: [{
            role: 'user',
            content: `Productos de la canasta (máximo ${cat.maximo} por producto):\n${lista}\n\nEl agente dijo: "${pregunta}"\n\nLa persona respondió: "${texto}"`,
          }],
        }, { timeout: TIEMPO_MAXIMO_SALA_MS, maxRetries: 1 });
        if (respuesta.stop_reason === 'refusal') return interpretarCanastaConReglas(texto, cat);
        const uso = respuesta.content.find(b => b.type === 'tool_use');
        return uso ? deHerramientaSala(uso.input, cat) : { cambios: [], claro: true };
      } catch (error) {
        console.warn('[agente] Claude no respondió (sala), uso reglas:', error instanceof Error ? error.message : error);
        return interpretarCanastaConReglas(texto, cat);
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

export function deHerramienta(nombre: string, input: unknown): Intencion {
  const datos = (input ?? {}) as { producto?: unknown; cantidad?: unknown; proveedor?: unknown };
  const cantidad = Number(datos.cantidad);
  switch (nombre) {
    case 'proponer_pedido':
      return typeof datos.producto === 'string' && cantidad > 0
        ? {
          tipo: 'pedir', producto: datos.producto, cantidad,
          ...(typeof datos.proveedor === 'string' && datos.proveedor.trim() ? { proveedor: datos.proveedor.trim() } : {}),
        }
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
