// /proveedor: panel web del proveedor con la marca Bando (DESIGN.md, Paper "2 · Proveedor"). Las mismas acciones
// que por WhatsApp: cerrar y facturar la compra en grupo, confirmar y facturar pedidos, emitir notas de crédito y
// mantener su lista de productos con precios por cantidad. Parte en la misma portada que /app (comprar o vender). Ventas, Pedidos y Productos
// están rediseñados; Reparto y SII van por el puente.
import { useCallback, useState } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { BotonSii } from './ConectarSii.tsx';
import { Modal } from '../marca/Modal.tsx';
import { BandoTePago } from './MiCredito.tsx';
import { RutaReparto } from './RutaReparto.tsx';
import { estaAbierta, licitacionVigente } from './logica.ts';
import { useCanal, useDatosConSesion, useSesion } from './useCanal.ts';
import { Acceso, CargandoCuenta } from './Acceso.tsx';
import { Marco, useRutaDelHash, type SeccionMarco } from '../comprador/Marco.tsx';
import { Inicio } from '../comprador/Inicio.tsx';
import { Ventas } from '../proveedor/Ventas.tsx';
import { Pedidos } from '../proveedor/Pedidos.tsx';
import { Precios } from '../proveedor/Precios.tsx';
import { Productos } from '../proveedor/Productos.tsx';
import { Compras } from '../proveedor/Compras.tsx';
import { Sii } from '../comprador/Sii.tsx';
import { puedeComprar } from '../../../shared/red.ts';
import { contarPorGrupo } from '../proveedor/pedidos.ts';
import '../proveedor/proveedor.css';
import './canal.css';

type Seccion = 'inicio' | 'ventas' | 'compras' | 'pedidos' | 'productos' | 'reparto' | 'facturas';
const SECCIONES: ReadonlyArray<SeccionMarco<Seccion>> = [
  { id: 'inicio', titulo: 'Inicio', icono: 'tienda' }, { id: 'ventas', titulo: 'Ventas', icono: 'caja' },
  { id: 'compras', titulo: 'Pedidos en grupo', corto: 'En grupo', icono: 'grupo' },
  { id: 'pedidos', titulo: 'Pedidos', icono: 'paquete' },
  { id: 'productos', titulo: 'Productos', icono: 'etiqueta' }, { id: 'reparto', titulo: 'Reparto', icono: 'camion' },
  { id: 'facturas', titulo: 'SII', icono: 'documento' },
];

/** `#compras/L-3/cafe` → la sección y lo que viene después (el detalle de una compra). */
const rutaDelHash = (): { seccion: Seccion; resto: string[] } => {
  const [s, ...resto] = location.hash.slice(1).split('/');
  return { seccion: SECCIONES.find(x => x.id === s)?.id ?? 'inicio', resto };
};

export function Proveedor() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const { token, entrar, vencer, salir } = useSesion(api);
  const { datos: yo, error, recargar } = useDatosConSesion(api, token, cambio, (a, t) => a.yoProveedor(t), vencer);
  const { seccion, resto } = useRutaDelHash(rutaDelHash);

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  if (!token) {
    return <Acceso api={api} config={config} fuente={fuente} titulo="Vende a muchos negocios a la vez" onEntrar={entrar}
      bajada="Confirma pedidos, pon tus precios por volumen y factura en el SII. Entra con el WhatsApp de tu empresa." />;
  }
  if (!yo) return <main className="cn-pagina"><CargandoCuenta error={error} texto="Cargando tu panel..." onSalir={salir} /></main>;

  const lic = licitacionVigente(yo.licitaciones ?? foto.licitaciones);
  const comprador = (id: string) => foto.negocios.find(n => n.id === id);
  const props = { api, token, alCambiar: recargar };
  const cuenta = contarPorGrupo(yo.ordenes);
  const secciones = SECCIONES.map(s => (s.id === 'pedidos' ? { ...s, globo: cuenta.confirmar + cuenta.reclamos } : s));

  return (
    <Marco secciones={secciones} activa={seccion} negocio={yo.proveedor} aviso={<AvisoFuente fuente={fuente} />} onSalir={salir}>
      {error && <p className="bm-error">{error}</p>}
      {seccion === 'inicio' && (
        <Inicio foto={foto} negocio={yo.proveedor} ordenes={yo.ordenes} documentos={yo.documentos} config={config} secciones={SECCIONES} evento={cambio} desde="vender" />
      )}
      {seccion === 'ventas' && <Ventas {...props} yo={yo} lic={lic} config={config} comprador={comprador} />}
      {seccion === 'compras' && <Compras {...props} foto={foto} yo={yo} ruta={resto} />}
      {seccion === 'pedidos' && <Pedidos {...props} yo={yo} config={config} comprador={comprador} />}
      {seccion === 'productos' && (
        <>
          <Productos {...props} abierta={lic && estaAbierta(lic, Date.now()) ? lic : undefined} />
          {lic && <Precios {...props} lic={lic} yo={yo} />}
        </>
      )}
      {seccion === 'facturas' && (
        <Sii api={api} token={token} cambio={cambio} negocios={foto.negocios} panel="proveedor" vende compra={puedeComprar(yo.proveedor)} vencer={vencer}
          acciones={<>
            <BotonSii api={api} token={token} />
            <BotonPagos api={api} token={token} documentos={yo.documentos} cambio={cambio} />
          </>} />
      )}
      {seccion === 'reparto' && (
        // Sección aún sin rediseñar: el puente le da la paleta y la tipografía de la marca (DESIGN.md).
        <div className="puente-legado cn-contenido"><RutaReparto {...props} yo={yo} config={config} /></div>
      )}
    </Marco>
  );
}

/** "Pagos de Bando" en un modal, como el del SII: dónde te transferimos y lo que Bando ya te pagó. */
function BotonPagos(props: Parameters<typeof BandoTePago>[0]) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);
  return (
    <>
      <button type="button" className="bm-boton secundario" onClick={() => setAbierto(true)}>Pagos de Bando</button>
      {abierto && (
        <Modal titulo="Pagos de Bando" onCerrar={cerrar}>
          <div className="puente-legado"><BandoTePago {...props} /></div>
        </Modal>
      )}
    </>
  );
}
