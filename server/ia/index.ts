// API pública de la capa de IA. Fuera de server/ia/ solo se importa este archivo.
import Anthropic from '@anthropic-ai/sdk';
import type { Interprete } from '../agente/intencion.ts';
import { interpreteDeReglas } from '../agente/intencion.ts';
import { crearInterpreteClaude } from '../agente/claude.ts';
import { crearAsistente } from './asistente.ts';
import { crearConsultasRed, type ListasDeProductos, type RedConsultable } from './consultas.ts';
import { clasificarConReglas, crearClasificador, type EntradaProveedor, type ResultadoClasificacion } from './clasificar.ts';
import { crearBuscadorContacto, type Contacto, type EntradaContacto } from './contacto.ts';

export { crearAsistente } from './asistente.ts';
export type { ClienteClaude, OpcionesAsistente } from './asistente.ts';
export { crearConsultasRed } from './consultas.ts';
export type { Consultas, RedConsultable } from './consultas.ts';
export { clasificarConReglas, crearClasificador } from './clasificar.ts';
export type { EntradaProveedor, ResultadoClasificacion } from './clasificar.ts';
export { telefonoChileno, validarContacto } from './contacto.ts';
export type { Contacto, EntradaContacto } from './contacto.ts';

const modeloDe = (env: NodeJS.ProcessEnv) => env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

/** Clasificador de proveedores ambiguos: Claude con ANTHROPIC_API_KEY; sin clave, reglas de palabras. */
export function crearClasificadorDesdeEnv(env: NodeJS.ProcessEnv): (e: EntradaProveedor) => Promise<ResultadoClasificacion | null> {
  if (!env.ANTHROPIC_API_KEY) return async e => clasificarConReglas(e);
  return crearClasificador({ cliente: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).beta.messages, modelo: modeloDe(env) });
}

/** Buscador del contacto de un proveedor en la web. Sin ANTHROPIC_API_KEY no hay cómo buscarlo: null. */
export function crearBuscadorContactoDesdeEnv(env: NodeJS.ProcessEnv): ((e: EntradaContacto) => Promise<Contacto | null>) | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return crearBuscadorContacto({ cliente: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).beta.messages, modelo: modeloDe(env) });
}

/**
 * El intérprete del agente de WhatsApp. Con ANTHROPIC_API_KEY: Claude con contexto y consultas
 * a la red (`conversar`), más el intérprete de la sala de siempre. Sin clave: reglas fijas.
 */
export function crearInterpreteDesdeEnv(env: NodeJS.ProcessEnv, red: RedConsultable, catalogos: ListasDeProductos): Interprete {
  const claveApi = env.ANTHROPIC_API_KEY;
  if (!claveApi) {
    console.warn('[ia] sin ANTHROPIC_API_KEY: el agente interpreta con reglas fijas');
    return interpreteDeReglas;
  }
  const modelo = modeloDe(env);
  const { conversar } = crearAsistente({
    cliente: new Anthropic({ apiKey: claveApi }).beta.messages,
    modelo,
    consultas: crearConsultasRed(red, catalogos),
  });
  return { ...crearInterpreteClaude(claveApi, modelo), conversar };
}
