// /app: "Mi negocio", el canal web del comprador. Las mismas acciones que por WhatsApp:
// sumarse a la compra conjunta, pedir a un proveedor, recibir o reclamar en el SII y ver las facturas.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { contar, cuantos, cuentaRegresiva, dinero, nota } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import type { Negocio } from '../red/tipos.ts';
import type { CanalApi } from './api.ts';
import {
  cicloDelPedido, enlaceWhatsapp, estaAbierta, licitacionVigente, normalizarTramos, precioDelGrupo, totalOrden, unidadPara, montoNotaCredito,
  type Unidad,
} from './logica.ts';
import { Cantidad, Confirmar, EstadoSii, Marca, useConfirmacion, Vacio } from './piezas.tsx';
import type { ConfigRed, FotoRed, LicitacionCanal, OrdenCanal, YoComprador } from './tipos.ts';
import { useCanal, useDatosConSesion, useGuardado } from './useCanal.ts';
import './canal.css';

const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'Santiago', 'San Joaquín', 'La Florida', 'Las Condes', 'Maipú'];
/** Copia del catálogo de la red (server/red/catalogo.ts). El producto de la compra conjunta se compra en su sección. */
const CATALOGO = ['Harina 25 kg', 'Levadura 500 g', 'Azúcar 25 kg', 'Manteca 10 kg', 'Sal 25 kg'];
const MAX_COMPRA_CONJUNTA = 20;

type Seccion = 'compra' | 'pedir' | 'pedidos' | 'facturas';
const SECCIONES: Array<[Seccion, string]> = [['compra', 'Compra conjunta'], ['pedir', 'Pedir'], ['pedidos', 'Mis pedidos'], ['facturas', 'Mis facturas']];

const seccionDelHash = (): Seccion => {
  const h = location.hash.slice(1);
  return SECCIONES.some(([s]) => s === h) ? (h as Seccion) : 'compra';
};

const cantidadEn = (n: number, u: Unidad) => contar(n, u.singular, u.plural);

interface SesionGuardada {
  token: string;
  nombre: string;
  comuna: string;
  modo: string;
}

