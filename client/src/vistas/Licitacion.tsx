import { useEffect, useState, type ReactNode } from 'react';
import { PanelPresentador } from '../components/PanelPresentador.tsx';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { CurvaPrecio } from '../components/CurvaPrecio.tsx';
import { TableroCanasta, useProductoDestacado } from '../components/Canasta.tsx';
import { Escalera } from '../components/Escalera.tsx';
import { Icono, iconoProducto, Monograma } from '../components/Iconos.tsx';
import { useFilasQueCaben } from '../components/medidas.ts';
import { Qr } from '../components/Qr.tsx';
import {
  estadoTramos, licitacionActual, licitacionDeProducto, licitacionesAbiertas, negocioPorId, productosDeCanasta, resumenLicitacion, tieneTramos, totalesCanasta,
  unidadDeLicitacion, type OfertaVista, type ProductoSala, type ResumenLicitacion, type TotalesCanasta,
} from '../red/derivar.ts';
import { dinero, nota } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { cuentaRegresiva, textoEstadoSii } from '../red/formato.ts';
import type { EstadoRed, Fuente, Licitacion as LicitacionRed } from '../red/tipos.ts';
import { useAhora, useConfigRed, useRed } from '../red/useRed.ts';
import { enlaceWhatsapp } from '../../../shared/telefono.ts';
import { Logo } from '../marca/Logo.tsx';
import { LogoSii } from '../marca/LogoSii.tsx';
import './licitacion.css';

function detalleOferta(o: OfertaVista): string {
  return `nota ${nota(o.nota)} · entrega en ${contar(o.plazoDias, 'día')}`;
}

/** Por qué pierde una oferta más barata: peor nota o, si no, entrega más lenta. */
function motivoRiesgo(o: OfertaVista, mejor?: OfertaVista): string {
  if (!mejor || o.nota < mejor.nota) return `Más barato, pero nota ${nota(o.nota)}: pierde`;
  return `Más barato, pero entrega en ${contar(o.plazoDias, 'día')}: pierde`;
}

/**
 * La marca en pantalla grande (DESIGN.md, "Modo proyección"): `.bando-proyeccion`, siempre oscura. Las piezas de
 * proyección (tarjeta, numero-grande, escalera, curva, ofertas) viven en estilos.css con los tokens anteriores;
 * licitacion.css se los da con los valores de la marca.
 */
function Proyeccion({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className="bando-proyeccion lic-fondo">
      <main className={`pagina lic-marca ${className}`}>{children}</main>
    </div>
  );
}

type Unidad = { singular: string; plural: string };

