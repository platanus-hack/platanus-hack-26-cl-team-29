import { useEffect, useRef, useState } from 'react';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { Escalera } from '../components/Escalera.tsx';
import { Icono, LogoSii, Monograma } from '../components/Iconos.tsx';
import { useGrillaQueCabe } from '../components/medidas.ts';
import { PanelPresentador } from '../components/PanelPresentador.tsx';
import { Qr } from '../components/Qr.tsx';
import { competencia, facturaAceptada, licitacionActual, mostrarAviso, resumenSala, tipoDeBajada, type FacturaSala, type OfertaSala, type ResumenSala } from '../red/derivar.ts';
import { contar, cuentaRegresiva, dinero, nota, textoEstadoSii, telefono } from '../red/formato.ts';
import type { ConfigRed, Licitacion, Tramo } from '../red/tipos.ts';
import { useAhora, useConfigRed, useRed, type EventoVisto } from '../red/useRed.ts';
import './sala.css';

/** Cuánto dura en pantalla el momento "bajó el precio". */
const DURACION_BAJADA = 2400;
/** Cuánto dura el destello del precio cuando lo baja un proveedor. */
const DURACION_DESTELLO = 1200;

type Unidad = ResumenSala['unidad'];
const cuantas = (n: number, u: Unidad) => contar(n, u.singular, u.plural);
const sinProtocolo = (url: string) => url.replace(/^https?:\/\//, '');

interface Aviso {
  clave: number;
  anterior?: number;
  nuevo: number;
}

/**
 * Reacciona a cada `licitacion.precio_bajo` nuevo de esta licitación. Si el grupo cruzó un tramo (y pasó la
 * pausa), aviso a pantalla completa; si lo bajó un proveedor, el precio se anima en su lugar.
 * Cada efecto tiene un solo temporizador: uno nuevo reinicia el anterior, nunca se apilan ni quedan pegados.
 */
function useBajadas(eventos: EventoVisto[], licitacionId: string | undefined, tramos: Tramo[] | undefined) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [destello, setDestello] = useState(false);
  const visto = useRef(0);
  const ultimoAviso = useRef<number | null>(null);
  const timerAviso = useRef<ReturnType<typeof setTimeout>>(undefined);
  const timerDestello = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const ahora = Date.now();
    const nuevos = eventos
      .filter(e => e.clave > visto.current && e.tipo === 'licitacion.precio_bajo' && e.datos.licitacionId === licitacionId && ahora - e.recibido < DURACION_BAJADA)
      .reverse();
    if (eventos[0]) visto.current = Math.max(visto.current, eventos[0].clave);
    for (const e of nuevos) {
      const tipo = tipoDeBajada(e.datos, tramos);
      if (!tipo) continue;
      if (mostrarAviso(tipo, ahora, ultimoAviso.current)) {
        ultimoAviso.current = ahora;
        const anterior = typeof e.datos.precioAnterior === 'number' ? e.datos.precioAnterior : undefined;
        setAviso({ clave: e.clave, anterior, nuevo: e.datos.precioNuevo as number });
        clearTimeout(timerAviso.current);
        timerAviso.current = setTimeout(() => setAviso(null), DURACION_BAJADA);
      } else {
        setDestello(true);
        clearTimeout(timerDestello.current);
        timerDestello.current = setTimeout(() => setDestello(false), DURACION_DESTELLO);
      }
    }
  }, [eventos, licitacionId, tramos]);

  useEffect(() => () => {
    clearTimeout(timerAviso.current);
    clearTimeout(timerDestello.current);
  }, []);

  return { aviso, destello };
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
  const destino = numero ? `https://wa.me/${numero.replace(/\D/g, '')}?text=Quiero%20sumarme` : `${location.origin}/unirse?licitacion=${encodeURIComponent(lic.id)}`;
  return (
    <section className="sala-unirse">
      <h2>{numero ? 'Escríbele a Bando y' : 'Escanea y'} <span className="subrayado">súmate al pedido</span></h2>
      <Qr className="sala-qr" texto={destino} />
      {numero ? (
        <div className="sala-numero">
          <span className="etiqueta">WhatsApp</span>
          <strong>{telefono(numero)}</strong>
        </div>
      ) : (
        <div className="sala-numero">
          <span className="etiqueta">Sin WhatsApp: desde el navegador</span>
        </div>
      )}
      <p className="sala-web">o entra en <strong>{sinProtocolo(web)}</strong></p>
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
            <Monograma nombre={p.nombre} rubro />
            <span className="ficha-texto">
              <span className="nombre">{p.nombre}</span>
              <span className="ficha-pie">
                <span className="comuna">{p.comuna || ' '}</span>
                <span className="verde">+{cuantas(p.cantidad, s.unidad)}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** La ganadora siempre a la vista, primero; después las ofertas más nuevas que quepan en una línea. */
function Competencia({ ofertas, logoEnSala }: { ofertas: OfertaSala[]; logoEnSala?: string }) {
  const [ref, { columnas }] = useGrillaQueCabe<HTMLUListElement>(12, ofertas.length);
  return (
    <section className="sala-competencia">
      <p className="etiqueta">Proveedores compitiendo · <span className="amarillo">gana el mejor precio</span></p>
      <ul className="competencia-lista" ref={ref}>
        {[...ofertas.filter(o => o.gana), ...ofertas.filter(o => !o.gana)].slice(0, columnas).map(o => (
          <li key={o.clave} className={`oferta-sala ${o.gana ? 'gana' : ''}`}>
            <Monograma nombre={o.proveedor} logoUrl={o.enEscenario ? logoEnSala : undefined} />
            <span className="nombre">{o.proveedor}</span>
            <strong>{dinero(o.precioUnitario)}</strong>
            <span className="oferta-pie">
              {o.nota !== undefined && <span>nota {nota(o.nota)}</span>}
              {o.enEscenario && <span className="en-escenario">en la sala</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Abierta({ s, lic, config, ofertas, destello }: { s: ResumenSala; lic: Licitacion; config: ConfigRed; ofertas: OfertaSala[]; destello: boolean }) {
  const t = s.tramos;
  const porcentaje = s.precioSolo && t.precioActual !== undefined ? Math.round(((s.precioSolo - t.precioActual) / s.precioSolo) * 100) : 0;
  return (
    <div className={`sala-abierta ${ofertas.length ? 'con-competencia' : ''}`}>
      <Unirse config={config} lic={lic} />
      <section className="sala-tablero">
        <div className="sala-precio">
          <p className="etiqueta">Precio por {s.unidad.singular}, para todos</p>
          <div className="precio-fila">
            <div className={`precio-gigante ${destello ? 'por-oferta' : ''}`} key={t.precioActual}>{t.precioActual !== undefined ? dinero(t.precioActual) : '-'}</div>
            {s.precioSolo !== undefined && (
              <p className="precio-solo-linea">
                <span>solo <span className="tachado">{dinero(s.precioSolo)}</span></span>
                {porcentaje > 0 && <span className="verde">-{porcentaje}%</span>}
              </p>
            )}
          </div>
        </div>
        <div className="sala-contadores">
          <div>
            <div className="numero-grande" key={s.muro.length}>{s.muro.length}</div>
            <p className="etiqueta">{s.muro.length === 1 ? 'negocio' : 'negocios'}</p>
          </div>
          <div>
            <div className="numero-grande amarillo" key={t.totalUnidades}>{t.totalUnidades}</div>
            <p className="etiqueta">{t.totalUnidades === 1 ? s.unidad.singular : s.unidad.plural}</p>
          </div>
        </div>
        <Escalera tramos={t} unidad={s.unidad} className="horizontal" />
      </section>
      {ofertas.length > 0 && <Competencia ofertas={ofertas} logoEnSala={config.proveedorLogoUrl} />}
      <Muro s={s} />
    </div>
  );
}

function BajoElPrecio({ anterior, nuevo, unidad }: { anterior?: number; nuevo: number; unidad: Unidad }) {
  return (
    <div className="bajada-precio" role="status">
      <div className="bajada-banda">
        <p className="bajada-titulo">Bajó el precio para todos</p>
        <div className="bajada-precios">
          {anterior !== undefined && <span className="bajada-antes">{dinero(anterior)}</span>}
          <span className="bajada-nuevo">{dinero(nuevo)}</span>
        </div>
        <p className="bajada-pie">por {unidad.singular}, para cada negocio de la sala</p>
      </div>
    </div>
  );
}

function Totales({ s }: { s: ResumenSala }) {
  const precio = s.tramos.precioActual ?? 0;
  return (
    <div className="sala-totales">
      <div><div className="numero-grande">{s.muro.length}</div><p className="etiqueta">{s.muro.length === 1 ? 'negocio' : 'negocios'}</p></div>
      <div><div className="numero-grande">{s.tramos.totalUnidades}</div><p className="etiqueta">{s.tramos.totalUnidades === 1 ? s.unidad.singular : s.unidad.plural}</p></div>
      <div><div className="numero-grande amarillo">{dinero(precio)}</div><p className="etiqueta">por {s.unidad.singular}</p></div>
      <div><div className="numero-grande verde">{dinero(s.ahorroTotal)}</div><p className="etiqueta">ahorro de la sala</p></div>
    </div>
  );
}

function Cerrada({ s, ofertas }: { s: ResumenSala; ofertas: OfertaSala[] }) {
  const rivales = new Set(ofertas.map(o => o.proveedorId)).size;
  return (
    <div className="sala-cerrada">
      <p className="etiqueta">
        {rivales > 1 ? `Ganó el mejor precio entre ${contar(rivales, 'proveedor', 'proveedores')}` : 'Toda la sala en un solo pedido'}
      </p>
      <h2>Esperando el sí de <span className="amarillo">{s.proveedor}</span><span className="puntos" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></h2>
      <Totales s={s} />
    </div>
  );
}

function Factura({ f, unidad }: { f: FacturaSala; unidad: Unidad }) {
  const aceptada = facturaAceptada(f.estadoSii);
  return (
    <li className={`factura ${aceptada ? 'aceptada' : ''}`}>
      <span className="factura-folio">Factura {f.folio ?? ''}</span>
      <span className="nombre">{f.nombre}</span>
      <span className="sello"><LogoSii /></span>
      <span className="factura-linea">
        <span>{cuantas(f.unidades, unidad)}</span>
        <strong>{dinero(f.monto)}</strong>
      </span>
      <span className="factura-estado" key={f.estadoSii ?? ''}>
        {aceptada && <Icono nombre="check" />}
        {aceptada ? (f.estadoSii === 'reparo' ? 'aceptada con reparos' : 'aceptada por el SII') : textoEstadoSii(f.estadoSii) || 'enviada al SII'}
      </span>
    </li>
  );
}

function Facturando({ s }: { s: ResumenSala }) {
  const [ref, { caben }] = useGrillaQueCabe<HTMLUListElement>(80, s.facturas.length);
  const lista = s.fase === 'lista';
  const fuera = s.facturas.length - caben;
  return (
    <div className={`sala-facturas ${lista ? 'final' : ''}`}>
      <section className="sala-facturas-muro">
        <p className="etiqueta">
          {s.proveedor} dijo que sí · un solo envío al SII{fuera > 0 ? ` · y ${fuera} más` : ''}
        </p>
        <ul className="muro-facturas" ref={ref}>
          {s.facturas.slice(0, caben).map(f => <Factura key={f.id} f={f} unidad={s.unidad} />)}
        </ul>
      </section>
      <section className="sala-facturas-resumen">
        <div>
          <div className="numero-gigante" key={s.facturas.length}>{s.facturas.length}</div>
          <p className="resumen-texto">{s.facturas.length === 1 ? 'factura en el SII' : 'facturas en el SII'}</p>
          <p className="sin-sii"><LogoSii /> Nadie entró al sitio del SII: todo salió solo.</p>
        </div>
        <div>
          <div className="avance sii"><i style={{ width: `${s.facturas.length ? (s.aceptadas / s.facturas.length) * 100 : 0}%` }} /></div>
          <p className="resumen-texto verde">{s.aceptadas} {s.aceptadas === 1 ? 'aceptada' : 'aceptadas'} por el SII</p>
        </div>
        <div>
          <p className="etiqueta">Total facturado (neto)</p>
          <div className="numero-grande">{dinero(s.totalNeto)}</div>
        </div>
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
  const { aviso, destello } = useBajadas(eventos, licEnCurso?.id, licEnCurso?.tramos);
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
  const ofertas = competencia(lic, estado);

  return (
    <main className={`sala fase-${s.fase}`}>
      <header className="sala-cabecera">
        <div className="sala-marca">
          <span className="marca">B</span>
          <div>
            <div className="lic-meta">
              <span className="en-vivo">La sala compra junta</span>
              <Pasos fase={s.fase} />
              <AvisoFuente fuente={fuente} />
            </div>
            <h1>{config.producto ?? lic.producto}</h1>
          </div>
        </div>
        <div className={`sala-reloj ${s.fase === 'abierta' && restante < 10_000 ? 'urgente' : ''}`}>
          <p className="etiqueta">{(s.fase === 'facturando' || s.fase === 'lista') && <LogoSii />} {TITULO_FASE[s.fase]}</p>
          {s.fase === 'abierta' && <div className="numero-grande">{cuentaRegresiva(restante)}</div>}
        </div>
      </header>

      {s.fase === 'abierta' && <Abierta s={s} lic={lic} config={config} ofertas={ofertas} destello={destello} />}
      {s.fase === 'cerrada' && <Cerrada s={s} ofertas={ofertas} />}
      {(s.fase === 'facturando' || s.fase === 'lista') && <Facturando s={s} />}

      {s.fase === 'abierta' && aviso && <BajoElPrecio key={aviso.clave} anterior={aviso.anterior} nuevo={aviso.nuevo} unidad={s.unidad} />}
      {panel && <PanelPresentador licitacionId={lic.id} accion={accionDemo} alCerrar={() => setPanel(false)} />}
    </main>
  );
}
