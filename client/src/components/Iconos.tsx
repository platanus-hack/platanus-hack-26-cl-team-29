// Iconografía común: logo del SII, monogramas de negocios y un solo set de íconos de línea (24x24, trazo 2).

import type { CSSProperties } from 'react';

const TRAZOS = {
  tienda: 'M3 9l1.5-5h15L21 9M3 9h18M5 9v11h14V9M10 20v-6h4v6',
  pan: 'M5 19V11a4 4 0 0 1 1-7h12a4 4 0 0 1 1 7v8zM9 9v3M15 9v3',
  taza: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2',
  cubiertos: 'M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17 3c-2.5 2-2.5 7 0 9v9',
  farmacia: 'M5 4h14v16H5zM12 8v8M8 12h8',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  pedido: 'M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0',
  baja: 'M3 7l6 6 4-4 8 8M15 17h6v-6',
  nota: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  caja: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  cerrada: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
} as const;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, className = '' }: { nombre: NombreIcono; className?: string }) {
  return (
    <svg className={`icono ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}

/** Logo del SII: marca lo que quedó registrado oficialmente. Indica la conexión, no es una pantalla del SII. */
export function LogoSii({ className = '' }: { className?: string }) {
  return <img className={`logo-sii ${className}`} src="/logos/sii.svg" alt="SII" />;
}

const RUBROS: Array<[RegExp, NombreIcono]> = [
  [/^(panader[ií]a|amasander[ií]a)/i, 'pan'],
  [/^cafeter[ií]a/i, 'taza'],
  [/^(restaurante|fuente de soda|pizzer[ií]a|picada)/i, 'cubiertos'],
  [/^farmacia/i, 'farmacia'],
  [/^(almac[eé]n|minimarket|botiller[ií]a|verduler[ií]a|ferreter[ií]a|librer[ií]a|kiosco)/i, 'tienda'],
];

/** Ícono del rubro según cómo empieza el nombre ("Panadería El Trigal" → pan). */
export function rubroDe(nombre: string): NombreIcono | undefined {
  return RUBROS.find(([re]) => re.test(nombre.trim()))?.[1];
}

const MENORES = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y']);

/** "Rollos del Sur" → "RS". */
export function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter(p => p && !MENORES.has(p.toLowerCase()));
  return palabras.slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
}

/** Color estable derivado del nombre: el mismo negocio siempre se ve igual en todas las pantallas. */
export function colorDe(nombre: string): string {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 70% 62%)`;
}

/**
 * Avatar de tamaño fijo: el logo si lo hay; si no, el ícono del rubro (con `rubro`) o las iniciales,
 * sobre un color estable.
 */
export function Monograma({ nombre, logoUrl, rubro = false, className = '' }: { nombre: string; logoUrl?: string; rubro?: boolean; className?: string }) {
  if (logoUrl) return <span className={`monograma con-logo ${className}`}><img src={logoUrl} alt="" /></span>;
  const icono = rubro ? rubroDe(nombre) : undefined;
  const estilo: CSSProperties = { background: colorDe(nombre) };
  return (
    <span className={`monograma ${className}`} style={estilo} aria-hidden="true">
      {icono ? <Icono nombre={icono} /> : iniciales(nombre)}
    </span>
  );
}
