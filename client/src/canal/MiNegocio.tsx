// /app: "Mi negocio", el canal web del comprador. Las mismas acciones que por WhatsApp:
// sumarse a la compra conjunta, pedir a un proveedor, recibir o reclamar en el SII y ver las facturas.

import { useCallback, useEffect, useState } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { dinero, nota } from '../../../shared/formato.ts';
import { totalOrden } from '../../../shared/precios.ts';
import { contar, cuantos } from '../../../shared/texto.ts';
import { puedeVender } from '../../../shared/red.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import type { Documento, Negocio } from '../red/tipos.ts';
import type { CanalApi } from './api.ts';
import {
  cicloDelPedido, estaAbierta, licitacionVigente, unidadPara, montoNotaCredito,
  type Unidad,
} from './logica.ts';
import { Icono, iconoDeProducto, LogoSii, Monograma, type NombreIcono } from './iconos.tsx';
import { CarritoCompra, FacturaANombre, FormularioNegocio, GrupoEnVivo } from './Carrito.tsx';
import { AvisoCompraAbierta } from './AvisoCompra.tsx';
import { BotonWhatsapp, Cantidad, Confirmar, ListaDocumentos, Marca, useConfirmacion, useEnvio, Vacio } from './piezas.tsx';
import type { ConfigRed, DatosEntrada, FotoRed, OrdenCanal, YoComprador } from './tipos.ts';
import { useCanal, useDatosConSesion, useSesionComprador } from './useCanal.ts';
import './canal.css';

/** Copia del catálogo de la red (server/red/catalogo.ts). El producto de la compra conjunta se compra en su sección. */
const CATALOGO = ['Harina 25 kg', 'Levadura 500 g', 'Azúcar 25 kg', 'Manteca 10 kg', 'Sal 25 kg'];

type Seccion = 'compra' | 'pedir' | 'pedidos' | 'facturas';
const SECCIONES: Array<[Seccion, string, NombreIcono]> = [
  ['compra', 'Compra conjunta', 'grupo'], ['pedir', 'Pedir', 'carro'], ['pedidos', 'Mis pedidos', 'paquete'], ['facturas', 'Mis facturas', 'documento'],
];

const seccionDelHash = (): Seccion => {
  const h = location.hash.slice(1);
  return SECCIONES.some(([s]) => s === h) ? (h as Seccion) : 'compra';
};

const cantidadEn = (n: number, u: Unidad) => contar(n, u.singular, u.plural);

export function MiNegocio() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const { token, entrar, alVencer, salir } = useSesionComprador(api);
  const [seccion, setSeccion] = useState<Seccion>(seccionDelHash);

  useEffect(() => {
    const alCambiar = () => setSeccion(seccionDelHash());
    addEventListener('hashchange', alCambiar);
    return () => removeEventListener('hashchange', alCambiar);
  }, []);

  const { datos: yo, error, recargar } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), alVencer);

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  if (!token) return <Bienvenida fuente={fuente} config={config} onEntrar={entrar} />;
  if (!yo) return <main className="cn-pagina"><p className={error ? 'error' : 'vacio'}>{error || 'Cargando tu negocio...'}</p></main>;

  const irA = (s: Seccion) => { location.hash = s; };
  const porRecibir = yo.ordenes.filter(o => o.estado === 'facturada').length;
  const vigente = licitacionVigente(foto.licitaciones);
  const participa = yo.participaciones.some(p => p.licitacionId === vigente?.id);

  return (
    <div className="cn-app">
      <header className="cn-cabecera">
        <Marca />
        <Monograma nombre={yo.negocio.nombre} />
        <div className="cn-quien">
          <strong className="nombre">{yo.negocio.nombre}</strong>
          <span className="mono tenue">{yo.negocio.comuna} <AvisoFuente fuente={fuente} /></span>
        </div>
        <button type="button" className="cn-boton-texto" onClick={salir}>Salir</button>
      </header>

      <nav className="cn-pestanas" aria-label="Secciones">
        {SECCIONES.map(([s, titulo, icono]) => (
          <a key={s} href={`#${s}`} className={s === seccion ? 'activa' : ''} aria-current={s === seccion ? 'page' : undefined}>
            <Icono nombre={icono} />
            <span>{titulo}</span>
            {s === 'pedidos' && porRecibir > 0 && <span className="cn-globo" aria-label={`${porRecibir} por revisar`}>{porRecibir}</span>}
          </a>
        ))}
      </nav>

      <main className="cn-contenido">
        {error && <p className="error">{error}</p>}
        {seccion !== 'compra' && <AvisoCompraAbierta lic={vigente} participa={participa} irACompra={() => irA('compra')} />}
        {seccion === 'compra' && <CompraConjunta api={api} token={token} foto={foto} yo={yo} />}
        {seccion === 'pedir' && <Pedir api={api} token={token} foto={foto} config={config} alEnviar={() => { recargar(); irA('pedidos'); }} />}
        {seccion === 'pedidos' && <MisPedidos api={api} token={token} foto={foto} yo={yo} config={config} alCambiar={recargar} irAPedir={() => irA('pedir')} />}
        {seccion === 'facturas' && <MisFacturas foto={foto} yo={yo} />}
        <BotonWhatsapp numero={config?.whatsappNumero} />
      </main>
    </div>
  );
}

