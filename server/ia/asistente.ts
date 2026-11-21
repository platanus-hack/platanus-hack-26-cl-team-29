import type Anthropic from '@anthropic-ai/sdk';
import type { EntradaConversacion, Intencion } from '../agente/intencion.ts';
import { interpretarConReglas } from '../agente/intencion.ts';
import { deHerramienta } from '../agente/claude.ts';
import type { Consultas } from './consultas.ts';
import { consultar, HERRAMIENTAS, NOMBRES_PROPUESTA } from './herramientas.ts';
import { contexto, SISTEMA } from './prompt.ts';

/** Lo que el asistente usa del SDK: `new Anthropic().beta.messages`, o uno falso en los tests. */
export interface ClienteClaude {
  create(
    params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal; maxRetries?: number },
  ): Promise<Anthropic.Beta.Messages.BetaMessage>;
}

export interface OpcionesAsistente {
  readonly cliente: ClienteClaude;
  readonly modelo: string;
  readonly consultas: Consultas;
  /** Tope para todo el mensaje (todas las vueltas). Pasado eso, responden las reglas. */
  readonly tiempoMaximoMs?: number;
  readonly log?: Pick<Console, 'warn'>;
}

/** Vueltas de consultas antes de rendirse; una pregunta normal usa 1 o 2. */
const MAX_VUELTAS = 4;

/**
 * Un mensaje → una `Intencion`. El modelo puede consultar la red cuantas veces necesite (hasta
 * MAX_VUELTAS) y termina de una de dos formas: llama una herramienta de propuesta (el agente la
 * guarda y pide el sí) o responde texto (`respuesta`). Nunca ejecuta nada con efecto.
 * Si Claude falla, se demora o se niega, contestan las reglas de siempre: el chat no se cae.
 */
export function crearAsistente(o: OpcionesAsistente) {
  const log = o.log ?? console;

  async function conversar(entrada: EntradaConversacion): Promise<Intencion> {
    const limite = AbortSignal.timeout(o.tiempoMaximoMs ?? 10_000);
    const mensajes: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: contexto(entrada) }];
    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        const respuesta = await o.cliente.create({
          model: o.modelo,
          max_tokens: 2048,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
          tools: HERRAMIENTAS,
          tool_choice: { type: 'auto' },
          messages: mensajes,
        }, { signal: limite, maxRetries: 1 });

        if (respuesta.stop_reason === 'refusal') return interpretarConReglas(entrada.texto);

        const usos = respuesta.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
        const propuesta = usos.find(u => NOMBRES_PROPUESTA.has(u.name));
        if (propuesta) return deHerramienta(propuesta.name, propuesta.input);

        if (usos.length === 0) {
          const texto = respuesta.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
          return texto ? { tipo: 'respuesta', texto } : { tipo: 'otro' };
        }

        mensajes.push({ role: 'assistant', content: respuesta.content });
        mensajes.push({ role: 'user', content: usos.map(u => resultado(u, entrada.negocio.id)) });
      }
      log.warn('[ia] se acabaron las vueltas de consultas sin respuesta');
      return { tipo: 'otro' };
    } catch (error) {
      log.warn('[ia] Claude no respondió, uso reglas:', error instanceof Error ? error.message : error);
      return interpretarConReglas(entrada.texto);
    }
  }

  function resultado(uso: Anthropic.Beta.Messages.BetaToolUseBlock, negocioId: string): Anthropic.Beta.Messages.BetaToolResultBlockParam {
    try {
      return { type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(consultar(o.consultas, uso.name, uso.input, negocioId)) };
    } catch (error) {
      return { type: 'tool_result', tool_use_id: uso.id, is_error: true, content: error instanceof Error ? error.message : 'falló la consulta' };
    }
  }

  return { conversar };
}
