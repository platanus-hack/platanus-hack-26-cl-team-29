// /unirse: la página del QR. Entra con el número de WhatsApp y un código (y, si el número es nuevo, el nombre y el RUT
// del negocio). Con la sesión lista, pasa a la misma compra en grupo de /app (una sola experiencia de compra), con el
// `?ref=` de "Trae a tu vecino" para que /app lo registre.

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { Acceso } from '../canal/Acceso.tsx';
import { estaAbierta, licitacionVigente } from '../canal/logica.ts';
import { useCanal, useSesion } from '../canal/useCanal.ts';
import { enlaceCompra } from '../comprador/ComprasEnGrupo.tsx';
import { BotonTema } from '../marca/BotonTema.tsx';
import { EstadoVacio } from '../marca/componentes.tsx';
import { Logo } from '../marca/Logo.tsx';
import { ICONO_FLUJO } from '../marca/recursos.ts';
import type { Fuente } from '../red/tipos.ts';
import { useAhora } from '../red/useRed.ts';
import '../comprador/comprador.css';
import './unirse.css';

/** El marco de marca de /unirse: logo, aviso de datos de prueba, sol/luna y la nota del modo demo al pie. */
function MarcoUnirse({ fuente, children }: { fuente: Fuente; children: ReactNode }) {
  return (
    <main className="bando-ui bm-unirse">
      <header className="bm-unirse-superior">
        <Logo className="bm-unirse-logo" />
        <BotonTema className="bm-boton-icono" />
      </header>
      {children}
      <footer className="bm-unirse-pie">
        <p className="bm-pie">Modo demo: las facturas se emiten en el ambiente de certificación del SII.</p>
        <AvisoFuente fuente={fuente} />
      </footer>
    </main>
  );
}

/** A dónde sigue quien ya tiene sesión: la compra en grupo de /app, en el primer producto de la compra del QR. */
export const destinoEnApp = (licitacionId: string, productoId: string | undefined, busqueda: string): string =>
  `/app${busqueda}${productoId ? enlaceCompra(licitacionId, productoId) : '#compra'}`;

export function Unirse() {
  const { api, config, foto, fuente } = useCanal();
  const ahora = useAhora();
  const { token, entrar } = useSesion(api);
  const idPedido = useRef(new URLSearchParams(location.search).get('licitacion'));
  const lic = foto ? foto.licitaciones.find(l => l.id === idPedido.current) ?? licitacionVigente(foto.licitaciones) : undefined;
  const abierta = lic ? estaAbierta(lic, ahora) : false;

  useEffect(() => {
    if (token && lic && abierta) location.replace(destinoEnApp(lic.id, lic.productos?.[0]?.id, location.search));
  }, [token, lic, abierta]);

  if (!api || !foto) return <Cargando bando />;
  if (!lic) {
    return (
      <MarcoUnirse fuente={fuente}>
        <EstadoVacio ilustracion={ICONO_FLUJO.comprarEnGrupo} titulo="No hay una compra en grupo abierta"
          texto="Vuelve a escanear el código cuando parta la próxima." />
      </MarcoUnirse>
    );
  }
  if (!abierta) {
    return (
      <MarcoUnirse fuente={fuente}>
        <EstadoVacio ilustracion={ICONO_FLUJO.comprarEnGrupo} titulo="Esta compra en grupo ya cerró"
          texto="Te avisamos cuando parta la próxima." />
      </MarcoUnirse>
    );
  }
  if (token) return <Cargando bando />;
  return <Acceso api={api} config={config} fuente={fuente} titulo="Entra para sumarte a la compra en grupo"
    bajada="Cada producto baja de precio cuando el grupo junta más unidades." onEntrar={entrar} />;
}
