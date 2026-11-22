// ¿Dos productos escritos distinto son el mismo? Primero la regla exacta de siempre (`mismoProducto`, shared/productos.ts).
// Si no calza, Jev (TypeSafe, modelo de decisiones tipadas) responde una pregunta de sí/no por cada candidato de la misma
// unidad que comparte alguna palabra: "Harina saco 25kg" = "Harina sin polvos 25 kg". Sin TYPESAFE_API_KEY, solo la regla
// exacta. Cada par se pregunta una vez; un error no se guarda y se reintenta en la próxima pasada.
// Decisión: docs/decisiones/20261122-0804-mismo-producto-con-jev.md
import { compacto, mismoProducto } from '../../shared/productos.ts';
import { sinTildes } from '../../shared/texto.ts';

export interface ProductoNombrado { nombre: string; unidad: string }

/** Probabilidad (0 a 1) de que `ofertado` sea el mismo producto que cada candidato, en el mismo orden. */
export type PreguntarMismo = (ofertado: string, candidatos: readonly string[]) => Promise<number[]>;

export interface Equivalencias {
  /** Mismo producto: por la regla exacta o porque ya se confirmó con Jev. Síncrono, no llama a nadie. */
  mismo(a: ProductoNombrado, b: ProductoNombrado): boolean;
  /** Pregunta los pares que faltan entre `producto` y los candidatos plausibles. */
  aprender(producto: ProductoNombrado, candidatos: readonly ProductoNombrado[]): Promise<void>;
}

/** Desde aquí se acepta el sí. Medido con pares reales: iguales 0,87–0,96; distintos < 0,1; dudosos 0,3–0,4 (quedan fuera). */
const UMBRAL = 0.7;
/** Tope de preguntas por llamada: los candidatos ya vienen filtrados por unidad y palabra en común. */
const MAXIMO_CANDIDATOS = 20;

const palabras = (texto: string) => new Set(sinTildes(texto).split(/[^a-z0-9]+/).filter(w => w.length >= 4));
const compartenPalabra = (a: string, b: string) => { const deA = palabras(a); return [...palabras(b)].some(w => deA.has(w)); };
const clavePar = (a: ProductoNombrado, b: ProductoNombrado) => `${[compacto(a.nombre), compacto(b.nombre)].sort().join('|')}|${a.unidad}`;

export function crearEquivalencias(preguntar?: PreguntarMismo, log: Pick<Console, 'warn'> = console): Equivalencias {
  const respuestas = new Map<string, boolean>();
  return {
    mismo: (a, b) => mismoProducto(a, b) || respuestas.get(clavePar(a, b)) === true,
    async aprender(producto, candidatos) {
      if (!preguntar) return;
      const vistos = new Set<string>();
      const nuevos = candidatos.filter(c => {
        const clave = clavePar(producto, c);
        if (c.unidad !== producto.unidad || mismoProducto(c, producto) || respuestas.has(clave) || vistos.has(clave)) return false;
        vistos.add(clave);
        return compartenPalabra(producto.nombre, c.nombre);
      }).slice(0, MAXIMO_CANDIDATOS);
      if (!nuevos.length) return;
      try {
        const probabilidades = await preguntar(producto.nombre, nuevos.map(c => c.nombre));
        nuevos.forEach((c, i) => respuestas.set(clavePar(producto, c), (probabilidades[i] ?? 0) >= UMBRAL));
      } catch (error) {
        log.warn('[equivalencias] Jev no respondió:', error instanceof Error ? error.message : error);
      }
    },
  };
}

const URL_JEV = 'https://api.typesafe.ai/v1/systemone';
/** Versión fija: el umbral se midió con esta; el alias jev-latest cambia solo. */
const MODELO_JEV = 'jev-1.14.0';
const ESPERA_MS = 5000;

/** Una pregunta `noul` (¿es verdad?) por candidato, todas en una sola llamada (Jev las evalúa en paralelo). */
export function preguntarConJev(apiKey: string): PreguntarMismo {
  return async (ofertado, candidatos) => {
    const preguntas = Object.fromEntries(candidatos.map((c, i) => [`c${i}`, {
      type: 'noul',
      instructions: `¿\`ofertado\` y ${JSON.stringify(c)} son el mismo producto, escrito distinto? Distinta variedad, marca, sabor o tipo es otro producto.`,
    }]));
    const res = await fetch(URL_JEV, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELO_JEV, state: { ofertado }, questions: preguntas }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const { answers } = await res.json() as { answers: Record<string, { noul?: number }> };
    return candidatos.map((_, i) => answers[`c${i}`]?.noul ?? 0);
  };
}

/** Con TYPESAFE_API_KEY pregunta a Jev; sin ella, solo la regla exacta. */
export const crearEquivalenciasDesdeEnv = (env: NodeJS.ProcessEnv): Equivalencias =>
  crearEquivalencias(env.TYPESAFE_API_KEY ? preguntarConJev(env.TYPESAFE_API_KEY) : undefined);
