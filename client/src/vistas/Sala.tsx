import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { CierreCanasta, TableroCanasta, useProductoDestacado } from '../components/Canasta.tsx';
import { GlifoWhatsapp, Icono, iconoProducto, LogoSii, Monograma } from '../components/Iconos.tsx';
import { useGrillaQueCabe } from '../components/medidas.ts';
import { PanelPresentador } from '../components/PanelPresentador.tsx';
import { Qr } from '../components/Qr.tsx';
import { bajadaDeProducto, facturaAceptada, licitacionActual, mostrarAviso, negocioPorId, resumenSala, type BajadaProducto, type FacturaSala, type ResumenSala } from '../red/derivar.ts';
import { dinero, miles } from '../../../shared/formato.ts';
import { contar, enumerar, segun } from '../../../shared/texto.ts';
import { lineaInvitacion } from '../../../shared/avisos.ts';
import { enlaceWhatsapp, formatearTelefono } from '../../../shared/telefono.ts';
import { cuentaRegresiva, textoEstadoSii } from '../red/formato.ts';
import type { ConfigRed, Fuente, Licitacion } from '../red/tipos.ts';
import { useJson } from '../red/useJson.ts';
import { useAhora, useConfigRed, useRed, type EventoVisto } from '../red/useRed.ts';
import './sala.css';
import { Logo } from '../marca/Logo.tsx';

/** Cuánto dura en pantalla el momento "bajó el precio". */
const DURACION_BAJADA = 2400;
/** Cuánto dura el destello del precio cuando lo baja un proveedor. */
const DURACION_DESTELLO = 1200;

/** Cuánto se ve "X invitó a Y" ("Trae a tu vecino"). */
const DURACION_INVITACION = 8000;

/** La última invitación que sumó a alguien, mientras dura en pantalla. */
function Invitacion({ eventos, ahora }: { eventos: EventoVisto[]; ahora: number }) {
  const e = eventos.find(x => x.tipo === 'invitacion.sumada' && ahora - x.recibido < DURACION_INVITACION);
  const d = e?.datos as { invita?: unknown; invitado?: unknown } | undefined;
  if (!e || typeof d?.invita !== 'string' || typeof d.invitado !== 'string') return null;
  return <p key={e.clave} className="sala-invitacion" role="status"><Icono nombre="check" /> {lineaInvitacion(d.invita, d.invitado)}</p>;
}

const sinProtocolo = (url: string) => url.replace(/^https?:\/\//, '');

type Aviso = BajadaProducto & { clave: number };

/**
 * Reacciona a cada `licitacion.precio_bajo` nuevo de esta licitación, leído con los tramos de su producto.
 * Si cruzó un tramo (de cualquier producto) y pasó la pausa, aviso a pantalla completa con ese producto;
 * si no, el precio se anima en su fila. Un solo temporizador para el aviso: uno nuevo reinicia el anterior.
 */
function useBajadas(eventos: EventoVisto[], lic: Licitacion | undefined, ahora: number) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [destellos, setDestellos] = useState<Record<string, number>>({});
  const visto = useRef(0);
  const ultimoAviso = useRef<number | null>(null);
  const timerAviso = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!lic) return;
    const momento = Date.now();
    const nuevos = eventos
      .filter(e => e.clave > visto.current && e.tipo === 'licitacion.precio_bajo' && e.datos.licitacionId === lic.id && momento - e.recibido < DURACION_BAJADA)
      .reverse();
    if (eventos[0]) visto.current = Math.max(visto.current, eventos[0].clave);
    for (const e of nuevos) {
      const bajada = bajadaDeProducto(e.datos, lic);
      if (!bajada) continue;
      if (mostrarAviso(bajada.tipo, momento, ultimoAviso.current)) {
        ultimoAviso.current = momento;
        setAviso({ ...bajada, clave: e.clave });
        clearTimeout(timerAviso.current);
        timerAviso.current = setTimeout(() => setAviso(null), DURACION_BAJADA);
      } else {
        setDestellos(d => ({ ...d, [bajada.productoId]: momento }));
      }
    }
  }, [eventos, lic]);

  useEffect(() => () => clearTimeout(timerAviso.current), []);

  return { aviso, destellos: Object.keys(destellos).filter(id => ahora - destellos[id] < DURACION_DESTELLO) };
}

/** Tecla "d" abre y cierra el panel del presentador (no mientras se escribe en un campo). */
function usePanelOculto() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'd' || e.key === 'D') setAbierto(a => !a);
      if (e.key === 'Escape') setAbierto(false);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);
  return [abierto, setAbierto] as const;
}

