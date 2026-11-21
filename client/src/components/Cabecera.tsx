import type { Fuente } from '../red/tipos.ts';

/** Aviso discreto cuando la pantalla muestra datos de prueba (sin backend). */
export function AvisoFuente({ fuente }: { fuente: Fuente }) {
  if (fuente !== 'falsa') return null;
  return <span className="fuente-falsa" title="El backend de la red no responde; se muestran datos de prueba">datos de prueba</span>;
}

export function Cargando() {
  return <main className="pagina"><p className="vacio">Conectando con la red...</p></main>;
}
