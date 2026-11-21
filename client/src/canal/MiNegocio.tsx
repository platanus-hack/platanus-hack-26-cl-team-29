// /app: "Mi negocio", el canal web del comprador. Las mismas acciones que por WhatsApp:
// sumarse a la compra conjunta, pedir a un proveedor, recibir o reclamar en el SII, ver las facturas y su crédito Bando.

import { useCallback, useEffect, useState } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { dinero, nota } from '../../../shared/formato.ts';
import { totalOrden } from '../../../shared/precios.ts';
import { contar, cuantos } from '../../../shared/texto.ts';
import { puedeVender } from '../../../shared/red.ts';
import type { Documento, Negocio } from '../red/tipos.ts';
import type { CanalApi } from './api.ts';
import {
  cicloDelPedido, licitacionVigente, unidadPara, montoNotaCredito,
  type Unidad,
} from './logica.ts';
import { Icono, iconoDeProducto, LogoSii, Monograma } from './iconos.tsx';
import { Acceso, CargandoCuenta } from './Acceso.tsx';
import { AvisoCompraAbierta } from './AvisoCompra.tsx';
import { Invitar } from './Invitar.tsx';
import { MiCredito } from './MiCredito.tsx';
import { BotonWhatsapp, Cantidad, Confirmar, ListaDocumentos, useConfirmacion, useEnvio, Vacio } from './piezas.tsx';
import type { ConfigRed, FotoRed, OrdenCanal, YoComprador } from './tipos.ts';
import { useCanal, useDatosConSesion, useSesion } from './useCanal.ts';
import { Marco, type SeccionMarco } from '../comprador/Marco.tsx';
import { Inicio } from '../comprador/Inicio.tsx';
import { ComprasEnGrupo } from '../comprador/ComprasEnGrupo.tsx';
import './canal.css';

/** Copia del catálogo de la red (server/red/catalogo.ts). El producto de la compra conjunta se compra en su sección. */
const CATALOGO = ['Harina 25 kg', 'Levadura 500 g', 'Azúcar 25 kg', 'Manteca 10 kg', 'Sal 25 kg'];

type Seccion = 'inicio' | 'compra' | 'pedidos' | 'pedir' | 'facturas' | 'credito';
const SECCIONES: ReadonlyArray<SeccionMarco<Seccion>> = [
  { id: 'inicio', titulo: 'Inicio', icono: 'tienda' }, { id: 'compra', titulo: 'Compras en grupo', corto: 'Compras', icono: 'grupo' },
  { id: 'pedidos', titulo: 'Pedidos', icono: 'paquete' }, { id: 'pedir', titulo: 'Pedir', icono: 'carro' },
  { id: 'facturas', titulo: 'Facturas', icono: 'documento' }, { id: 'credito', titulo: 'Crédito', icono: 'tarjeta' },
];

/** `#compra/rollos` → la compra en grupo con ese producto abierto. Sin hash, la portada. */
const rutaDelHash = (): { seccion: Seccion; productoId?: string } => {
  const [s, productoId] = location.hash.slice(1).split('/');
  const seccion = SECCIONES.find(x => x.id === s)?.id ?? 'inicio';
  return seccion === 'compra' && productoId ? { seccion, productoId: decodeURIComponent(productoId) } : { seccion };
};

const cantidadEn = (n: number, u: Unidad) => contar(n, u.singular, u.plural);

