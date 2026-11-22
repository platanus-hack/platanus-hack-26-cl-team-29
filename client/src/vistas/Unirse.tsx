// /unirse: la página del QR. La primera vez se entra con el número de WhatsApp y un código (y, si el número es nuevo,
// el nombre y el RUT del negocio); después muestra el carrito de la canasta. Quien vuelve ve su carrito de inmediato.
// Con la marca Bando (DESIGN.md): el carrito y el botón de WhatsApp aún son piezas anteriores, en `.puente-legado`.

import type { ReactNode } from 'react';
import { useRef } from 'react';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { Acceso, CargandoCuenta } from '../canal/Acceso.tsx';
import { CarritoCompra, FacturaANombre, resumenGrupo, ultimoEnSumarse } from '../canal/Carrito.tsx';
import { estaAbierta, licitacionVigente } from '../canal/logica.ts';
import { BotonWhatsapp } from '../canal/piezas.tsx';
import { useCanal, useDatosConSesion, useSesion } from '../canal/useCanal.ts';
import { useInvitacionRecibida } from '../canal/Invitar.tsx';
import { BotonTema } from '../marca/BotonTema.tsx';
import { BotonEnlace, Cifra, EstadoVacio } from '../marca/componentes.tsx';
import { Logo } from '../marca/Logo.tsx';
import { ICONO_FLUJO } from '../marca/recursos.ts';
import { contar } from '../../../shared/texto.ts';
import type { Fuente } from '../red/tipos.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import '../canal/canal.css';
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

export function Unirse() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const ahora = useAhora();
  const { token, entrar, vencer, salir } = useSesion(api);
  const { datos: yo, error } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), vencer);
  useInvitacionRecibida(token, api?.modo); // llegó con ?ref=<código> de otro negocio ("Trae a tu vecino")
  const idPedido = useRef(new URLSearchParams(location.search).get('licitacion'));

  if (!api || !foto) return <Cargando bando />;
  const lic = foto.licitaciones.find(l => l.id === idPedido.current) ?? licitacionVigente(foto.licitaciones);

  if (!lic) {
    return (
      <MarcoUnirse fuente={fuente}>
        <EstadoVacio ilustracion={ICONO_FLUJO.comprarEnGrupo} titulo="No hay una compra en grupo abierta"
          texto="Vuelve a escanear el código cuando parta la próxima." />
      </MarcoUnirse>
    );
  }

  const abierta = estaAbierta(lic, ahora);
  if (!token && abierta) {
    return <Acceso api={api} config={config} fuente={fuente} titulo="Entra para sumarte a la compra en grupo"
      bajada="Cada producto baja de precio cuando el grupo junta más unidades." onEntrar={entrar} />;
  }
  const g = resumenGrupo(lic);
  const nuevo = ultimoEnSumarse(lic, yo?.negocio.id, ahora);
  const mia = yo?.participaciones.find(p => p.licitacionId === lic.id);

  return (
    <MarcoUnirse fuente={fuente}>
      <header className="bm-cabecera">
        <div>
          <p className="bm-etiqueta">{abierta ? <span className="bm-en-vivo">En vivo</span> : 'Cerrada'}</p>
          <h1 className="bm-titulo">Compra en grupo</h1>
          <p className="bm-bajada">{g.negocios > 0 ? `${contar(g.negocios, 'negocio')} · ${contar(g.unidades, 'unidad')}` : 'Sé el primero en sumarte.'}</p>
        </div>
        {abierta && <Cifra etiqueta="Cierra en" valor={cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)} tamano="grande" tono="miel" />}
      </header>
      {nuevo?.nombre && <p key={`${nuevo.nombre}-${nuevo.en}`} className="bm-nota bm-unirse-sumo" role="status">{nuevo.nombre} se sumó a la compra</p>}

      {!token ? (
        <EstadoVacio ilustracion={ICONO_FLUJO.comprarEnGrupo} titulo="Esta compra en grupo ya cerró"
          texto="Te avisamos cuando parta la próxima." />
      ) : !yo ? (
        <div className="puente-legado"><CargandoCuenta error={error} texto="Cargando tu carrito..." onSalir={salir} /></div>
      ) : (
        <>
          <p className="bm-bajada">Comprando como <strong>{yo.negocio.nombre}</strong></p>
          <div className="puente-legado bm-unirse-carrito">
            <FacturaANombre factura={yo.facturaA} />
            <CarritoCompra api={api} token={token} lic={lic} negocioId={yo.negocio.id} participacion={mia} abierta={abierta} />
            <BotonWhatsapp numero={config?.whatsappNumero} />
          </div>
          <BotonEnlace variante="secundario" ancho href="/app">Ver mis pedidos y facturas</BotonEnlace>
        </>
      )}
    </MarcoUnirse>
  );
}
