import type { Fuente } from '../red/tipos.ts';
import { Logo } from '../marca/Logo.tsx';

/** Aviso discreto cuando la pantalla muestra datos de prueba (sin backend). */
export function AvisoFuente({ fuente }: { fuente: Fuente }) {
  if (fuente !== 'falsa') return null;
  return <span className="fuente-falsa" title="El backend de la red no responde; se muestran datos de prueba">datos de prueba</span>;
}

export function Cargando() {
  return <main className="pagina"><p className="vacio">Conectando con la red...</p></main>;
}

/** Cabecera de las pantallas proyectadas de la red: marca, título, "En vivo" y el aviso de datos de prueba. */
export function CabeceraRed({ titulo, fuente }: { titulo: string; fuente: Fuente }) {
  return (
    <header className="red-cabecera">
      <Logo variante="icono" className="marca" />
      <h1 className="titulo-red">{titulo}</h1>
      <span className="en-vivo contorno">En vivo</span>
      <AvisoFuente fuente={fuente} />
    </header>
  );
}
