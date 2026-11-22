// Primitivas de Bando (DESIGN.md, "Primitivas"): las piezas que encarnan las reglas de la marca. Una vista nueva o
// migrada arma su pantalla con estas piezas en vez de escribir estilos propios para un botón, una tarjeta o un estado.
// Los estilos viven en marca/componentes.css y salen de tokens.css: funcionan en claro, oscuro y proyección.

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { LogoSii } from './LogoSii.tsx';

const clases = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** El logo del SII junto a toda acción o estado que queda registrado en el SII. */

/**
 * - `primario` (negro; crema en oscuro): la acción principal. Una por pantalla.
 * - `secundario`: las demás acciones.
 * - `miel`: momentos de marca (sumarse, destacado). Como máximo uno por pantalla, y nunca junto a un primario.
 * - `sii`: lo que emite o registra algo en el SII. Lleva el logo del SII.
 * - `texto`: acciones de bajo peso (cancelar, ver más).
 */
export type VarianteBoton = 'primario' | 'secundario' | 'miel' | 'sii' | 'texto';

type PropsBoton = { variante?: VarianteBoton; ancho?: boolean; children: ReactNode };

const claseBoton = (variante: VarianteBoton, ancho: boolean | undefined, extra?: string) => variante === 'texto'
  ? clases('bm-boton-texto', extra)
  : clases('bm-boton', variante !== 'primario' && variante, ancho && 'bm-ancho', extra);

const contenidoBoton = (variante: VarianteBoton, children: ReactNode) => <>{variante === 'sii' && <LogoSii />}{children}</>;

export function Boton({ variante = 'primario', ancho, className, children, type = 'button', ...resto }: PropsBoton & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={claseBoton(variante, ancho, className)} {...resto}>{contenidoBoton(variante, children)}</button>;
}

/** El mismo botón cuando lleva a otra pantalla (un enlace que se ve como botón). */
export function BotonEnlace({ variante = 'primario', ancho, className, children, ...resto }: PropsBoton & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={claseBoton(variante, ancho, className)} {...resto}>{contenidoBoton(variante, children)}</a>;
}

/** Fondo blanco, borde fino, radio 12 y sin sombra. `calida` (crema miel) para un destacado por pantalla. */
export function Tarjeta({ relleno = true, calida, className, children, etiqueta }: {
  relleno?: boolean; calida?: boolean; className?: string; children: ReactNode; etiqueta?: string;
}) {
  return <section className={clases('bm-tarjeta', relleno && 'bm-tarjeta-relleno', calida && 'bm-tarjeta-calida', className)} aria-label={etiqueta}>{children}</section>;
}

/** 12 px, MAYÚSCULAS, con aire: el nombre corto de un número o de un bloque ("CIERRA EN"). */
export const Etiqueta = ({ children }: { children: ReactNode }) => <span className="bm-etiqueta">{children}</span>;

/**
 * Un número con su etiqueta. `valor` llega ya formateado: montos con `dinero()`, cantidades con `contar()`.
 * `heroe` es el número de la pantalla: uno solo por pantalla. `tono="ahorro"` (oliva) para lo que bajó o se ahorró.
 */
export function Cifra({ valor, etiqueta, detalle, tamano = 'normal', tono }: {
  valor: string; etiqueta?: string; detalle?: ReactNode; tamano?: 'normal' | 'grande' | 'heroe'; tono?: 'ahorro' | 'miel';
}) {
  return (
    <div className={clases('bm-cifra', `bm-cifra-${tamano}`, tono && `bm-cifra-${tono}`)}>
      {etiqueta && <Etiqueta>{etiqueta}</Etiqueta>}
      <strong>{valor}</strong>
      {detalle && <span className="bm-cifra-detalle">{detalle}</span>}
    </div>
  );
}

/** Tonos de estado. `aviso` pide una acción, `info` avanza solo, `exito` terminó bien, `sii` quedó en el SII. */
export type TonoEstado = 'neutro' | 'aviso' | 'info' | 'exito' | 'error' | 'sii';

/** Una píldora que dice en qué va algo ("Por confirmar", "Aceptado por el SII"). No es un botón: no se toca. */
export function Estado({ tono = 'neutro', children }: { tono?: TonoEstado; children: ReactNode }) {
  return <span className={clases('bm-estado', tono !== 'neutro' && `bm-estado-${tono}`)}>{tono === 'sii' && <LogoSii />}{children}</span>;
}

/** La barra miel del grupo. `etiqueta` es lo que lee un lector de pantalla ("37 de 50 cajas"). */
export function Barra({ valor, meta, etiqueta }: { valor: number; meta: number; etiqueta: string }) {
  const llenado = meta > 0 ? Math.min(1, Math.max(0, valor / meta)) : 0;
  return (
    <div className="bm-barra" role="progressbar" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={valor} aria-label={etiqueta}>
      <span style={{ width: `${llenado * 100}%` }} />
    </div>
  );
}

/**
 * El progreso de una compra en grupo: barra miel, el resumen ("11 locales · 37 de 50 cajas") y, en oliva, lo que falta
 * para el siguiente tramo ("Faltan 13 para $27.000"). Primero el número, después la explicación.
 */
export function ProgresoGrupo({ valor, meta, etiqueta, resumen, siguiente }: {
  valor: number; meta: number; etiqueta: string; resumen: ReactNode; siguiente?: ReactNode;
}) {
  return (
    <div className="bm-progreso">
      <Barra valor={valor} meta={meta} etiqueta={etiqueta} />
      <div className="bm-progreso-texto">
        <span>{resumen}</span>
        {siguiente && <span className="bm-ahorro">{siguiente}</span>}
      </div>
    </div>
  );
}

/** Pantalla o lista sin datos: una ilustración (de `ILUSTRACION` o `ABEJA`), qué pasa y qué hacer. */
export function EstadoVacio({ ilustracion, titulo, texto, accion }: { ilustracion?: string; titulo: string; texto: ReactNode; accion?: ReactNode }) {
  return (
    <div className="bm-vacio">
      {ilustracion && <img className="ilustracion" src={ilustracion} alt="" />}
      <h2>{titulo}</h2>
      <p>{texto}</p>
      {accion}
    </div>
  );
}