function Grupo({ lic, r, cerrada, unidad, canasta, whatsappNumero }: { lic: LicitacionRed; r: ResumenLicitacion; cerrada: boolean; unidad: Unidad; canasta?: TotalesCanasta; whatsappNumero: string | null }) {
  const [lista, caben] = useFilasQueCaben<HTMLUListElement>(8, r.compradores);
  const urlUnirse = `${location.origin}/unirse?licitacion=${encodeURIComponent(lic.id)}`;
  // Con número de WhatsApp, el QR abre el chat con el mensaje ya escrito: quien escribe primero abre la ventana de 24 h
  // (el sandbox no tiene plantillas) y el agente le toma el pedido ahí mismo. La web queda como alternativa debajo.
  const chat = whatsappNumero ? enlaceWhatsapp(whatsappNumero, `Quiero sumarme a la compra ${lic.id}`) : '';
  return (
    <section className="tarjeta apilada">
      <p className="etiqueta">Compradores en el grupo</p>
      <div className="grupo-total">
        <span className="numero-grande">{r.compradores}</span>
        {r.delPublico > 0 && <span className="mono verde">+{r.delPublico} del público</span>}
      </div>
      <p className="sacos">{canasta ? contar(canasta.unidades, 'unidad') : contar(r.totalUnidades, unidad.singular, unidad.plural)} en total</p>
      <ul className="lista-grupo ajustable" ref={lista}>
        {r.ultimos.slice(0, caben).map((p, i) => (
          <li key={`${r.compradores - i}`}>
            <Monograma nombre={p.nombre} rubro={p.rubro ?? true} />
            <span className="nombre">{p.nombre}</span>
            <span className="comuna">{p.comuna || '\u00a0'}</span>
            <span className="verde">+{p.detalle}</span>
          </li>
        ))}
      </ul>
      {!cerrada && (
        <div className="sumate">
          <h3>Súmate como almacén</h3>
          <div className="sumate-cuerpo">
            <Qr className="qr" texto={chat || urlUnirse} />
            <div>
              <p>{chat ? 'Escanea, envía el mensaje y pide por WhatsApp' : 'Escanea y mira cómo baja el precio'}</p>
              <p className="url">{chat ? 'o en ' : ''}{urlUnirse.replace(/^https?:\/\//, '').split('?')[0]}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Título de la columna del producto en foco: su ícono y su nombre corto. */
function DelProducto({ p }: { p?: ProductoSala }) {
  return p ? <span className="del-producto">· <Icono nombre={iconoProducto(p.nombre)} /><span className="del-producto-nombre">{p.corto}</span></span> : null;
}

function Ofertas({ r, cerrada, producto }: { r: ResumenLicitacion; cerrada: boolean; producto?: ProductoSala }) {
  const [lista, caben] = useFilasQueCaben<HTMLUListElement>(5, r.ofertas.length);
  return (
    <section className="tarjeta apilada">
      <p className="etiqueta lic-foco">Ofertas<DelProducto p={producto} /></p>
      {r.ofertas.length ? (
        <ul className="ofertas ajustable" ref={lista}>
          {r.ofertas.slice(0, caben).map(o => (
            <li key={o.proveedorId} className={`oferta ${o.gana ? 'gana' : ''} ${o.riesgo ? 'riesgo' : ''}`}>
              <div className="nombre-oferta"><Monograma nombre={o.proveedor} /><span className="nombre">{o.proveedor}</span></div>
              <div className="linea">
                <span className="precio">{dinero(o.precioUnitario)}</span>
                <span className="detalle">{detalleOferta(o)}</span>
              </div>
              <p className="aviso">
                {o.gana ? (cerrada ? 'Ganó la licitación' : 'Va ganando') : o.riesgo ? motivoRiesgo(o, r.mejor) : ' '}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vacio">Esperando la primera oferta.</p>
      )}
    </section>
  );
}

/** Las facturas 33 de esta compra: las órdenes de sus participantes con el proveedor de la compra (o cualquiera, sin uno fijo). */
function facturasDeLaCompra(lic: LicitacionRed, estado: EstadoRed) {
  const participantes = new Set(lic.participantes.map(p => p.negocioId));
  const ordenes = new Map(estado.ordenes
    .filter(o => participantes.has(o.compradorId) && (!lic.proveedorId || o.proveedorId === lic.proveedorId))
    .map(o => [o.id, o]));
  return estado.documentos
    .filter(d => d.tipo === 33 && ordenes.has(d.ordenId))
    .map(d => ({ d, comprador: negocioPorId(estado, ordenes.get(d.ordenId)!.compradorId)?.nombre ?? 'Negocio' }));
}

/** Al cerrar, el momento SII en grande: cada factura del lote con su folio y lo que dice el SII, en vivo. */
function FacturasSii({ facturas }: { facturas: ReturnType<typeof facturasDeLaCompra> }) {
  const [lista, caben] = useFilasQueCaben<HTMLUListElement>(5, facturas.length);
  return (
    <section className="tarjeta apilada lic-facturas">
      <p className="etiqueta lic-foco"><LogoSii /> {facturas.length ? `${contar(facturas.length, 'factura emitida', 'facturas emitidas')} en el SII` : 'Facturando en el SII'}</p>
      {facturas.length ? (
        <ul className="ofertas ajustable" ref={lista}>
          {facturas.slice(0, caben).map(({ d, comprador }) => (
            <li key={d.id} className="oferta">
              <div className="nombre-oferta"><Monograma nombre={comprador} /><span className="nombre">{comprador}</span></div>
              <div className="linea">
                <span className="precio">Folio {d.folio ?? '-'}</span>
                <span className="detalle lic-estado-sii"><LogoSii /> {textoEstadoSii(d.estadoSii)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vacio">El proveedor confirma y sale una factura por negocio en un solo envío.</p>
      )}
    </section>
  );
}

/** Toda la canasta: lo que paga y ahorra el grupo, y una fila por producto con quien va ganando. */
function Canasta({ lic, estado, productos, destacado, canasta }: {
  lic: LicitacionRed; estado: EstadoRed; productos: ProductoSala[]; destacado?: string; canasta: TotalesCanasta;
}) {
  return (
    <section className="tarjeta apilada lic-canasta">
      <div className="mejor-oferta">
        <div>
          <p className="etiqueta">El grupo paga hoy (neto)</p>
          <div className="numero-grande">{dinero(canasta.monto)}</div>
        </div>
        <div className="precio-solo">
          <p className="etiqueta">Y ahorra</p>
          <div className="numero-grande verde">{dinero(canasta.ahorro)}</div>
        </div>
      </div>
      <TableroCanasta productos={productos} destacado={destacado} logoEnSala={negocioPorId(estado, lic.proveedorId)?.logoUrl} />
    </section>
  );
}

/** La compra que se proyecta: `?licitacion=<id>` (el QR y "Proyectar" la ponen) o, sin ella, la que se está usando. */
function useLicitacionElegida(): [string | null, (id: string) => void] {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get('licitacion'));
  const elegir = (nuevo: string) => {
    const url = new URL(location.href);
    url.searchParams.set('licitacion', nuevo);
    history.replaceState(null, '', url);
    setId(nuevo);
  };
  return [id, elegir];
}

/** El panel del presentador (reiniciar, cerrar y confirmar la sala) se abre y se cierra con la tecla "p". */
function usePanelPresentador(): [boolean, () => void] {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const enCampo = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'p' && !e.metaKey && !e.ctrlKey && !enCampo) setAbierto(a => !a);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);
  return [abierto, () => setAbierto(false)];
}

export function Licitacion() {
  const { estado, fuente, accionDemo } = useRed();
  const ahora = useAhora(500);
  const [elegida, elegir] = useLicitacionElegida();
  const [panel, cerrarPanel] = usePanelPresentador();
  if (!estado) return <Cargando />;
  const lic = licitacionActual(estado, elegida) ?? licitacionActual(estado);
  // Las acciones del presentador van siempre a la sala, la compra que siguen WhatsApp y los rivales.
  const presentador = panel && <PanelPresentador licitacionId={estado.salaId ?? undefined} accion={accionDemo} alCerrar={cerrarPanel} />;
  if (!lic) {
    return (
      <Proyeccion>
        <div className="lic-meta"><Logo fondo="oscuro" className="lic-logo" /><AvisoFuente fuente={fuente} /></div>
        <p className="vacio">No hay una compra en grupo abierta.</p>
        {presentador}
      </Proyeccion>
    );
  }

  const r = resumenLicitacion(lic, estado);
  return <EnCurso lic={lic} estado={estado} r={r} ahora={ahora} fuente={fuente} elegir={elegir} presentador={presentador} />;
}

/** Con varias compras abiertas, chips para elegir cuál proyectar: su producto principal y cuántos negocios van. */
function ElegirCompra({ estado, actual, elegir }: { estado: EstadoRed; actual: string; elegir: (id: string) => void }) {
  const abiertas = licitacionesAbiertas(estado);
  if (abiertas.length < 2) return null;
  return (
    <nav className="lic-elegir" aria-label="Compra que se proyecta">
      {abiertas.map(l => (
        <button key={l.id} type="button" className={l.id === actual ? 'elegida' : ''} aria-pressed={l.id === actual} onClick={() => elegir(l.id)}>
          {l.id === estado.salaId && <span className="lic-sala">Sala · </span>}{l.producto} · {contar(l.participantes.length, 'negocio')}
        </button>
      ))}
    </nav>
  );
}

function EnCurso({ lic, estado, r, ahora, fuente, elegir, presentador }: { lic: LicitacionRed; estado: EstadoRed; r: ResumenLicitacion; ahora: number; fuente: Fuente; elegir: (id: string) => void; presentador: ReactNode }) {
  const { whatsappNumero } = useConfigRed(fuente);
  const productos = productosDeCanasta(lic, estado);
  /** El foco cambia como mucho cada 6 s: la columna de ofertas no salta con cada negocio que llega. */
  const destacado = useProductoDestacado(productos, 6000);
  const conCanasta = (lic.productos?.length ?? 0) > 1;
  const foco = conCanasta ? productos.find(p => p.id === destacado) : undefined;
  const vista = foco ? licitacionDeProducto(lic, foco.id) : lic;
  const rFoco = foco ? resumenLicitacion(vista, estado) : r;
  const canasta = conCanasta ? totalesCanasta(lic) : undefined;
  const restante = Date.parse(lic.cierraEn) - ahora;
  const cerrada = lic.estado === 'cerrada' || restante <= 0;
  const unidad = unidadDeLicitacion(lic);
  const facturas = facturasDeLaCompra(lic, estado);

  return (
    <Proyeccion className="proyeccion">
      <header className="lic-cabecera">
        <div>
          <div className="lic-meta">
            <Logo fondo="oscuro" className="lic-logo" />
            {cerrada
              ? <span className="en-vivo contorno">{facturas.length ? 'Facturada en el SII' : 'Cerrada'}</span>
              : <span className="en-vivo">Licitación en vivo</span>}
            <span>{conCanasta ? `Canasta de ${productos.length} productos` : lic.producto} · {lic.comuna}</span>
            <AvisoFuente fuente={fuente} />
          </div>
          <ElegirCompra estado={estado} actual={lic.id} elegir={elegir} />
          <h1 className="lic-titulo">
            {r.curvaPorTramos
              ? <>El grupo compra junto. <span className="amarillo">El precio baja para todos.</span></>
              : <>Los agentes armaron el pedido. <span className="amarillo">Los proveedores compiten.</span></>}
          </h1>
        </div>
        <div className={`cuenta ${cerrada ? 'cerrada' : ''}`}>
          <p className="etiqueta">{cerrada ? 'Licitación' : 'Cierra en'}</p>
          <div className="numero-grande">{cerrada ? 'Cerrada' : cuentaRegresiva(restante)}</div>
        </div>
      </header>

      <div className="lic-cuerpo">
        <Grupo lic={lic} r={r} cerrada={cerrada} unidad={unidad} canasta={canasta} whatsappNumero={whatsappNumero} />

        {canasta ? <Canasta lic={lic} estado={estado} productos={productos} destacado={destacado} canasta={canasta} /> : <section className="tarjeta apilada">
          <div className="mejor-oferta">
            <div>
              <p className="etiqueta">{r.curvaPorTramos ? 'Precio por' : 'Mejor oferta por'} {unidad.singular}</p>
              <div className="numero-grande">{r.precioActual !== undefined ? dinero(r.precioActual) : 'Sin ofertas'}</div>
            </div>
            {r.precioSolo !== undefined && (
              <div className="precio-solo">
                <p className="etiqueta">Comprando solo</p>
                <div className="numero-grande tachado">{dinero(r.precioSolo)}</div>
              </div>
            )}
          </div>
          {r.ahorroPorUnidad > 0 && (
            <div className="ahorro">-{r.porcentaje}% · ahorro grupal {dinero(r.ahorroGrupal)}</div>
          )}
          <CurvaPrecio puntos={r.curva} precioSolo={r.precioSolo} />
          <div className="leyenda"><i />{r.curvaPorTramos ? 'cada punto es un tramo de volumen que el grupo alcanzó' : 'cada punto es una contraoferta de un proveedor cuando el grupo crece'}</div>
        </section>}

        {cerrada ? (
          <FacturasSii facturas={facturas} />
        ) : tieneTramos(vista) && !rFoco.ofertas.length ? (
          <section className="tarjeta apilada">
            <p className="etiqueta lic-foco">{foco ? 'Por volumen' : 'Precio por volumen'}<DelProducto p={foco} /></p>
            <Escalera tramos={estadoTramos(vista)} unidad={unidadDeLicitacion(vista)} className="vertical" />
          </section>
        ) : (
          <Ofertas r={rFoco} cerrada={cerrada} producto={foco} />
        )}
      </div>
      {presentador}
    </Proyeccion>
  );
}
