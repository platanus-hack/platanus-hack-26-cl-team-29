// /proveedor: panel web del proveedor con la marca Bando (DESIGN.md, Paper "2 · Proveedor"). Las mismas acciones
// que por WhatsApp: cerrar y facturar la compra en grupo, confirmar y facturar pedidos, emitir notas de crédito y
// cambiar sus precios por volumen. Inicio, Pedidos y Precios están rediseñados; Reparto y Facturas van por el puente.

import { useEffect, useRef, useState } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { nota } from '../../../shared/formato.ts';
import type { Documento, Negocio } from '../red/tipos.ts';
import { ConectarSii } from './ConectarSii.tsx';
import { MiCatalogo } from './MiCatalogo.tsx';
import { BandoTePago } from './MiCredito.tsx';
import { RutaReparto } from './RutaReparto.tsx';
import { estaAbierta, licitacionVigente } from './logica.ts';
import { LogoSii } from './iconos.tsx';
import { ListaDocumentos, Vacio } from './piezas.tsx';
import type { YoProveedor } from './tipos.ts';
import { useCanal, useDatosConSesion, useSesion } from './useCanal.ts';
import { Acceso, CargandoCuenta } from './Acceso.tsx';
import { Marco, type SeccionMarco } from '../comprador/Marco.tsx';
import { InicioProveedor } from '../proveedor/Inicio.tsx';
import { Pedidos } from '../proveedor/Pedidos.tsx';
import { Precios } from '../proveedor/Precios.tsx';
import { contarPorGrupo } from '../proveedor/pedidos.ts';
import '../proveedor/proveedor.css';
import './canal.css';

type Seccion = 'inicio' | 'pedidos' | 'precios' | 'reparto' | 'facturas';
const SECCIONES: ReadonlyArray<SeccionMarco<Seccion>> = [
  { id: 'inicio', titulo: 'Inicio', icono: 'tienda' }, { id: 'pedidos', titulo: 'Pedidos', icono: 'paquete' },
  { id: 'precios', titulo: 'Precios', icono: 'etiqueta' }, { id: 'reparto', titulo: 'Reparto', icono: 'camion' },
  { id: 'facturas', titulo: 'Facturas', icono: 'documento' },
];

const seccionDelHash = (): Seccion => SECCIONES.find(x => x.id === location.hash.slice(1))?.id ?? 'inicio';

export function Proveedor() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const { token, entrar, vencer, salir } = useSesion(api);
  const { datos: yo, error, recargar } = useDatosConSesion(api, token, cambio, (a, t) => a.yoProveedor(t), vencer);
  const [seccion, setSeccion] = useState(seccionDelHash);

  useEffect(() => {
    const alCambiar = () => { setSeccion(seccionDelHash()); scrollTo(0, 0); };
    addEventListener('hashchange', alCambiar);
    return () => removeEventListener('hashchange', alCambiar);
  }, []);

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
      {seccion === 'inicio' && <InicioProveedor {...props} yo={yo} lic={lic} config={config} comprador={comprador} irA={s => { location.hash = s; }} />}
      {seccion === 'pedidos' && <Pedidos yo={yo} config={config} comprador={comprador} />}
      {seccion === 'precios' && (
        <>
          <Precios {...props} lic={lic} yo={yo} />
          <div className="puente-legado"><MiCatalogo api={api} token={token} abierta={lic && estaAbierta(lic, Date.now()) ? lic : undefined} /></div>
        </>
      )}
      {(seccion === 'reparto' || seccion === 'facturas') && (
        // Secciones aún sin rediseñar: el puente les da la paleta y la tipografía de la marca (DESIGN.md).
        <div className="puente-legado cn-contenido">
          {seccion === 'reparto' && <RutaReparto {...props} yo={yo} config={config} />}
          {seccion === 'facturas' && (
            <>
              <ConectarSii api={api} token={token} />
              <BandoTePago api={api} token={token} documentos={yo.documentos} cambio={cambio} />
              <MiNota yo={yo} />
              <MisDocumentos yo={yo} comprador={comprador} />
            </>
          )}
        </div>
      )}
    </Marco>
  );
}

// ---------- Nota y documentos ----------

/** La nota anterior: la que manda el backend o, si no la manda, la última distinta que vio esta pestaña. */
function useNotaAnterior(actual: number | null, delBackend?: number): number | undefined {
  const vista = useRef<{ actual: number | null; anterior?: number }>({ actual });
  if (vista.current.actual !== actual) vista.current = { actual, anterior: vista.current.actual ?? undefined };
  return delBackend ?? vista.current.anterior;
}

function MiNota({ yo }: { yo: YoProveedor }) {
  const anterior = useNotaAnterior(yo.nota, yo.notaAnterior);
  if (yo.nota === null) {
    return <Vacio titulo="Todavía no tienes nota" texto="Tu nota se calcula con tus entregas: cada entrega conforme suma y cada reclamo resta." />;
  }
  const cambio = anterior !== undefined ? Math.round((yo.nota - anterior) * 10) / 10 : 0;
  return (
    <section className="tarjeta cn-mi-nota">
      <p className="etiqueta">Mi nota en la red</p>
      <div className="cn-precio">
        <span className={`numero-grande ${cambio < 0 ? 'magenta' : cambio > 0 ? 'verde' : 'amarillo'}`}>{nota(yo.nota)}</span>
        {anterior !== undefined && cambio !== 0 && <span className="mono tachado">{nota(anterior)}</span>}
      </div>
      <p className="mono tenue cn-texto">
        {cambio < 0 ? `Bajó ${nota(-cambio)} con el último cambio. ` : cambio > 0 ? `Subió ${nota(cambio)} con el último cambio. ` : ''}
        Entrega conforme suma 0,1, reclamo resta 0,4 y nota de crédito el mismo día suma 0,2.
      </p>
    </section>
  );
}

function MisDocumentos({ yo, comprador }: { yo: YoProveedor; comprador: (id: string) => Negocio | undefined }) {
  const compradorDe = (d: Documento) => comprador(yo.ordenes.find(o => o.id === d.ordenId)?.compradorId ?? '')?.nombre ?? 'Cliente';
  return (
    <section className="cn-seccion">
      <h2 className="cn-titulo"><LogoSii tam={22} /> Mis documentos en el SII</h2>
      {yo.documentos.length
        ? <ListaDocumentos documentos={yo.documentos} contraparte={compradorDe} />
        : <p className="mono tenue cn-texto">Aquí aparecen tus facturas, guías y notas de crédito con su estado en el SII.</p>}
    </section>
  );
}
