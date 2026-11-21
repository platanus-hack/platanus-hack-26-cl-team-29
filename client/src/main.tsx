import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos.css';
import { MiNegocio } from './canal/MiNegocio.tsx';
import { Proveedor } from './canal/Proveedor.tsx';
import { Licitacion } from './vistas/Licitacion.tsx';
import { RedEnVivo } from './vistas/RedEnVivo.tsx';
import { Unirse } from './vistas/Unirse.tsx';

// Rutas por path, sin librería: la pantalla de la demo, la licitación y la página del QR.
const VISTAS: Record<string, () => JSX.Element> = {
  '/licitacion': Licitacion,
  '/unirse': Unirse,
  '/app': MiNegocio,
  '/proveedor': Proveedor,
};

const Vista = VISTAS[location.pathname.replace(/\/+$/, '')] ?? RedEnVivo;

createRoot(document.getElementById('root')!).render(<Vista />);
