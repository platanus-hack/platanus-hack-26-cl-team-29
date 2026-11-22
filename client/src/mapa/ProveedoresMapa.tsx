// Proveedores de Mercado Público en los mapas (/mapa y /red-3d): los que todavía no están en Bando, ubicados por comuna
// o, si solo se sabe la región, en un punto aproximado. Se piden a GET /api/proveedores/mapa y se vuelven a pedir con
// cada `red:evento` (incluye `mercado_publico.actualizado` y `proveedores.actualizado`).

import { miles } from '../../../shared/formato.ts';
import type { ProveedorMapa } from '../../../shared/ubicacion.ts';
import { Icono, Monograma } from '../components/Iconos.tsx';
import { useJson } from '../red/useJson.ts';
import './ficha.css';

export type { ProveedorMapa };

/** Los proveedores de Mercado Público que no están en Bando (los de Bando ya se dibujan con la red). */
export function useProveedoresMapa(evento: number | undefined): ProveedorMapa[] {
  const { datos } = useJson<{ proveedores: ProveedorMapa[] }>('/api/proveedores/mapa', evento);
  return datos?.proveedores.filter(p => !p.enBando) ?? [];
}

/** Radio del punto en píxeles: crece con los organismos que le compran, sin tapar el mapa. */
export const radioProveedorMp = (organismos: number) => 2.5 + 1.1 * Math.sqrt(Math.min(organismos, 60));

export const ficha = (clave: string) => `/proveedores?p=${encodeURIComponent(clave)}`;

/** Tarjeta al hacer clic en un proveedor de Mercado Público: nombre, categoría, organismos y su ficha completa. */
export function FichaMercadoPublico({ proveedor: p, alCerrar }: { proveedor: ProveedorMapa; alCerrar: () => void }) {
  const lugar = [p.comuna, p.region].filter(Boolean).join(', ');
  return (
    <aside className="mapa-ficha" aria-label={`Proveedor ${p.nombre}`}>
      <button type="button" className="mapa-ficha-cerrar" onClick={alCerrar} aria-label="Cerrar"><Icono nombre="cerrar" /></button>
      <h2><Monograma nombre={p.nombre} />{p.nombre}</h2>
      {p.categoria && <p>{p.categoria}</p>}
      <p className="mapa-ficha-nota"><b>{miles(p.organismos)}</b>{p.organismos === 1 ? 'organismo público le compra' : 'organismos públicos le compran'}</p>
      <p>Le vende al Estado por Mercado Público. Aún no está en Bando.</p>
      {lugar && <p>{lugar}{p.ubicacion === 'region' && <span className="mapa-ficha-aprox"> · ubicación aproximada</span>}</p>}
      <a href={ficha(p.clave)}>Ver ficha del proveedor →</a>
    </aside>
  );
}
