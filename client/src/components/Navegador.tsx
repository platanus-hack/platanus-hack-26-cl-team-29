import { useEffect, useState } from 'react';

// Menú para moverse entre las vistas. En las pantallas que se proyectan se oculta solo
// cuando el mouse no se mueve, para no ensuciar la demo. La tecla "m" lo abre y lo cierra.
const ENLACES = [
  { ruta: '/red', nombre: 'La red en vivo', detalle: 'Ciclo de compra y notas' },
  { ruta: '/mapa', nombre: 'El mapa en vivo', detalle: 'La red sobre Santiago' },
  { ruta: '/licitacion', nombre: 'Licitación', detalle: 'Compra conjunta con QR' },
  { ruta: '/app', nombre: 'Mi negocio', detalle: 'Comprador por web' },
  { ruta: '/proveedor', nombre: 'Proveedor', detalle: 'Panel del proveedor' },
  { ruta: '/pagos', nombre: 'Pagos a proveedores', detalle: 'Equipo: transferir y marcar' },
  { ruta: '/unirse', nombre: 'Sumarse', detalle: 'Página del QR en el celular' },
] as const;

const OCULTAR_TRAS_MS = 3000;

const esCampoDeTexto = (destino: EventTarget | null): boolean =>
  destino instanceof HTMLInputElement || destino instanceof HTMLTextAreaElement || destino instanceof HTMLSelectElement;

export function Navegador() {
  const [abierto, setAbierto] = useState(false);
  const [visible, setVisible] = useState(true);
  const actual = location.pathname.replace(/\/+$/, '') || '/red';

  useEffect(() => {
    let temporizador: number | undefined;
    const mostrar = () => {
      setVisible(true);
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(() => setVisible(false), OCULTAR_TRAS_MS);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
      if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !esCampoDeTexto(e.target)) setAbierto(a => !a);
    };
    mostrar();
    window.addEventListener('mousemove', mostrar);
    window.addEventListener('touchstart', mostrar, { passive: true });
    window.addEventListener('keydown', alTeclear);
    return () => {
      window.clearTimeout(temporizador);
      window.removeEventListener('mousemove', mostrar);
      window.removeEventListener('touchstart', mostrar);
      window.removeEventListener('keydown', alTeclear);
    };
  }, []);

  return (
    <nav className={`navegador${visible || abierto ? ' navegador-visible' : ''}`} aria-label="Vistas de Bando">
      <button type="button" className="navegador-boton" aria-expanded={abierto} onClick={() => setAbierto(a => !a)}>
        Vistas
      </button>
      {abierto && (
        <ul className="navegador-lista">
          {ENLACES.map(e => (
            <li key={e.ruta}>
              <a href={e.ruta} aria-current={actual === e.ruta ? 'page' : undefined}>
                <span className="navegador-nombre">{e.nombre}</span>
                <span className="navegador-detalle">{e.detalle}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
