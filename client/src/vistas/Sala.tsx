import { useEffect, useState } from 'react';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { Escalera } from '../components/Escalera.tsx';
import { useGrillaQueCabe } from '../components/medidas.ts';
import { PanelPresentador } from '../components/PanelPresentador.tsx';
import { Qr } from '../components/Qr.tsx';
import { competencia, facturaAceptada, licitacionActual, resumenSala, type FacturaSala, type OfertaSala, type ResumenSala } from '../red/derivar.ts';
import { contar, cuentaRegresiva, dinero, nota, textoEstadoSii, telefono } from '../red/formato.ts';
import type { ConfigRed, Licitacion } from '../red/tipos.ts';
import { useAhora, useConfigRed, useRed, type EventoVisto } from '../red/useRed.ts';
import './sala.css';

/** Cuánto dura en pantalla el momento "bajó el precio". */
const DURACION_BAJADA = 2400;
/** Ancho mínimo de cada ficha del muro, en px. */
const ANCHO_FICHA = 300;
const ANCHO_FACTURA = 270;
const ANCHO_OFERTA = 290;

type Unidad = ResumenSala['unidad'];
const cuantas = (n: number, u: Unidad) => contar(n, u.singular, u.plural);
const sinProtocolo = (url: string) => url.replace(/^https?:\/\//, '');

/** El último `licitacion.precio_bajo` de esta licitación, mientras dura su momento en pantalla. */
function bajadaReciente(eventos: EventoVisto[], licitacionId: string, ahora: number) {
  const e = eventos.find(ev => ev.tipo === 'licitacion.precio_bajo');
  if (!e || e.datos.licitacionId !== licitacionId || ahora - e.recibido > DURACION_BAJADA) return null;
  const anterior = typeof e.datos.precioAnterior === 'number' ? e.datos.precioAnterior : undefined;
  const nuevo = typeof e.datos.precioNuevo === 'number' ? e.datos.precioNuevo : undefined;
  return nuevo !== undefined ? { clave: e.clave, anterior, nuevo } : null;
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
      <h2>{numero ? 'Escríbele a Dominó y' : 'Escanea y'} <span className="subrayado">súmate al pedido</span></h2>
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
    </section>
  );
}

