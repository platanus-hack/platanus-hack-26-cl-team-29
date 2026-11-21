// El botón sol/luna para pasar de modo claro a oscuro y al revés (marca/tema.ts).

import { useTema } from './tema.ts';

export function BotonTema({ className }: { className?: string }) {
  const [tema, cambiar] = useTema();
  const oscuro = tema === 'oscuro';
  return (
    <button type="button" className={className} onClick={cambiar} aria-label={oscuro ? 'Usar modo claro' : 'Usar modo oscuro'} title={oscuro ? 'Modo claro' : 'Modo oscuro'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {oscuro
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>
          : <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />}
      </svg>
    </button>
  );
}
