// /app: "Mi negocio", el canal web del comprador: iniciar o sumarse a compras en grupo, ver los proveedores de la red,
// la recepción de sus pedidos, sus documentos del SII y su crédito Bando. Se compra en grupo: no hay pedidos directos a un proveedor.
import { AvisoFuente } from '../components/Cabecera.tsx';
import { licitacionVigente } from './logica.ts';
import { Acceso, CargandoCuenta } from './Acceso.tsx';
import { AvisoCompraAbierta } from './AvisoCompra.tsx';
import { Invitar, useInvitacionRecibida } from './Invitar.tsx';
import { MiCredito } from './MiCredito.tsx';
import { BotonWhatsapp } from './piezas.tsx';
import { useCanal, useDatosConSesion, useSesion } from './useCanal.ts';
import { Marco, useRutaDelHash, type SeccionMarco } from '../comprador/Marco.tsx';
import { Inicio } from '../comprador/Inicio.tsx';
import { ComprasEnGrupo, rutaDeCompra, type RutaCompra } from '../comprador/ComprasEnGrupo.tsx';
import { Proveedores, rutaDeProveedor } from '../comprador/Proveedores.tsx';
import { Sii } from '../comprador/Sii.tsx';
import { Recepcion } from '../comprador/Recepcion.tsx';
import { puedeVender } from '../../../shared/red.ts';
import './canal.css';

type Seccion = 'inicio' | 'compra' | 'proveedores' | 'recepcion' | 'facturas' | 'credito';
const SECCIONES: ReadonlyArray<SeccionMarco<Seccion>> = [
  { id: 'inicio', titulo: 'Inicio', icono: 'inicio' }, { id: 'compra', titulo: 'Compras en grupo', corto: 'Compras', icono: 'grupo' },
  { id: 'proveedores', titulo: 'Proveedores', icono: 'proveedores' }, { id: 'recepcion', titulo: 'Recepción', icono: 'recepcion' },
  { id: 'facturas', titulo: 'SII', icono: 'facturas' }, { id: 'credito', titulo: 'Crédito', icono: 'stock' },
];

/** `#compra/...` → la lista, iniciar una o un producto (ver `rutaDeCompra`); `#proveedores/<clave>` → su ficha. Sin hash, la portada. */
const rutaDelHash = (): { seccion: Seccion; compra: RutaCompra; ficha: string | null } => {
  const [s, ...resto] = location.hash.slice(1).split('/');
  return { seccion: SECCIONES.find(x => x.id === s)?.id ?? 'inicio', compra: rutaDeCompra(resto), ficha: s === 'proveedores' ? rutaDeProveedor(resto) : null };
};


export function MiNegocio() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const { token, entrar, vencer, salir } = useSesion(api);
  const { seccion, compra, ficha } = useRutaDelHash(rutaDelHash);

  const { datos: yo, error } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), vencer);
  useInvitacionRecibida(token, api?.modo); // llegó desde /unirse?ref=<código> de otro negocio ("Trae a tu vecino")

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  if (!token) {
    return (
      <Acceso api={api} config={config} fuente={fuente} titulo="Compra junto a otros negocios y paga menos"
        bajada="Tus compras en grupo, proveedores y facturas del SII en un solo lugar." onEntrar={entrar} />
    );
  }
  if (!yo) return <main className="cn-pagina"><CargandoCuenta error={error} texto="Cargando tu negocio..." onSalir={salir} /></main>;

  const irA = (s: Seccion) => { location.hash = s; };
  const vigente = licitacionVigente(foto.licitaciones);
  const participa = yo.participaciones.some(p => p.licitacionId === vigente?.id);

  return (
    <Marco secciones={SECCIONES} activa={seccion} negocio={yo.negocio} aviso={<AvisoFuente fuente={fuente} />} onSalir={salir}>
      {error && <p className="bm-error">{error}</p>}
      {seccion === 'inicio' && <Inicio foto={foto} negocio={yo.negocio} ordenes={yo.ordenes} documentos={yo.documentos} config={config} secciones={SECCIONES} evento={cambio} desde="comprar" />}
      {seccion === 'compra' && <ComprasEnGrupo api={api} token={token} foto={foto} yo={yo} ruta={compra} />}
      {seccion === 'compra' && compra.vista === 'lista' && vigente && participa && (
        <Invitar token={token} modo={api.modo} nombre={yo.negocio.nombre} />
      )}
      {seccion === 'proveedores' && <Proveedores foto={foto} yo={yo} cambio={cambio} ficha={ficha} />}
      {seccion === 'recepcion' && <Recepcion api={api} token={token} ordenes={yo.ordenes} negocios={foto.negocios} />}
      {seccion === 'facturas' && (
        <Sii api={api} token={token} cambio={cambio} negocios={foto.negocios} panel="comprador" vende={puedeVender(yo.negocio)} compra vencer={vencer} />
      )}
      {seccion === 'credito' && (
        <div className="bm-credito">
          <header className="bm-cabecera">
            <div>
              <h1 className="bm-titulo">Crédito</h1>
              <p className="bm-bajada">Compra hoy y paga a plazo. Bando le paga al proveedor al instante.</p>
            </div>
          </header>
          <AvisoCompraAbierta lic={vigente} participa={participa} irACompra={() => irA('compra')} />
          <MiCredito api={api} token={token} foto={foto} cambio={cambio} />
          <BotonWhatsapp numero={config?.whatsappNumero} />
        </div>
      )}
    </Marco>
  );
}