export function MiNegocio() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const { token, entrar, vencer, salir } = useSesion(api);
  const [{ seccion, productoId }, setRuta] = useState(rutaDelHash);

  useEffect(() => {
    const alCambiar = () => { setRuta(rutaDelHash()); scrollTo(0, 0); };
    addEventListener('hashchange', alCambiar);
    return () => removeEventListener('hashchange', alCambiar);
  }, []);

  const { datos: yo, error, recargar } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), vencer);

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  if (!token) {
    return (
      <Acceso api={api} config={config} fuente={fuente} titulo="Compra junto a otros negocios y paga menos"
        bajada="Tus compras en grupo, pedidos y facturas del SII en un solo lugar." onEntrar={entrar} />
    );
  }
  if (!yo) return <main className="cn-pagina"><CargandoCuenta error={error} texto="Cargando tu negocio..." onSalir={salir} /></main>;

  const irA = (s: Seccion) => { location.hash = s; };
  const porRecibir = yo.ordenes.filter(o => o.estado === 'facturada').length;
  const vigente = licitacionVigente(foto.licitaciones);
  const participa = yo.participaciones.some(p => p.licitacionId === vigente?.id);
  const secciones = SECCIONES.map(s => (s.id === 'pedidos' ? { ...s, globo: porRecibir } : s));

  return (
    <Marco secciones={secciones} activa={seccion} negocio={yo.negocio} aviso={<AvisoFuente fuente={fuente} />} onSalir={salir}>
      {error && <p className="bm-error">{error}</p>}
      {seccion === 'inicio' && <Inicio foto={foto} yo={yo} config={config} secciones={SECCIONES} evento={cambio} />}
      {seccion === 'compra' && <ComprasEnGrupo api={api} token={token} foto={foto} yo={yo} productoId={productoId} />}
      {seccion === 'compra' && !productoId && vigente && participa && (
        <div className="puente-legado"><Invitar token={token} modo={api.modo} nombre={yo.negocio.nombre} /></div>
      )}
      {seccion !== 'inicio' && seccion !== 'compra' && (
        // Secciones aún sin rediseñar: el puente les da la paleta y la tipografía de la marca (DESIGN.md).
        <div className="puente-legado cn-contenido">
          <AvisoCompraAbierta lic={vigente} participa={participa} irACompra={() => irA('compra')} />
          {seccion === 'pedir' && <Pedir api={api} token={token} foto={foto} config={config} alEnviar={() => { recargar(); irA('pedidos'); }} />}
          {seccion === 'pedidos' && <MisPedidos api={api} token={token} foto={foto} yo={yo} config={config} alCambiar={recargar} irAPedir={() => irA('pedir')} />}
          {seccion === 'facturas' && <MisFacturas foto={foto} yo={yo} />}
          {seccion === 'credito' && <MiCredito api={api} token={token} foto={foto} cambio={cambio} />}
          <BotonWhatsapp numero={config?.whatsappNumero} />
        </div>
      )}
    </Marco>
  );
}

// ---------- Pedir ----------

