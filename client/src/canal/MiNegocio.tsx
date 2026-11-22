// /app: "Mi negocio", el canal web del comprador: iniciar o sumarse a compras en grupo, ver los proveedores de la red,
// sus facturas del SII y su crédito Bando. Se compra en grupo: no hay pedidos directos a un proveedor.
import { AvisoFuente } from '../components/Cabecera.tsx';
import { licitacionVigente } from './logica.ts';
import { Acceso, CargandoCuenta } from './Acceso.tsx';
import { AvisoCompraAbierta } from './AvisoCompra.tsx';
import { Invitar } from './Invitar.tsx';
import { MiCredito } from './MiCredito.tsx';
import { BotonWhatsapp } from './piezas.tsx';
import { useCanal, useDatosConSesion, useSesion } from './useCanal.ts';
import { Marco, useRutaDelHash, type SeccionMarco } from '../comprador/Marco.tsx';
import { Inicio } from '../comprador/Inicio.tsx';
import { ComprasEnGrupo, rutaDeCompra, type RutaCompra } from '../comprador/ComprasEnGrupo.tsx';
import { Proveedores } from '../comprador/Proveedores.tsx';
import { Facturas } from '../comprador/Facturas.tsx';
import { puedeVender } from '../../../shared/red.ts';
import './canal.css';

type Seccion = 'inicio' | 'compra' | 'proveedores' | 'facturas' | 'credito';
const SECCIONES: ReadonlyArray<SeccionMarco<Seccion>> = [
  { id: 'inicio', titulo: 'Inicio', icono: 'tienda' }, { id: 'compra', titulo: 'Compras en grupo', corto: 'Compras', icono: 'grupo' },
  { id: 'proveedores', titulo: 'Proveedores', icono: 'camion' },
  { id: 'facturas', titulo: 'Facturas', icono: 'documento' }, { id: 'credito', titulo: 'Crédito', icono: 'tarjeta' },
];

/** `#compra/...` → la lista, iniciar una o un producto (ver `rutaDeCompra`). Sin hash, la portada. */
const rutaDelHash = (): { seccion: Seccion; compra: RutaCompra } => {
  const [s, ...resto] = location.hash.slice(1).split('/');
  return { seccion: SECCIONES.find(x => x.id === s)?.id ?? 'inicio', compra: rutaDeCompra(resto) };
};


export function MiNegocio() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const { token, entrar, vencer, salir } = useSesion(api);
  const { seccion, compra } = useRutaDelHash(rutaDelHash);

  const { datos: yo, error } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), vencer);

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
        <div className="puente-legado"><Invitar token={token} modo={api.modo} nombre={yo.negocio.nombre} /></div>
      )}
      {seccion === 'proveedores' && <Proveedores foto={foto} yo={yo} />}
      {seccion === 'facturas' && (
        <Facturas api={api} token={token} cambio={cambio} negocios={foto.negocios} vende={puedeVender(yo.negocio)} compra vencer={vencer} />
      )}
      {seccion === 'credito' && (
        // Secciones aún sin rediseñar: el puente les da la paleta y la tipografía de la marca (DESIGN.md).
        <div className="puente-legado cn-contenido">
          <AvisoCompraAbierta lic={vigente} participa={participa} irACompra={() => irA('compra')} />
          <MiCredito api={api} token={token} foto={foto} cambio={cambio} />
          <BotonWhatsapp numero={config?.whatsappNumero} />
        </div>
      )}
    </Marco>
  );
}