// ---------- Bienvenida ----------

function Bienvenida({ fuente, config, onEntrar }: {
  fuente: ReturnType<typeof useCanal>['fuente']; config: ConfigRed | null; onEntrar: (datos: DatosEntrada) => Promise<void>;
}) {
  return (
    <main className="cn-pagina cn-bienvenida">
      <Marca><AvisoFuente fuente={fuente} /></Marca>
      <h1>Compra junto a otros negocios y paga menos</h1>
      <p className="cn-bajada">Tus compras conjuntas, pedidos y facturas del SII en un solo lugar.</p>
      <FormularioNegocio boton="Entrar" onEntrar={onEntrar} />
      <BotonWhatsapp numero={config?.whatsappNumero} />
      <p className="nota-demo">Modo demo: te sumas solo con tu RUT, sin cuenta. En uso real, cada negocio entra con su cuenta y su certificado digital conectado al SII.</p>
    </main>
  );
}

// ---------- Compra conjunta ----------

function CompraConjunta({ api, token, foto, yo }: { api: CanalApi; token: string; foto: FotoRed; yo: YoComprador }) {
  const ahora = useAhora();
  const lic = licitacionVigente(foto.licitaciones);
  if (!lic) {
    return <Vacio titulo="No hay una compra conjunta abierta" texto="Cuando parta una, aparece aquí con sus precios en vivo. Mientras tanto, puedes pedir directo a un proveedor." />;
  }
  const abierta = estaAbierta(lic, ahora);
  const mia = yo.participaciones.find(p => p.licitacionId === lic.id);
  return (
    <section className="cn-seccion">
      <div className="cn-compra-cabecera">
        <div className="cn-fila-meta">
          {abierta ? <span className="en-vivo">En vivo</span> : <span className="cn-chip">Cerrada</span>}
          {abierta && <span className="mono">cierra en {cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}</span>}
        </div>
        <h2 className="cn-titulo-compra">Compra conjunta</h2>
        <p className="mono tenue cn-grupo">Cada producto baja de precio cuando el grupo junta más unidades.</p>
        <FacturaANombre factura={yo.facturaA} />
      </div>
      {!abierta && mia && <p className="cn-ok">La compra cerró con tu carrito: tu pedido y su factura aparecen en Mis pedidos.</p>}
      <CarritoCompra api={api} token={token} lic={lic} negocioId={yo.negocio.id} participacion={mia} abierta={abierta} conPestanas />
      <GrupoEnVivo lic={lic} negocioId={yo.negocio.id} ahora={ahora} />
    </section>
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