function Pedir({ api, token, foto, config, alEnviar }: {
  api: CanalApi; token: string; foto: FotoRed; config: ConfigRed | null; alEnviar: () => void;
}) {
  const delaCompra = licitacionVigente(foto.licitaciones)?.proveedorId;
  const logoDe = (id: string) => (id === delaCompra ? config?.proveedorLogoUrl : undefined);
  const proveedores = foto.negocios
    .filter(puedeVender)
    .map(n => ({ negocio: n, nota: foto.notas.find(x => x.proveedorId === n.id)?.nota }))
    .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0));
  const [producto, setProducto] = useState(CATALOGO[0]);
  const [cantidad, setCantidad] = useState(4);
  const [proveedorId, setProveedorId] = useState(proveedores[0]?.negocio.id ?? '');
  const { enviando, error, setError, enviar: enviarA } = useEnvio();
  const [enviada, setEnviada] = useState<{ proveedor: string; detalle: string; total: number } | null>(null);
  const u = unidadPara(producto, config);
  const proveedor = proveedores.find(p => p.negocio.id === proveedorId)?.negocio;

  if (!proveedores.length) return <Vacio titulo="Todavía no hay proveedores en la red" texto="Cuando se sume el primero, podrás pedirle desde aquí." />;

  const enviar = () => {
    if (!proveedor || !producto) return setError('Elige un producto y un proveedor.');
    void enviarA(async () => {
      const orden = await api.pedir(token, proveedor.id, [{ producto, cantidad }]);
      setEnviada({ proveedor: proveedor.nombre, detalle: `${cantidadEn(cantidad, u)} de ${producto}`, total: totalOrden(orden) });
    }, 'No pudimos enviar la orden. Inténtalo de nuevo.');
  };

  if (enviada) {
    return (
      <section className="cn-seccion">
        <div className="tarjeta">
          <p className="etiqueta verde">Orden de compra enviada</p>
          <p className="cn-texto-grande">Listo, enviamos la orden de compra a {enviada.proveedor}: {enviada.detalle}{enviada.total > 0 ? `, ${dinero(enviada.total)}` : ''}.</p>
          <p className="mono tenue">Te avisamos aquí cuando llegue la factura.</p>
          <button type="button" className="boton cn-ancho" onClick={alEnviar}>Ver mis pedidos</button>
          <button type="button" className="cn-boton-texto" onClick={() => setEnviada(null)}>Hacer otro pedido</button>
        </div>
      </section>
    );
  }

  return (
    <section className="cn-seccion">
      <div className="tarjeta">
        <p className="etiqueta">1. ¿Qué necesitas?</p>
        <div className="cn-opciones" role="radiogroup" aria-label="Producto">
          {CATALOGO.map(p => (
            <button key={p} type="button" role="radio" aria-checked={p === producto} className={`cn-opcion${p === producto ? ' elegida' : ''}`} onClick={() => setProducto(p)}>
              <Icono nombre={iconoDeProducto(p)} />
              {p}
            </button>
          ))}
        </div>
        <p className="etiqueta cn-sub">¿{cuantos(u.plural)} {u.plural}?</p>
        <Cantidad valor={cantidad} max={500} onCambio={setCantidad} etiqueta="Cantidad" />
      </div>

      <div className="tarjeta">
        <p className="etiqueta">2. ¿A quién? Los mejor evaluados primero</p>
        <ul className="cn-proveedores" role="radiogroup" aria-label="Proveedor">
          {proveedores.map(({ negocio, nota: n }, i) => (
            <li key={negocio.id}>
              <button type="button" role="radio" aria-checked={negocio.id === proveedorId} className={`cn-proveedor${negocio.id === proveedorId ? ' elegida' : ''}`} onClick={() => setProveedorId(negocio.id)}>
                <Monograma nombre={negocio.nombre} logoUrl={logoDe(negocio.id)} rubro={false} />
                <span className="cn-proveedor-nombre">
                  <strong className="nombre">{negocio.nombre}</strong>
                  <span className="mono tenue">{negocio.comuna}{i === 0 && n !== undefined ? ' · mejor nota' : ''}</span>
                </span>
                <span className="cn-nota">{n !== undefined ? nota(n) : 'nuevo'}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mono tenue cn-nota-pie cn-sub">El proveedor pone el precio y te llega la factura del SII con su guía de despacho.</p>
      </div>

      <div className="tarjeta cn-resumen-pedido">
        <p className="cn-texto"><strong>{cantidadEn(cantidad, u)}</strong> de {producto} a <strong>{proveedor?.nombre}</strong></p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="boton cn-ancho" onClick={enviar} disabled={enviando}>{enviando ? 'Enviando...' : 'Enviar orden de compra'}</button>
      </div>
    </section>
  );
}

// ---------- Mis pedidos ----------

function MisPedidos({ api, token, foto, yo, config, alCambiar, irAPedir }: {
  api: CanalApi; token: string; foto: FotoRed; yo: YoComprador; config: ConfigRed | null; alCambiar: () => void; irAPedir: () => void;
}) {
  const ordenes = [...yo.ordenes].sort((a, b) =>
    Number(b.estado === 'facturada') - Number(a.estado === 'facturada') || Date.parse(b.creadaEn) - Date.parse(a.creadaEn));
  if (!ordenes.length) {
    return <Vacio titulo="Todavía no tienes pedidos" texto="Pide a un proveedor o súmate a la compra conjunta: tus pedidos y su avance aparecen aquí." accion="Hacer un pedido" onAccion={irAPedir} />;
  }
  return (
    <section className="cn-seccion">
      {ordenes.map(o => (
        <TarjetaPedido key={o.id} api={api} token={token} orden={o} yo={yo} proveedor={foto.negocios.find(n => n.id === o.proveedorId)} config={config} alCambiar={alCambiar} />
      ))}
    </section>
  );
}

type AccionRecepcion = { faltante: number };

function TarjetaPedido({ api, token, orden, yo, proveedor, config, alCambiar }: {
  api: CanalApi; token: string; orden: OrdenCanal; yo: YoComprador; proveedor?: Negocio; config: ConfigRed | null; alCambiar: () => void;
}) {
  const item = orden.items[0];
  const u = unidadPara(item?.producto ?? '', config);
  const ciclo = cicloDelPedido(orden, yo.documentos, u);
  const [faltaron, setFaltaron] = useState(false);
  const [faltante, setFaltante] = useState(1);
  const { enviando, error, enviar } = useEnvio();
  const factura = yo.documentos.find(d => d.ordenId === orden.id && d.tipo === 33);
  const nc = yo.documentos.find(d => d.ordenId === orden.id && d.tipo === 61);

  const reclamar = useCallback(async ({ faltante: f }: AccionRecepcion) => {
    await api.recepcion(token, orden.id, { faltante: f, confirmado: true });
    setFaltaron(false);
    alCambiar();
  }, [api, token, orden.id, alCambiar]);
  const reclamo = useConfirmacion(reclamar);

  const llegoTodo = () => enviar(async () => {
    await api.recepcion(token, orden.id, { conforme: true, confirmado: true });
    alCambiar();
  }, 'No pudimos registrarlo. Inténtalo de nuevo.');

  return (
    <article className={`tarjeta cn-pedido ${orden.estado}`}>
      <header className="cn-pedido-cabecera">
        <div>
          <p className="etiqueta cn-con-sii"><Monograma nombre={proveedor?.nombre ?? 'Proveedor'} tam={24} rubro={false} />{proveedor?.nombre ?? 'Proveedor'}</p>
          <h3>{item?.producto ?? 'Pedido'}</h3>
          <p className="mono tenue">
            {item ? `${cantidadEn(item.cantidad, u)} · ` : ''}{dinero(totalOrden(orden))} neto{orden.licitacionId ? ' · compra conjunta' : ''}
          </p>
        </div>
        <span className={`cn-chip ${orden.estado}`}>{ciclo.resumen}</span>
      </header>

      <ol className="cn-ciclo">
        {ciclo.pasos.map((p, i) => (
          <li key={p.titulo} className={`${p.estado}${i === 2 || i === 4 ? ' sii' : ''}`}>
            <span className="cn-punto" aria-hidden="true" />
            <span className="cn-paso-titulo">{p.titulo}{(i === 2 || i === 4) && <LogoSii tam={14} />}</span>
            <span className="cn-paso-detalle">{p.detalle}</span>
          </li>
        ))}
      </ol>

      {ciclo.accion === 'recibir' && reclamo.estado.fase === 'nada' && !faltaron && (
        <div className="cn-pregunta">
          <p className="cn-texto-grande">¿Recibiste todo?</p>
          <p className="mono tenue">Llegó la factura{factura?.folio ? ` folio ${factura.folio}` : ''} de {proveedor?.nombre ?? 'tu proveedor'} con su guía de despacho.</p>
          {error && <p className="error">{error}</p>}
          <div className="cn-acciones">
            <button type="button" className="boton" onClick={llegoTodo} disabled={enviando}>{enviando ? 'Enviando...' : 'Sí, llegó todo'}</button>
            <button type="button" className="boton secundario cn-secundario" onClick={() => { setFaltaron(true); setFaltante(1); }} disabled={enviando}>Me faltaron unidades</button>
          </div>
        </div>
      )}

      {ciclo.accion === 'recibir' && faltaron && reclamo.estado.fase === 'nada' && item && (
        <div className="cn-pregunta">
          <p className="cn-texto-grande">¿{cuantos(u.plural)} {u.plural} faltaron?</p>
          <Cantidad valor={faltante} max={item.cantidad} onCambio={setFaltante} etiqueta="Cantidad que faltó" />
          <div className="cn-acciones">
            <button type="button" className="boton" onClick={() => reclamo.pedir({ faltante })}>Seguir</button>
            <button type="button" className="cn-boton-texto" onClick={() => setFaltaron(false)}>Volver</button>
          </div>
        </div>
      )}

      {reclamo.estado.fase !== 'nada' && item && (
        <Confirmar
          sii
          titulo="¿Reclamamos la factura en el SII?"
          si="Sí, reclámala"
          {...reclamo.panel}
        >
          <p>
            Reclamamos la factura{factura?.folio ? ` folio ${factura.folio}` : ''} por falta parcial:{' '}
            {reclamo.estado.accion.faltante === 1 ? 'faltó' : 'faltaron'} {reclamo.estado.accion.faltante} de {cantidadEn(item.cantidad, u)}.
          </p>
          <p>{proveedor?.nombre ?? 'El proveedor'} tendrá que emitirte una nota de crédito por {dinero(reclamo.estado.accion.faltante * item.precioUnitario)}.</p>
        </Confirmar>
      )}

      {orden.estado === 'reclamada' && (
        <p className="cn-aviso-sii cn-con-sii"><LogoSii /> Reclamado en el SII. Esperando la nota de crédito de {proveedor?.nombre ?? 'tu proveedor'}.</p>
      )}
      {orden.estado === 'corregida' && (
        <p className="cn-ok cn-con-sii">
          <LogoSii />
          Nota de crédito recibida{nc?.folio ? `, folio ${nc.folio}` : ''}: {dinero(montoNotaCredito(orden, yo.documentos))} por{' '}
          {cantidadEn(orden.reclamo?.faltante ?? 0, u)} que {orden.reclamo?.faltante === 1 ? 'faltó' : 'faltaron'}. Quedó amarrada a tu factura en el SII.
        </p>
      )}
    </article>
  );
}

// ---------- Mis facturas ----------

function MisFacturas({ foto, yo }: { foto: FotoRed; yo: YoComprador }) {
  const docs = yo.documentos.filter(d => d.tipo === 33 || d.tipo === 61);
  if (!docs.length) {
    return <Vacio titulo="Todavía no tienes facturas" texto="Cuando un proveedor confirme tu pedido, su factura del SII aparece aquí con su estado." />;
  }
  const proveedorDe = (d: Documento) => {
    const orden = yo.ordenes.find(o => o.id === d.ordenId);
    return foto.negocios.find(n => n.id === orden?.proveedorId)?.nombre ?? 'Proveedor';
  };
  return (
    <section className="cn-seccion">
      <ListaDocumentos documentos={docs} contraparte={proveedorDe} />
      <p className="mono tenue cn-nota-pie">Montos netos. Cada documento queda registrado en el SII.</p>
    </section>
  );
}
