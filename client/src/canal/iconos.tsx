// Iconografía del canal web: logo del SII, monogramas de negocios y un solo set de íconos de línea
// (24x24, trazo 1,75, color del texto). Todo en contenedores de tamaño fijo para que las filas queden alineadas.

import type { ReactNode } from 'react';

/** Logo del SII sobre una placa blanca: indica que algo quedó registrado en el SII (no es una pantalla oficial). */
export function LogoSii({ tam = 18 }: { tam?: number }) {
  return (
    <span className="cn-logo-sii" style={{ width: tam, height: tam }} aria-hidden="true">
      <img src="/logos/sii.svg" alt="" />
    </span>
  );
}

const TRAZOS: Record<string, ReactNode> = {
  // Pestañas
  grupo: <><circle cx="9" cy="8" r="3.25" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 4.9a3.25 3.25 0 0 1 0 6.2M18 13.8c1.8.7 3 2.6 3 5.2" /></>,
  carro: <><path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.1" /><circle cx="9.5" cy="19.5" r="1.25" /><circle cx="17" cy="19.5" r="1.25" /></>,
  paquete: <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9M7.8 5.2l8.5 4.6" /></>,
  documento: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  // Productos
  rollo: <><ellipse cx="8" cy="12" rx="3.5" ry="7" /><ellipse cx="8" cy="12" rx="1.2" ry="2.4" /><path d="M8 5h9c1.9 0 3.5 3.1 3.5 7s-1.6 7-3.5 7H8" /></>,
  saco: <><path d="M8 3.5h8l-1.5 3c3 1.6 4.5 4.6 4.5 8.5 0 3.6-2.9 5.5-7 5.5s-7-1.9-7-5.5c0-3.9 1.5-6.9 4.5-8.5z" /><path d="M9.5 6.5h5" /></>,
  frasco: <><path d="M8 3.5h8v3H8z" /><path d="M7 6.5h10a1 1 0 0 1 1 1V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V7.5a1 1 0 0 1 1-1z" /><path d="M6 11h12" /></>,
  bloque: <><path d="M3.5 9.5 12 5l8.5 4.5L12 14z" /><path d="M3.5 9.5v5L12 19l8.5-4.5v-5M12 14v5" /></>,
  caja: <><path d="M3.5 7h17v13h-17z" /><path d="M3.5 7 6 3.5h12L20.5 7M10 11h4" /></>,
  // Rubros de los comercios
  tienda: <><path d="M4 9.5V20h16V9.5" /><path d="M3 9.5 5 4h14l2 5.5a2.6 2.6 0 0 1-4.5 1.6 2.6 2.6 0 0 1-4.5 0 2.6 2.6 0 0 1-4.5 0A2.6 2.6 0 0 1 3 9.5z" /><path d="M10 20v-5h4v5" /></>,
  pan: <><path d="M5 11a7 4.5 0 0 1 14 0v2.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 13.5z" /><path d="M9 8.2 10 11M13 7.8l.8 3.2" /></>,
  cubiertos: <><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" /><path d="M17 21V3c-2 1.5-3 4-3 7v3h3" /></>,
  botella: <><path d="M10 3h4v3.5c1.8 1 3 2.8 3 5V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-8.5c0-2.2 1.2-4 3-5z" /><path d="M7 13h10" /></>,
  cruz: <><path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z" /></>,
};

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, tam = 20 }: { nombre: NombreIcono; tam?: number }) {
  return (
    <svg className="cn-icono" width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TRAZOS[nombre]}
    </svg>
  );
}

/** Ícono del producto según su nombre. */
export function iconoDeProducto(producto: string): NombreIcono {
  if (/rollo|t[ée]rmic/i.test(producto)) return 'rollo';
  if (/harina|az[uú]car|\bsal\b/i.test(producto)) return 'saco';
  if (/levadura/i.test(producto)) return 'frasco';
  if (/manteca|mantequilla/i.test(producto)) return 'bloque';
  return 'caja';
}

/** Ícono del rubro del comercio, si se deduce de su nombre. */
export function rubroDe(nombre: string): NombreIcono | undefined {
  if (/almac[eé]n|minimarket|market/i.test(nombre)) return 'tienda';
  if (/panader|amasander|panificador/i.test(nombre)) return 'pan';
  if (/restaurant|fuente de soda|cafeter|pizzer|pic[aá]/i.test(nombre)) return 'cubiertos';
  if (/botiller/i.test(nombre)) return 'botella';
  if (/farmacia/i.test(nombre)) return 'cruz';
  return undefined;
}

const MENORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y']);

/** "Almacén La Esquina" -> "AE". */
export function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter(p => p && !MENORES.has(p.toLowerCase()));
  return palabras.slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
}

/** Tono estable derivado del nombre: el mismo negocio siempre tiene el mismo color. */
function tono(nombre: string): number {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Avatar del negocio: su logo si lo tiene; si no, iniciales sobre un color estable y el ícono del rubro. */
export function Monograma({ nombre, tam = 40, logoUrl, rubro = true }: { nombre: string; tam?: number; logoUrl?: string | null; rubro?: boolean }) {
  // Bajo 32 px el ícono del rubro taparía las iniciales.
  const icono = rubro && tam >= 32 ? rubroDe(nombre) : undefined;
  return (
    <span className="cn-monograma" style={{ width: tam, height: tam, fontSize: Math.round(tam * 0.38), background: logoUrl ? '#fff' : `hsl(${tono(nombre)} 55% 62%)` }} aria-hidden="true">
      {logoUrl ? <img src={logoUrl} alt="" /> : iniciales(nombre)}
      {icono && !logoUrl && <span className="cn-rubro"><Icono nombre={icono} tam={12} /></span>}
    </span>
  );
}
