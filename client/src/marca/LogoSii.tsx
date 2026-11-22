import { LOGO_SII } from './recursos.ts';

/**
 * El logo del SII, el único de la app (DESIGN.md, "Íconos"): va en cada acción y estado del SII. Sin fondo ni baldosa:
 * azul sobre fondo claro y en blanco sobre el azul del SII, en modo oscuro y en proyección (lo resuelve `.logo-sii`
 * en marca/componentes.css según dónde esté). `tam` fija el alto en px; sin él, sigue al texto (1,15 em).
 */
export function LogoSii({ tam, className = '' }: { tam?: number; className?: string }) {
  return (
    <img
      className={`logo-sii ${className}`.trim()}
      src={LOGO_SII}
      alt=""
      aria-hidden="true"
      style={tam ? { height: tam } : undefined}
    />
  );
}
