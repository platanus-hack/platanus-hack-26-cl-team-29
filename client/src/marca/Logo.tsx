// El logo de Bando, siempre desde su archivo: nunca se redibuja ni se escribe con una tipografía (DESIGN.md).

import { LOGO } from './recursos.ts';

/**
 * `horizontal` (panal + "bando", mínimo 120 px de ancho) o `icono` (hexágono, para menos de 120 px).
 * `fondo="tema"` (dentro de `.bando-ui`) pone las dos versiones y tokens.css muestra la que corresponde al modo.
 */
export function Logo({ variante = 'horizontal', fondo = 'tema', className }: {
  variante?: 'horizontal' | 'icono'; fondo?: 'claro' | 'oscuro' | 'tema'; className?: string;
}) {
  const img = (src: string, extra = '') => <img className={`${className ?? ''}${extra}`} src={src} alt="Bando" draggable={false} />;
  if (variante === 'icono') return img(LOGO.icono);
  if (fondo !== 'tema') return img(LOGO[fondo]);
  return <>{img(LOGO.claro, ' logo-claro')}{img(LOGO.oscuro, ' logo-oscuro')}</>;
}