function Unirse({ config, lic }: { config: ConfigRed; lic: Licitacion }) {
  const web = `${location.origin}/app`;
  const numero = config.whatsappNumero;
  const destino = numero ? enlaceWhatsapp(numero, 'Quiero sumarme') : `${location.origin}/unirse?licitacion=${encodeURIComponent(lic.id)}`;
  return (
    <section className="sala-unirse">
      <h2>{numero ? 'Escríbele a Bando y' : 'Escanea y'} <span className="subrayado">súmate al pedido</span></h2>
      <Qr className="sala-qr" texto={destino} />
      {numero ? (
        <a className="sala-numero" href={destino} target="_blank" rel="noopener noreferrer">
          <strong>{formatearTelefono(numero)}</strong>
          <span className="pastilla-whatsapp"><GlifoWhatsapp /> Abrir WhatsApp</span>
        </a>
      ) : null}
      <p className="sala-web">{numero ? 'o entra en' : 'o desde el navegador:'} <strong>{sinProtocolo(web)}</strong></p>
      <p className="sala-demo">Modo demo: cualquiera puede sumarse. En uso real, cada negocio entra con su cuenta y su certificado digital.</p>
    </section>
  );
}

function Muro({ s }: { s: ResumenSala }) {
  const [ref, { caben }] = useGrillaQueCabe<HTMLUListElement>(60, s.muro.length);
  return (
    <section className="sala-muro-caja">
      <p className="etiqueta">Se van sumando</p>
      {!s.muro.length && <p className="muro-vacio">Aquí aparece cada negocio que se suma.</p>}
      <ul className="sala-muro" ref={ref}>
        {s.muro.slice(0, caben).map(p => (
          <li key={p.n} className="ficha">
            <Monograma nombre={p.nombre} rubro={p.rubro ?? true} />
            <span className="ficha-texto">
              <span className="nombre">{p.nombre}</span>
              <span className="ficha-pie">
                {/* Con dos productos ("3 cajas · 2 rollos") la línea se llena: la comuna se omite antes que cortarla. */}
                <span className="comuna">{p.detalle.includes('·') ? ' ' : p.comuna || ' '}</span>
                <span className="verde">+{p.detalle}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Contadores de toda la canasta: negocios, unidades, lo que paga la sala y lo que ahorra. */
function Totales({ s, className = '' }: { s: ResumenSala; className?: string }) {
  const c = s.canasta;
  return (
    <div className={`sala-totales ${className}`}>
      <div><div className="numero-grande" key={c.negocios}>{miles(c.negocios)}</div><p className="etiqueta">{segun(c.negocios, 'negocio')}</p></div>
      <div><div className="numero-grande" key={c.unidades}>{miles(c.unidades)}</div><p className="etiqueta">{segun(c.unidades, 'unidad')}</p></div>
      <div><div className="numero-grande amarillo" key={c.monto}>{dinero(c.monto)}</div><p className="etiqueta">total neto</p></div>
      <div><div className="numero-grande verde" key={c.ahorro}>{dinero(c.ahorro)}</div><p className="etiqueta">la sala ahorra</p></div>
    </div>
  );
}

function Abierta({ s, lic, config, destellos, logoEnSala }: {
  s: ResumenSala; lic: Licitacion; config: ConfigRed; destellos: string[]; logoEnSala?: string;
}) {
  const destacado = useProductoDestacado(s.productos);
  return (
    <div className="sala-abierta">
      <Unirse config={config} lic={lic} />
      <Totales s={s} className="sala-contadores" />
      <section className="sala-canasta">
        <p className="etiqueta">Precio por producto, para todos · <span className="amarillo">los proveedores compiten</span></p>
        <TableroCanasta productos={s.productos} destacado={destacado} destellos={destellos} logoEnSala={logoEnSala} />
      </section>
      <Muro s={s} />
    </div>
  );
}

function BajoElPrecio({ aviso }: { aviso: Aviso }) {
  return (
    <div className="bajada-precio" role="status">
      <div className="bajada-banda">
        <p className="bajada-titulo">Bajó el precio para todos</p>
        <p className="bajada-producto"><Icono nombre={iconoProducto(aviso.nombre)} /> {aviso.nombre}</p>
        <div className="bajada-precios">
          {aviso.anterior !== undefined && <span className="bajada-antes">{dinero(aviso.anterior)}</span>}
          <span className="bajada-nuevo">{dinero(aviso.nuevo)}</span>
        </div>
        <p className="bajada-pie">por {aviso.unidad}, para cada negocio de la sala</p>
      </div>
    </div>
  );
}

function Cerrada({ s, lic }: { s: ResumenSala; lic: Licitacion }) {
  const rivales = new Set([...(lic.productos ?? []).flatMap(p => p.ofertas ?? []), ...lic.ofertas].map(o => o.proveedorId)).size;
  return (
    <div className="sala-cerrada">
      <p className="etiqueta">
        {rivales > 1 ? `Ganó el mejor precio entre ${contar(rivales, 'proveedor')}` : 'Toda la sala en un solo pedido'}
      </p>
      <h2>Esperando el sí de <span className="amarillo">{s.proveedor}</span><span className="puntos" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></h2>
      <Totales s={s} />
      <CierreCanasta productos={s.productos} />
    </div>
  );
}

function Factura({ f }: { f: FacturaSala }) {
  const aceptada = facturaAceptada(f.estadoSii);
  return (
    <li className={`factura ${aceptada ? 'aceptada' : ''}`}>
      <span className="factura-folio">Factura {f.folio ?? ''}</span>
      <span className="nombre">{f.nombre}</span>
      <span className="sello"><LogoSii /></span>
      <span className="factura-linea">
        <span>{f.lineas > 1 ? contar(f.lineas, 'línea') : f.detalle}</span>
        <strong>{dinero(f.monto)}</strong>
      </span>
      <span className="factura-estado" key={f.estadoSii ?? ''}>
        {aceptada && <Icono nombre="check" />}
        {aceptada
          ? (f.estadoSii === 'reparo' ? 'aceptada con reparos' : 'aceptada por el SII')
          : f.estadoSii === 'simulado' ? 'SII simulado' : textoEstadoSii(f.estadoSii) || 'enviada al SII'}
      </span>
    </li>
  );
}

/** `GET /api/pagos/resumen`: la plata de la ronda, sin nombres. */
interface ResumenPagos {
  pagadoAProveedores: number;
  creditos: number;
  negocios: number;
  plazos: number[];
  cobrado: number;
  ambiente: 'falsa' | 'integracion' | 'produccion';
}

/** El cierre del flujo de plata: Bando paga al proveedor al facturar y los negocios pagan a plazo. Se recarga con cada `credito.*`. */
function PlataDeLaCompra({ eventos, fuente }: { eventos: EventoVisto[]; fuente: Fuente }) {
  const clave = eventos.find(e => e.tipo.startsWith('credito.'))?.clave;
  const { datos: p } = useJson<ResumenPagos>(fuente === 'real' ? '/api/pagos/resumen' : null, clave);
  if (!p?.creditos) return null;
  return (
    <div className="sala-plata" role="status">
      <p>Bando le pagó <strong className="amarillo">{dinero(p.pagadoAProveedores)}</strong> a los proveedores al instante</p>
      <p>{contar(p.negocios, 'negocio')} {p.negocios === 1 ? 'paga' : 'pagan'} {p.plazos.length ? `a ${enumerar(p.plazos.map(String))} días` : 'con su tarjeta'}</p>
      {p.cobrado > 0 && <p className="verde">Ya cobrado en sus tarjetas: {dinero(p.cobrado)}</p>}
      {p.ambiente !== 'produccion' && <p className="sala-demo">Pagos de prueba: no se mueve plata real.</p>}
    </div>
  );
}

function Facturando({ s, plata }: { s: ResumenSala; plata: ReactNode }) {
  const [ref, { caben }] = useGrillaQueCabe<HTMLUListElement>(80, s.facturas.length);
  const lista = s.fase === 'lista';
  const fuera = s.facturas.length - caben;
  // Con el SII simulado no llega veredicto: no se muestra una barra de aceptación que nunca avanza.
  const simuladas = s.facturas.length > 0 && s.facturas.every(f => f.estadoSii === 'simulado');
  return (
    <div className={`sala-facturas ${lista ? 'final' : ''}`}>
      <section className="sala-facturas-muro">
        <p className="etiqueta">
          {s.quienFacturo}{fuera > 0 ? ` · y ${fuera} más` : ''}
        </p>
        <ul className="muro-facturas" ref={ref}>
          {s.facturas.slice(0, caben).map(f => <Factura key={f.id} f={f} />)}
        </ul>
        {plata}
      </section>
      <section className="sala-facturas-resumen">
        <div>
          <div className="numero-gigante" key={s.facturas.length}>{s.facturas.length}</div>
          <p className="resumen-texto">{segun(s.facturas.length, 'factura en el SII', 'facturas en el SII')}</p>
          <p className="sin-sii"><LogoSii /> Nadie entró al sitio del SII: todo salió solo.</p>
        </div>
        {!simuladas && <div>
          <div className="avance sii"><i style={{ width: `${s.facturas.length ? (s.aceptadas / s.facturas.length) * 100 : 0}%` }} /></div>
          <p className="resumen-texto verde">{s.aceptadas} {segun(s.aceptadas, 'aceptada')} por el SII</p>
        </div>}
        <div>
          <p className="etiqueta">Total facturado (neto)</p>
          <div className="numero-grande">{dinero(s.totalNeto)}</div>
        </div>
        <CierreCanasta productos={s.productos} className="compacta" />
        {lista && (
          <div className="ahorro-final">
            <p className="etiqueta">La sala ahorró</p>
            <div className="numero-gigante verde">{dinero(s.ahorroTotal)}</div>
            <p className="resumen-texto">frente a comprar cada uno por su cuenta</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** La historia en tres pasos; se ilumina el de la fase actual. */
const PASOS: Array<[string, ResumenSala['fase'][], boolean?]> = [
  ['Compran juntos', ['abierta']],
  ['Proveedores compiten', ['abierta', 'cerrada']],
  ['Factura automática', ['facturando', 'lista'], true],
];

function Pasos({ fase }: { fase: ResumenSala['fase'] }) {
  return (
    <ol className="sala-pasos">
      {PASOS.map(([texto, fases, sii], i) => (
        <li key={texto} className={fases.includes(fase) ? 'activo' : ''}>
          <b>{i + 1}</b> <span className="paso-texto">{texto}</span>{sii && <LogoSii />}
        </li>
      ))}
    </ol>
  );
}

const TITULO_FASE: Record<ResumenSala['fase'], string> = {
  abierta: 'Cierra en',
  cerrada: 'Pedido cerrado',
  facturando: 'Facturando',
  lista: 'Listo',
};

export function Sala() {
  const { estado, eventos, fuente, accionDemo } = useRed();
  const config = useConfigRed(fuente);
  const ahora = useAhora(250);
  const [panel, setPanel] = usePanelOculto();
  const licEnCurso = estado ? licitacionActual(estado) : undefined;
  const { aviso, destellos } = useBajadas(eventos, licEnCurso, ahora);
  if (!estado) return <Cargando />;
  const lic = licitacionActual(estado);
  if (!lic) {
    return (
      <main className="sala">
        <p className="vacio">No hay una compra conjunta abierta. Presiona "d" para abrir el panel y reiniciar la demo.</p>
        {panel && <PanelPresentador accion={accionDemo} alCerrar={() => setPanel(false)} />}
      </main>
    );
  }
  const s = resumenSala(lic, estado, eventos, ahora);
  const restante = Date.parse(lic.cierraEn) - ahora;

  return (
    <main className={`sala fase-${s.fase}`}>
      <header className="sala-cabecera">
        <div className="sala-marca">
          <Logo variante="icono" className="marca" />
          <div>
            <div className="lic-meta">
              <span className="en-vivo">La sala compra junta</span>
              <Pasos fase={s.fase} />
              <AvisoFuente fuente={fuente} />
            </div>
            <h1>{s.productos.length > 1 ? `Canasta de ${s.productos.length} productos para el negocio` : config.producto ?? lic.producto}</h1>
          </div>
        </div>
        <div className={`sala-reloj ${s.fase === 'abierta' && restante < 10_000 ? 'urgente' : ''}`}>
          <p className="etiqueta">{(s.fase === 'facturando' || s.fase === 'lista') && <LogoSii />} {TITULO_FASE[s.fase]}</p>
          {s.fase === 'abierta' && <div className="numero-grande">{cuentaRegresiva(restante)}</div>}
        </div>
      </header>

      {s.fase === 'abierta' && <Abierta s={s} lic={lic} config={config} destellos={destellos} logoEnSala={config.proveedorLogoUrl ?? negocioPorId(estado, lic.proveedorId)?.logoUrl} />}
      {s.fase === 'cerrada' && <Cerrada s={s} lic={lic} />}
      {(s.fase === 'facturando' || s.fase === 'lista') && <Facturando s={s} plata={<PlataDeLaCompra eventos={eventos} fuente={fuente} />} />}

      {s.fase === 'abierta' && <Invitacion eventos={eventos} ahora={ahora} />}
      {s.fase === 'abierta' && aviso && <BajoElPrecio key={aviso.clave} aviso={aviso} />}
      {panel && <PanelPresentador licitacionId={lic.id} accion={accionDemo} alCerrar={() => setPanel(false)} />}
    </main>
  );
}
