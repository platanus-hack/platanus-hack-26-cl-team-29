import { lazy, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos.css';
import { MiNegocio } from './canal/MiNegocio.tsx';
import { Proveedor } from './canal/Proveedor.tsx';
import { Navegador } from './components/Navegador.tsx';
import { Licitacion } from './vistas/Licitacion.tsx';
import { RedEnVivo } from './vistas/RedEnVivo.tsx';
import { Sala } from './vistas/Sala.tsx';
import { Unirse } from './vistas/Unirse.tsx';

// El mapa trae MapLibre, que pesa: se descarga solo al entrar a /mapa.
const Mapa = lazy(() => import('./vistas/Mapa.tsx').then(m => ({ default: m.Mapa })));

// Rutas por path, sin librería: la pantalla de la demo, la licitación y la página del QR.
const VISTAS: Record<string, ComponentType> = {
  '/mapa': Mapa,
  '/licitacion': Licitacion,
  '/sala': Sala,
  '/unirse': Unirse,
  '/app': MiNegocio,
  '/proveedor': Proveedor,
};

const Vista = VISTAS[location.pathname.replace(/\/+$/, '')] ?? RedEnVivo;

createRoot(document.getElementById('root')!).render(
  <>
    <Suspense fallback={null}><Vista /></Suspense>
    <Navegador />
  </>,
);
