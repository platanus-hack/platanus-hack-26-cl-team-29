// API pública de la capa de IA. Fuera de server/ia/ solo se importa este archivo.
import Anthropic from '@anthropic-ai/sdk';
import type { Interprete } from '../agente/intencion.ts';
import { interpreteDeReglas } from '../agente/intencion.ts';
import { crearInterpreteClaude } from '../agente/claude.ts';
import { crearAsistente } from './asistente.ts';
import { crearConsultasRed, type RedConsultable } from './consultas.ts';

export { crearAsistente } from './asistente.ts';
export type { ClienteClaude, OpcionesAsistente } from './asistente.ts';
export { crearConsultasRed } from './consultas.ts';
export type { Consultas, RedConsultable } from './consultas.ts';

/**
 * El intérprete del agente de WhatsApp. Con ANTHROPIC_API_KEY: Claude con contexto y consultas
 * a la red (`conversar`), más el intérprete de la sala de siempre. Sin clave: reglas fijas.
 */
export function crearInterpreteDesdeEnv(env: NodeJS.ProcessEnv, red: RedConsultable): Interprete {
  const claveApi = env.ANTHROPIC_API_KEY;
  if (!claveApi) {
    console.warn('[ia] sin ANTHROPIC_API_KEY: el agente interpreta con reglas fijas');
    return interpreteDeReglas;
  }
  const modelo = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const { conversar } = crearAsistente({
    cliente: new Anthropic({ apiKey: claveApi }).beta.messages,
    modelo,
    consultas: crearConsultasRed(red),
  });
  return { ...crearInterpreteClaude(claveApi, modelo), conversar };
}