function Muro({ s }: { s: ResumenSala }) {
  const [ref, { columnas, caben }] = useGrillaQueCabe<HTMLUListElement>(ANCHO_FICHA, 60, s.muro.length);
  return (
    <section className="sala-muro-caja">
      <p className="etiqueta">Se van sumando</p>
      {!s.muro.length && <p className="muro-vacio">Aquí aparece cada negocio que se suma.</p>}
      <ul className="sala-muro" ref={ref} style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
        {s.muro.slice(0, caben).map(p => (
          <li key={p.n} className="ficha">
            <span className="nombre">{p.nombre}</span>
            <span className="ficha-pie">
              <span className="comuna">{p.comuna || ' '}</span>
              <span className="verde">+{cuantas(p.cantidad, s.unidad)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Competencia({ ofertas }: { ofertas: OfertaSala[] }) {
  const [ref, { columnas }] = useGrillaQueCabe<HTMLUListElement>(ANCHO_OFERTA, 12, ofertas.length);
  return (
    <section className="sala-competencia">
      <p className="etiqueta">Proveedores compitiendo · gana el mejor precio</p>
      <ul className="competencia-lista" ref={ref} style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
        {ofertas.slice(0, columnas).map(o => (
          <li key={o.clave} className={`oferta-sala ${o.gana ? 'gana' : ''}`}>
            <span className="oferta-quien">
              <span className="nombre">{o.proveedor}</span>
              {o.enEscenario && <span className="en-escenario">en la sala</span>}
            </span>
            <span className="oferta-linea">
              <strong>{dinero(o.precioUnitario)}</strong>
              <span>{o.gana ? 'va ganando' : o.nota !== undefined ? `nota ${nota(o.nota)}` : '\u00a0'}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Abierta({ s, lic, config, ofertas }: { s: ResumenSala; lic: Licitacion; config: ConfigRed; ofertas: OfertaSala[] }) {
  const t = s.tramos;
  const porcentaje = s.precioSolo && t.precioActual !== undefined ? Math.round(((s.precioSolo - t.precioActual) / s.precioSolo) * 100) : 0;
  return (
    <div className={`sala-abierta ${ofertas.length ? 'con-competencia' : ''}`}>
      <Unirse config={config} lic={lic} />
      <section className="sala-tablero">
        <div className="sala-precio">
          <p className="etiqueta">Precio por {s.unidad.singular}, para todos</p>
          <div className="precio-gigante" key={t.precioActual}>{t.precioActual !== undefined ? dinero(t.precioActual) : '-'}</div>
          {s.precioSolo !== undefined && (
            <p className="precio-solo-linea">
              solo: <span className="tachado">{dinero(s.precioSolo)}</span>
              {porcentaje > 0 && <span className="verde"> -{porcentaje}%</span>}
            </p>
          )}
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
      {ofertas.length > 0 && <Competencia ofertas={ofertas} />}
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
        {contar(s.muro.length, 'negocio')} · {cuantas(s.tramos.totalUnidades, s.unidad)} en un solo pedido
        {rivales > 1 && ` · ganó el mejor precio entre ${contar(rivales, 'proveedor', 'proveedores')}`}
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
      <span className="sello" aria-hidden="true">SII</span>
      <span className="factura-folio">Factura {f.folio ?? ''}</span>
      <span className="nombre">{f.nombre}</span>
      <span className="factura-linea">
        <span>{cuantas(f.unidades, unidad)}</span>
        <strong>{dinero(f.monto)}</strong>
      </span>
      <span className="factura-estado" key={f.estadoSii ?? ''}>
        {aceptada ? `✓ ${f.estadoSii === 'reparo' ? 'aceptada con reparos' : 'aceptada por el SII'}` : textoEstadoSii(f.estadoSii) || 'enviada al SII'}
      </span>
    </li>
  );
}

function Facturando({ s }: { s: ResumenSala }) {
  const [ref, { columnas, caben }] = useGrillaQueCabe<HTMLUListElement>(ANCHO_FACTURA, 80, s.facturas.length);
  const lista = s.fase === 'lista';
  const fuera = s.facturas.length - caben;
  return (
    <div className={`sala-facturas ${lista ? 'final' : ''}`}>
      <section className="sala-facturas-muro">
        <p className="etiqueta">
          {s.proveedor} dijo que sí · todas las facturas en un solo envío al SII{fuera > 0 ? ` · y ${fuera} más` : ''}
        </p>
        <ul className="muro-facturas" ref={ref} style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
          {s.facturas.slice(0, caben).map(f => <Factura key={f.id} f={f} unidad={s.unidad} />)}
        </ul>
      </section>
      <section className="sala-facturas-resumen">
        <div>
          <div className="numero-gigante" key={s.facturas.length}>{s.facturas.length}</div>
          <p className="resumen-texto">{s.facturas.length === 1 ? 'factura emitida' : 'facturas emitidas'} en el SII</p>
          <p className="sin-sii">Nadie entró al sitio del SII: todo salió solo.</p>
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
const PASOS: Array<[string, ResumenSala['fase'][]]> = [
  ['Compran juntos, baja el precio', ['abierta']],
  ['Proveedores compiten', ['abierta', 'cerrada']],
  ['Factura automática en el SII', ['facturando', 'lista']],
];

function Pasos({ fase }: { fase: ResumenSala['fase'] }) {
  return (
    <ol className="sala-pasos">
      {PASOS.map(([texto, fases], i) => (
        <li key={texto} className={fases.includes(fase) ? 'activo' : ''}>
          <b>{i + 1}</b> <span className="paso-texto">{texto}</span>
        </li>
      ))}
    </ol>
  );
}

const TITULO_FASE: Record<ResumenSala['fase'], string> = {
  abierta: 'Cierra en',
  cerrada: 'Pedido cerrado',
  facturando: 'Facturando en el SII',
  lista: 'Listo',
};

export function Sala() {
  const { estado, eventos, fuente, accionDemo } = useRed();
  const config = useConfigRed(fuente);
  const ahora = useAhora(250);
  const [panel, setPanel] = usePanelOculto();
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
  const bajada = s.fase === 'abierta' ? bajadaReciente(eventos, lic.id, ahora) : null;
  const ofertas = competencia(lic, estado);

  return (
    <main className={`sala fase-${s.fase}`}>
      <header className="sala-cabecera">
        <div className="sala-marca">
          <span className="marca">D</span>
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
          <p className="etiqueta">{TITULO_FASE[s.fase]}</p>
          {s.fase === 'abierta' && <div className="numero-grande">{cuentaRegresiva(restante)}</div>}
        </div>
      </header>

      {s.fase === 'abierta' && <Abierta s={s} lic={lic} config={config} ofertas={ofertas} />}
      {s.fase === 'cerrada' && <Cerrada s={s} ofertas={ofertas} />}
      {(s.fase === 'facturando' || s.fase === 'lista') && <Facturando s={s} />}

      {bajada && <BajoElPrecio key={bajada.clave} anterior={bajada.anterior} nuevo={bajada.nuevo} unidad={s.unidad} />}
      {panel && <PanelPresentador licitacionId={lic.id} accion={accionDemo} alCerrar={() => setPanel(false)} />}
    </main>
  );
}
