import { lazy, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos.css';
import { MiNegocio } from './canal/MiNegocio.tsx';
import { Proveedor } from './canal/Proveedor.tsx';
import { Navegador } from './components/Navegador.tsx';
import { iniciarTema } from './marca/tema.ts';
import { Licitacion } from './vistas/Licitacion.tsx';
import { Proveedores } from './vistas/Proveedores.tsx';
import { Pagos } from './vistas/Pagos.tsx';
import { RedEnVivo } from './vistas/RedEnVivo.tsx';
import { Sala } from './vistas/Sala.tsx';
import { Unirse } from './vistas/Unirse.tsx';

// El mapa trae MapLibre, que pesa: se descarga solo al entrar a /mapa.
const Mapa = lazy(() => import('./vistas/Mapa.tsx').then(m => ({ default: m.Mapa })));
// La red en 3D suma deck.gl encima de MapLibre: se descarga solo al entrar a /red-3d.
const Red3D = lazy(() => import('./vistas/Red3D.tsx').then(m => ({ default: m.Red3D })));

// Rutas por path, sin librería: la pantalla de la demo, la licitación y la página del QR.
const VISTAS: Record<string, ComponentType> = {
  '/mapa': Mapa,
  '/red-3d': Red3D,
  '/licitacion': Licitacion,
  '/sala': Sala,
  '/unirse': Unirse,
  '/app': MiNegocio,
  '/proveedor': Proveedor,
  '/proveedores': Proveedores,
  '/pagos': Pagos,
};

iniciarTema(); // modo claro u oscuro de la marca, antes de dibujar para que no parpadee

const Vista = VISTAS[location.pathname.replace(/\/+$/, '')] ?? RedEnVivo;

createRoot(document.getElementById('root')!).render(
  <>
    <Suspense fallback={null}><Vista /></Suspense>
    <Navegador />
  </>,
);