function leerSesion(texto: string | null): SesionGuardada | null {
  try {
    const s = texto ? (JSON.parse(texto) as SesionGuardada) : null;
    return s && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function MiNegocio() {
  const { api, config, foto, cambio, fuente } = useCanal();
  const [guardada, guardar] = useGuardado('domino.app.sesion', 'local');
  const sesion = leerSesion(guardada);
  // Una sesión de la red falsa no sirve contra el backend real, ni al revés.
  const token = api && sesion?.modo === api.modo ? sesion.token : null;
  const [seccion, setSeccion] = useState<Seccion>(seccionDelHash);

  useEffect(() => {
    const alCambiar = () => setSeccion(seccionDelHash());
    addEventListener('hashchange', alCambiar);
    return () => removeEventListener('hashchange', alCambiar);
  }, []);

  const entrar = useCallback(async (nombre: string, comuna: string) => {
    if (!api) return;
    const r = await api.sesion(nombre, comuna);
    guardar(JSON.stringify({ token: r.token, nombre, comuna, modo: api.modo } satisfies SesionGuardada));
  }, [api, guardar]);

  // Si vence la sesión de prueba (la red falsa vive en memoria), se vuelve a entrar con el mismo nombre.
  const alVencer = useCallback(() => {
    if (api?.modo === 'falso' && sesion) void entrar(sesion.nombre, sesion.comuna).catch(() => guardar(null));
    else guardar(null);
  }, [api, sesion, entrar, guardar]);

  const { datos: yo, error, recargar } = useDatosConSesion(api, token, cambio, (a, t) => a.yo(t), alVencer);

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  if (!token) return <Bienvenida fuente={fuente} config={config} onEntrar={entrar} />;
  if (!yo) return <main className="cn-pagina"><p className={error ? 'error' : 'vacio'}>{error || 'Cargando tu negocio...'}</p></main>;

  const irA = (s: Seccion) => { location.hash = s; };
  const porRecibir = yo.ordenes.filter(o => o.estado === 'facturada').length;
  const wa = enlaceWhatsapp(config?.whatsappNumero);

  return (
    <div className="cn-app">
      <header className="cn-cabecera">
        <Marca />
        <div className="cn-quien">
          <strong className="nombre">{yo.negocio.nombre}</strong>
          <span className="mono tenue">{yo.negocio.comuna} <AvisoFuente fuente={fuente} /></span>
        </div>
        <button type="button" className="cn-boton-texto" onClick={() => guardar(null)}>Salir</button>
      </header>

      <nav className="cn-pestanas" aria-label="Secciones">
        {SECCIONES.map(([s, titulo]) => (
          <a key={s} href={`#${s}`} className={s === seccion ? 'activa' : ''} aria-current={s === seccion ? 'page' : undefined}>
            {titulo}
            {s === 'pedidos' && porRecibir > 0 && <span className="cn-globo" aria-label={`${porRecibir} por revisar`}>{porRecibir}</span>}
          </a>
        ))}
      </nav>

      <main className="cn-contenido">
        {error && <p className="error">{error}</p>}
        {seccion === 'compra' && <CompraConjunta api={api} token={token} foto={foto} yo={yo} config={config} alCambiar={recargar} />}
        {seccion === 'pedir' && <Pedir api={api} token={token} foto={foto} config={config} alEnviar={() => { recargar(); irA('pedidos'); }} />}
        {seccion === 'pedidos' && <MisPedidos api={api} token={token} foto={foto} yo={yo} config={config} alCambiar={recargar} irAPedir={() => irA('pedir')} />}
        {seccion === 'facturas' && <MisFacturas foto={foto} yo={yo} />}
        {wa && (
          <a className="cn-whatsapp" href={wa} target="_blank" rel="noreferrer">
            También puedes hacer todo esto por WhatsApp
          </a>
        )}
      </main>
    </div>
  );
}

// ---------- Bienvenida ----------

function Bienvenida({ fuente, config, onEntrar }: {
  fuente: ReturnType<typeof useCanal>['fuente']; config: ConfigRed | null; onEntrar: (nombre: string, comuna: string) => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [comuna, setComuna] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const wa = enlaceWhatsapp(config?.whatsappNumero);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return setError('Escribe el nombre de tu negocio.');
    setEnviando(true);
    setError('');
    try {
      await onEntrar(nombre.trim(), comuna.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrarte. Inténtalo de nuevo.');
      setEnviando(false);
    }
  };

  return (
    <main className="cn-pagina cn-bienvenida">
      <Marca><AvisoFuente fuente={fuente} /></Marca>
      <h1>Compra junto a otros negocios y paga menos</h1>
      <p className="cn-bajada">Tus compras conjuntas, pedidos y facturas del SII en un solo lugar.</p>
      <form className="formulario tarjeta" onSubmit={enviar}>
        <label className="campo">
          <span className="etiqueta">Nombre de tu negocio</span>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Almacén Las Rosas" autoComplete="organization" maxLength={60} required />
        </label>
        <label className="campo">
          <span className="etiqueta">Comuna (opcional)</span>
          <input value={comuna} onChange={e => setComuna(e.target.value)} list="cn-comunas" placeholder="Ñuñoa" maxLength={40} />
          <datalist id="cn-comunas">{COMUNAS.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Entrando...' : 'Entrar'}</button>
      </form>
      {wa && <a className="cn-whatsapp" href={wa} target="_blank" rel="noreferrer">También puedes hacer todo esto por WhatsApp</a>}
      <p className="nota-demo">Modo demo: cualquiera puede sumarse sin cuenta. En uso real, cada negocio entra con su cuenta y su certificado digital conectado al SII.</p>
    </main>
  );
}

// ---------- Compra conjunta ----------

function CompraConjunta({ api, token, foto, yo, config, alCambiar }: {
  api: CanalApi; token: string; foto: FotoRed; yo: YoComprador; config: ConfigRed | null; alCambiar: () => void;
}) {
  const ahora = useAhora();
  const lic = licitacionVigente(foto.licitaciones);
  const mia = lic ? yo.participaciones.find(p => p.licitacionId === lic.id) : undefined;
  const [cantidad, setCantidad] = useState(mia?.cantidad ?? 2);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const g = lic ? precioDelGrupo(lic) : undefined;
  const bajada = useBajadaDePrecio(g?.precio);

  useEffect(() => { if (mia) setCantidad(mia.cantidad); }, [mia?.cantidad]);

  if (!lic || !g) {
    return <Vacio titulo="No hay una compra conjunta abierta" texto="Cuando parta una, aparece aquí con su precio en vivo. Mientras tanto, puedes pedir directo a un proveedor." />;
  }
  const u = unidadPara(lic.producto, config);
  const abierta = estaAbierta(lic, ahora);
  const compradores = lic.participantes.length;

  const sumarme = async () => {
    setEnviando(true);
    setError('');
    setAviso('');
    try {
      await api.unirse(token, lic.id, cantidad);
      setAviso(mia ? `Listo, ahora vas con ${cantidadEn(cantidad, u)}.` : `Listo, estás en el grupo con ${cantidadEn(cantidad, u)}.`);
      alCambiar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos sumarte. Inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="cn-seccion">
      <div className="tarjeta cn-compra">
        <div className="cn-fila-meta">
          {abierta ? <span className="en-vivo">En vivo</span> : <span className="cn-chip">Cerrada</span>}
          {abierta && <span className="mono">cierra en {cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}</span>}
        </div>
        <h2 className="cn-producto">{lic.producto}</h2>
        <div className="cn-precio">
          <span className="numero-grande amarillo">{g.precio !== undefined ? dinero(g.precio) : 'Sin precio'}</span>
          <span className="mono">por {u.singular}</span>
        </div>
        {g.precioSolo !== undefined && g.precio !== undefined && g.precioSolo > g.precio && (
          <p className="mono cn-solo"><span className="tachado">{dinero(g.precioSolo)}</span> comprando solo</p>
        )}
        {bajada && <p className="cn-bajo" role="status">Bajó a {dinero(bajada)} por {u.singular}</p>}
        {abierta && g.siguiente && (
          <div className="cn-tramo">
            <p className="mono">Faltan <strong>{cantidadEn(g.siguiente.faltan, u)}</strong> para bajar a <strong className="verde">{dinero(g.siguiente.precio)}</strong></p>
            <BarraTramo lic={lic} unidades={g.unidades} />
          </div>
        )}
        <p className="mono tenue cn-grupo">{contar(compradores, 'negocio')}, {cantidadEn(g.unidades, u)} en total</p>
      </div>

      <div className="tarjeta">
        {abierta ? (
          <>
            <p className="etiqueta">{mia ? 'Tu parte' : `¿${cuantos(u.plural)} ${u.plural} quieres?`}</p>
            {mia && !aviso && <p className="cn-texto">Estás en el grupo con <strong>{cantidadEn(mia.cantidad, u)}</strong>.</p>}
            <Cantidad valor={cantidad} max={MAX_COMPRA_CONJUNTA} onCambio={setCantidad} etiqueta={`Cantidad de ${u.plural}`} />
            {g.precio !== undefined && (
              <p className="mono cn-texto">
                {dinero(g.precio * cantidad)} neto
                {g.precioSolo !== undefined && g.precioSolo > g.precio && <span className="verde"> · ahorras {dinero((g.precioSolo - g.precio) * cantidad)}</span>}
              </p>
            )}
            {error && <p className="error">{error}</p>}
            {aviso && <p className="cn-ok" role="status">{aviso}</p>}
            {(!mia || mia.cantidad !== cantidad) && (
              <button type="button" className="boton cn-ancho" onClick={sumarme} disabled={enviando}>
                {enviando ? 'Enviando...' : mia ? `Cambiar a ${cantidadEn(cantidad, u)}` : `Sumarme con ${cantidadEn(cantidad, u)}`}
              </button>
            )}
          </>
        ) : (
          <p className="cn-texto">
            {mia
              ? `La compra cerró. Vas con ${cantidadEn(mia.cantidad, u)}: tu pedido y su factura aparecen en Mis pedidos.`
              : 'Esta compra conjunta ya cerró. Te avisamos aquí cuando parta la próxima.'}
          </p>
        )}
      </div>

      <Tramos lic={lic} unidades={g.unidades} u={u} />
    </section>
  );
}

/** Muestra "Bajó a $X" unos segundos cada vez que el precio baja. */
function useBajadaDePrecio(precio: number | undefined): number | undefined {
  const previo = useRef(precio);
  const [bajada, setBajada] = useState<number>();
  useEffect(() => {
    if (precio !== undefined && previo.current !== undefined && precio < previo.current) {
      setBajada(precio);
      const t = setTimeout(() => setBajada(undefined), 8000);
      previo.current = precio;
      return () => clearTimeout(t);
    }
    previo.current = precio;
  }, [precio]);
  return bajada;
}

function BarraTramo({ lic, unidades }: { lic: LicitacionCanal; unidades: number }) {
  const tramos = normalizarTramos(lic.tramos);
  const desde = [...tramos].reverse().find(t => t.desde <= unidades)?.desde ?? 0;
  const hasta = tramos.find(t => t.desde > unidades)?.desde;
  if (hasta === undefined) return null;
  const avance = Math.min(100, Math.max(4, ((unidades - desde) / (hasta - desde)) * 100));
  return <div className="cn-barra" aria-hidden="true"><span style={{ width: `${avance}%` }} /></div>;
}

function Tramos({ lic, unidades, u }: { lic: LicitacionCanal; unidades: number; u: Unidad }) {
  const tramos = normalizarTramos(lic.tramos);
  if (!tramos.length) return null;
  const actual = [...tramos].reverse().find(t => t.desde <= unidades) ?? tramos[0];
  return (
    <div className="tarjeta">
      <p className="etiqueta">Mientras más se suman, menos pagan todos</p>
      <ul className="cn-tramos">
        {tramos.map(t => (
          <li key={t.desde} className={t === actual ? 'actual' : t.desde <= unidades ? 'pasado' : ''}>
            <span className="mono">desde {cantidadEn(t.desde, u)}</span>
            <strong>{dinero(t.precioUnitario)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Pedir ----------

function Pedir({ api, token, foto, config, alEnviar }: {
  api: CanalApi; token: string; foto: FotoRed; config: ConfigRed | null; alEnviar: () => void;
}) {
  const proveedores = foto.negocios
    .filter(n => n.rol === 'proveedor')
    .map(n => ({ negocio: n, nota: foto.notas.find(x => x.proveedorId === n.id)?.nota }))
    .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0));
  const [producto, setProducto] = useState(CATALOGO[0]);
  const [cantidad, setCantidad] = useState(4);
  const [proveedorId, setProveedorId] = useState(proveedores[0]?.negocio.id ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [enviada, setEnviada] = useState<{ proveedor: string; detalle: string; total: number } | null>(null);
  const u = unidadPara(producto, config);
  const proveedor = proveedores.find(p => p.negocio.id === proveedorId)?.negocio;

  if (!proveedores.length) return <Vacio titulo="Todavía no hay proveedores en la red" texto="Cuando se sume el primero, podrás pedirle desde aquí." />;

  const enviar = async () => {
    if (!proveedor || !producto) return setError('Elige un producto y un proveedor.');
    setEnviando(true);
    setError('');
    try {
      const orden = await api.pedir(token, proveedor.id, [{ producto, cantidad }]);
      setEnviada({ proveedor: proveedor.nombre, detalle: `${cantidadEn(cantidad, u)} de ${producto}`, total: totalOrden(orden) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos enviar la orden. Inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
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
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const factura = yo.documentos.find(d => d.ordenId === orden.id && d.tipo === 33);
  const nc = yo.documentos.find(d => d.ordenId === orden.id && d.tipo === 61);

  const reclamar = useCallback(async ({ faltante: f }: AccionRecepcion) => {
    await api.recepcion(token, orden.id, { faltante: f, confirmado: true });
    setFaltaron(false);
    alCambiar();
  }, [api, token, orden.id, alCambiar]);
  const reclamo = useConfirmacion(reclamar);

  const llegoTodo = async () => {
    setEnviando(true);
    setError('');
    try {
      await api.recepcion(token, orden.id, { conforme: true, confirmado: true });
      alCambiar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos registrarlo. Inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <article className={`tarjeta cn-pedido ${orden.estado}`}>
      <header className="cn-pedido-cabecera">
        <div>
          <p className="etiqueta">{proveedor?.nombre ?? 'Proveedor'}</p>
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
            <span className="cn-paso-titulo">{p.titulo}</span>
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
          enviando={reclamo.estado.fase === 'enviando'}
          error={reclamo.estado.fase === 'error' ? reclamo.estado.mensaje : undefined}
          onSi={reclamo.confirmar}
          onNo={reclamo.cancelar}
        >
          <p>
            Reclamamos la factura{factura?.folio ? ` folio ${factura.folio}` : ''} por falta parcial:{' '}
            {reclamo.estado.accion.faltante === 1 ? 'faltó' : 'faltaron'} {reclamo.estado.accion.faltante} de {cantidadEn(item.cantidad, u)}.
          </p>
          <p>{proveedor?.nombre ?? 'El proveedor'} tendrá que emitirte una nota de crédito por {dinero(reclamo.estado.accion.faltante * item.precioUnitario)}.</p>
        </Confirmar>
      )}

      {orden.estado === 'reclamada' && (
        <p className="cn-aviso-sii">Reclamado en el SII. Esperando la nota de crédito de {proveedor?.nombre ?? 'tu proveedor'}.</p>
      )}
      {orden.estado === 'corregida' && (
        <p className="cn-ok">
          Nota de crédito recibida{nc?.folio ? `, folio ${nc.folio}` : ''}: {dinero(montoNotaCredito(orden, yo.documentos))} por{' '}
          {cantidadEn(orden.reclamo?.faltante ?? 0, u)} que {orden.reclamo?.faltante === 1 ? 'faltó' : 'faltaron'}. Quedó amarrada a tu factura en el SII.
        </p>
      )}
    </article>
  );
}

// ---------- Mis facturas ----------

const NOMBRE_DOC: Record<number, string> = { 33: 'Factura', 61: 'Nota de crédito' };

function MisFacturas({ foto, yo }: { foto: FotoRed; yo: YoComprador }) {
  const docs = yo.documentos
    .filter(d => d.tipo === 33 || d.tipo === 61)
    .sort((a, b) => Date.parse(b.emitidoEn ?? '') - Date.parse(a.emitidoEn ?? '') || (b.folio ?? 0) - (a.folio ?? 0));
  if (!docs.length) {
    return <Vacio titulo="Todavía no tienes facturas" texto="Cuando un proveedor confirme tu pedido, su factura del SII aparece aquí con su estado." />;
  }
  return (
    <section className="cn-seccion">
      <ul className="tarjeta cn-documentos">
        {docs.map(d => {
          const orden = yo.ordenes.find(o => o.id === d.ordenId);
          const proveedor = foto.negocios.find(n => n.id === orden?.proveedorId)?.nombre;
          return (
            <li key={d.id}>
              <div className="cn-doc-izq">
                <strong>{NOMBRE_DOC[d.tipo]} {d.folio !== null ? `folio ${d.folio}` : ''}</strong>
                <span className="mono tenue nombre">{proveedor ?? 'Proveedor'}</span>
              </div>
              <div className="cn-doc-der">
                <strong className="mono">{d.monto !== undefined ? (d.tipo === 61 ? `-${dinero(d.monto)}` : dinero(d.monto)) : ''}</strong>
                <EstadoSii estado={d.estadoSii} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mono tenue cn-nota-pie">Montos netos. Cada documento queda registrado en el SII.</p>
    </section>
  );
}
