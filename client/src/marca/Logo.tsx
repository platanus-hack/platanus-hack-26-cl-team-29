// El logo de Bando, siempre desde su archivo: nunca se redibuja ni se escribe con una tipografía (DESIGN.md).

import { LOGO } from './recursos.ts';

/** `horizontal` (panal + "bando", mínimo 120 px de ancho) o `icono` (hexágono, para menos de 120 px). */
export function Logo({ variante = 'horizontal', fondo = 'claro', className }: {
  variante?: 'horizontal' | 'icono'; fondo?: 'claro' | 'oscuro'; className?: string;
}) {
  const src = variante === 'icono' ? LOGO.icono : LOGO[fondo];
  return <img className={className} src={src} alt="Bando" draggable={false} />;
}
