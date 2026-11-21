// /unirse: la página del QR. La primera vez pide solo el nombre del negocio (y, si quiere, comuna y rubro),
// crea la sesión web sin avisar y muestra el carrito de la canasta. Quien vuelve ve su carrito de inmediato.

import { useRef } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { CarritoCompra, FacturaANombre, FormularioNegocio, resumenGrupo, ultimoEnSumarse } from '../canal/Carrito.tsx';
import { estaAbierta, licitacionVigente } from '../canal/logica.ts';
import { BotonWhatsapp, Marca } from '../canal/piezas.tsx';
import { useCanal, useDatosConSesion, useSesionComprador } from '../canal/useCanal.ts';
import { useInvitacionRecibida } from '../canal/Invitar.tsx';
import { contar } from '../../../shared/texto.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import '../canal/canal.css';

export function Unirse() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const ahora = useAhora();
  const { token, entrar, alVencer } = useSesionComprador(api);
  const { datos: yo, error } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), alVencer);
  useInvitacionRecibida(token, api?.modo); // llegó con ?ref=<código> de otro negocio ("Trae a tu vecino")
  const idPedido = useRef(new URLSearchParams(location.search).get('licitacion'));

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  const lic = foto.licitaciones.find(l => l.id === idPedido.current) ?? licitacionVigente(foto.licitaciones);
  const aviso = <p className="nota-demo">Modo demo: te sumas solo con tu RUT, sin cuenta. En uso real, cada negocio entra con su cuenta y su certificado digital conectado al SII.</p>;

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
            <p className="cn-bajada">Elige lo que necesitas: cada producto baja de precio cuando el grupo junta más unidades.</p>
            <FormularioNegocio boton="Ver productos" onEntrar={entrar} />
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
