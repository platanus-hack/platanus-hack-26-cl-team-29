// /unirse: la página del QR. La primera vez se entra con el número de WhatsApp y un código (y, si el número es nuevo,
// el nombre y el RUT del negocio); después muestra el carrito de la canasta. Quien vuelve ve su carrito de inmediato.

import { useRef } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { Acceso } from '../canal/Acceso.tsx';
import { CarritoCompra, FacturaANombre, resumenGrupo, ultimoEnSumarse } from '../canal/Carrito.tsx';
import { estaAbierta, licitacionVigente } from '../canal/logica.ts';
import { BotonWhatsapp, Marca } from '../canal/piezas.tsx';
import { useCanal, useDatosConSesion, useSesion } from '../canal/useCanal.ts';
import { useInvitacionRecibida } from '../canal/Invitar.tsx';
import { contar } from '../../../shared/texto.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import '../canal/canal.css';

export function Unirse() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const ahora = useAhora();
  const { token, entrar, vencer } = useSesion(api);
  const { datos: yo, error } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), vencer);
  useInvitacionRecibida(token, api?.modo); // llegó con ?ref=<código> de otro negocio ("Trae a tu vecino")
  const idPedido = useRef(new URLSearchParams(location.search).get('licitacion'));

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  const lic = foto.licitaciones.find(l => l.id === idPedido.current) ?? licitacionVigente(foto.licitaciones);
  const aviso = <p className="nota-demo">Modo demo: las facturas se emiten en el ambiente de certificación del SII.</p>;

  if (!lic) {
    return (
      <main className="cn-pagina cn-unirse">
        <Marca><AvisoFuente fuente={fuente} /></Marca>
        <p className="vacio">No hay una compra conjunta abierta en este momento. Vuelve a escanear el código cuando parta la próxima.</p>
        {aviso}
      </main>
    );
  }

  const abierta = estaAbierta(lic, ahora);
  const g = resumenGrupo(lic);
  const nuevo = ultimoEnSumarse(lic, yo?.negocio.id, ahora);
  const mia = yo?.participaciones.find(p => p.licitacionId === lic.id);

  return (
    <main className="cn-pagina cn-unirse">
      <header className="cn-unirse-cabecera">
        <Marca><AvisoFuente fuente={fuente} /></Marca>
        <h1>Compra conjunta</h1>
        <div className="cn-fila-meta">
          {abierta ? <span className="en-vivo">En vivo</span> : <span className="cn-chip">Cerrada</span>}
          {abierta && <span className="mono">cierra en {cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}</span>}
          <span className="mono">{g.negocios > 0 ? `${contar(g.negocios, 'negocio')}, ${contar(g.unidades, 'unidad')}` : 'Sé el primero en sumarte'}</span>
        </div>
        {nuevo?.nombre && <p key={`${nuevo.nombre}-${nuevo.en}`} className="cn-se-sumo" role="status">{nuevo.nombre} se sumó a la compra</p>}
      </header>

      {!token ? (
        abierta ? (
          <>
            <Acceso api={api} config={config} fuente={fuente} titulo="Entra para elegir tus productos"
              bajada="Cada producto baja de precio cuando el grupo junta más unidades." onEntrar={entrar} />
            <BotonWhatsapp numero={config?.whatsappNumero} />
          </>
        ) : <p className="vacio">Esta compra conjunta ya cerró.</p>
      ) : !yo ? (
        <p className={error ? 'error' : 'vacio'}>{error || 'Cargando tu carrito...'}</p>
      ) : (
        <>
          <p className="cn-hola mono">Comprando como <strong>{yo.negocio.nombre}</strong></p>
          <FacturaANombre factura={yo.facturaA} />
          <CarritoCompra api={api} token={token} lic={lic} negocioId={yo.negocio.id} participacion={mia} abierta={abierta} />
          <BotonWhatsapp numero={config?.whatsappNumero} />
          <a className="cn-enlace-app" href="/app">Ver mis pedidos y facturas</a>
        </>
      )}
      {aviso}
    </main>
  );
}
