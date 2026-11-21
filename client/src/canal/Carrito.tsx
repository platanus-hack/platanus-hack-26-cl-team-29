// El carrito de la canasta en el teléfono, compartido por /unirse y la pestaña Compra conjunta de /app:
// una fila por producto con su precio en vivo y un selector, cambios optimistas que se guardan solos
// (PUT /yo/carrito con espera de 400 ms) y una barra fija abajo con el total y el ahorro.

import { PedirTarjeta, useFaltaTarjeta } from './MiCredito.tsx';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { dinero } from '../../../shared/formato.ts';
import type { CanalApi } from './api.ts';
import {
  aItems, carritoEnLaFoto, CANTIDAD_MAXIMA, crearEnvio, desdeItems, fijar, mismoCarrito, pistaTramo, productosDe, proyectar,
  resumirCarrito, textoCantidades, una, type Carrito, type Envio, type ProductoCanasta,
} from './carrito.ts';
import { Icono, iconoDeProducto, LogoSii } from './iconos.tsx';
import { mensajeDeError } from './logica.ts';
import { Confirmar, useEnvio } from './piezas.tsx';
import { formatearRutAlEscribir, validarRut } from '../../../shared/rut.ts';
import type { DatosEntrada, FacturaA, LicitacionCanal, Participacion } from './tipos.ts';

// ---------- Datos del negocio ----------

const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'Santiago', 'San Joaquín', 'La Florida', 'Las Condes', 'Maipú'];
const RUBROS: Array<[string, string]> = [
  ['almacen', 'Almacén'], ['minimarket', 'Minimarket'], ['panaderia', 'Panadería'], ['restaurante', 'Restaurante'],
  ['cafe', 'Café'], ['botilleria', 'Botillería'], ['farmacia', 'Farmacia'], ['otro', 'Otro'],
];

const RUT_INVALIDO = 'Revisa tu RUT: el dígito verificador no calza.';

/**
 * Lo que se pide para entrar: el nombre del negocio y el RUT (su factura sale a ese RUT en el SII, ambiente de
 * certificación). Comuna y rubro son opcionales. Al enviar, el servidor consulta el RUT en el SII.
 */
export function FormularioNegocio({ boton, onEntrar }: { boton: string; onEntrar: (datos: DatosEntrada) => Promise<void> }) {
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [rutRevisado, setRutRevisado] = useState(false);
  /** Error del RUT (formato o respuesta del SII): va bajo su campo, que el botón fijo de abajo nunca tapa. */
  const [errorRut, setErrorRut] = useState('');
  const campoRut = useRef<HTMLInputElement>(null);
  const [comuna, setComuna] = useState('');
  const [rubro, setRubro] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const rutMalo = rutRevisado && rut.length > 0 && !validarRut(rut);
  const avisoRut = errorRut || (rutMalo ? RUT_INVALIDO : '');
  const marcarRut = (mensaje: string) => {
    setErrorRut(mensaje);
    campoRut.current?.focus();
    campoRut.current?.scrollIntoView({ block: 'center' });
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (!nombre.trim()) return setError('Escribe el nombre de tu negocio.');
    setError('');
    if (!validarRut(rut)) return marcarRut(rut ? RUT_INVALIDO : 'Escribe tu RUT: tu factura sale a ese RUT.');
    setEnviando(true);
    setErrorRut('');
    try {
      await onEntrar({ nombre: nombre.trim(), comuna: comuna.trim(), rut, ...(rubro ? { rubro } : {}) });
    } catch (err) {
      const mensaje = mensajeDeError(err, 'No pudimos registrarte. Inténtalo de nuevo.');
      if (/\bRUT\b|SII/.test(mensaje)) marcarRut(mensaje); else setError(mensaje);
      setEnviando(false);
    }
  };

  return (
    <form className="formulario tarjeta cn-formulario" onSubmit={enviar}>
      <label className="campo">
        <span className="etiqueta">Nombre de tu negocio</span>
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Almacén Las Rosas" autoComplete="organization" maxLength={60} required />
      </label>
      <label className="campo">
        <span className="etiqueta">RUT de tu negocio o persona</span>
        <input ref={campoRut} value={rut} onChange={e => { setRut(formatearRutAlEscribir(e.target.value)); setRutRevisado(false); setErrorRut(''); }} onBlur={() => setRutRevisado(true)}
          placeholder="12.345.678-5" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} required
          aria-invalid={!!avisoRut} aria-describedby="cn-rut-ayuda" />
        <span id="cn-rut-ayuda" className={avisoRut ? 'cn-ayuda error' : 'cn-ayuda cn-con-sii'} role={avisoRut ? 'alert' : undefined}>
          {avisoRut || <><LogoSii tam={14} />Tu factura sale a tu nombre en el SII (ambiente de certificación).</>}
        </span>
      </label>
      <label className="campo">
        <span className="etiqueta">Comuna (opcional)</span>
        <input value={comuna} onChange={e => setComuna(e.target.value)} list="cn-comunas" placeholder="Ñuñoa" maxLength={40} />
        <datalist id="cn-comunas">{COMUNAS.map(c => <option key={c} value={c} />)}</datalist>
      </label>
      <fieldset className="campo cn-rubros">
        <legend className="etiqueta">Rubro (opcional)</legend>
        <div className="cn-chips">
          {RUBROS.map(([id, texto]) => (
            <button key={id} type="button" className={`cn-chip-opcion${rubro === id ? ' elegida' : ''}`} aria-pressed={rubro === id}
              onClick={() => setRubro(r => (r === id ? undefined : id))}>{texto}</button>
          ))}
        </div>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <button className="boton cn-ancho" disabled={enviando}>{enviando ? 'Buscando tu RUT en el SII...' : boton}</button>
    </form>
  );
}

/** A quién sale la factura del comprador, con el logo del SII. Solo en sus vistas personales, nunca en pantallas proyectadas. */
export function FacturaANombre({ factura }: { factura?: FacturaA | null }) {
  if (!factura) return null;
  return (
    <p className="cn-factura-a cn-con-sii">
      <LogoSii tam={14} />
      <span>Tu factura sale a <strong>{factura.razonSocial}</strong> <span className="mono">{factura.rut}</span>{factura.simulado ? ' (datos de prueba)' : ''}</span>
    </p>
  );
}

// ---------- Estado del carrito ----------

const MENSAJE_FALLO = 'No se guardó tu cambio. Revisa tu conexión.';

/**
 * Carrito con cambios optimistas: lo que se toca se ve al instante y se guarda tras una pausa corta.
 * Si el guardado falla, vuelve a lo último guardado con un mensaje corto. Lo que llega del servidor
 * (otra pestaña, WhatsApp) se aplica solo cuando no hay cambios pendientes.
 */
function useCarrito(api: CanalApi, token: string, licitacionId: string, servidor: Carrito, orden: string[]) {
  const [local, setLocal] = useState<Carrito>(servidor);
  const [guardado, setGuardado] = useState<Carrito>(servidor);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState('');
  const envio = useRef<Envio | null>(null);
  const ordenRef = useRef(orden);
  ordenRef.current = orden;

  useEffect(() => {
    const e = crearEnvio({
      inicial: servidor,
      enviar: c => api.carrito(token, licitacionId, aItems(c, ordenRef.current)),
      alGuardar: c => setGuardado(c),
      alFallar: (c, err) => {
        setLocal(c);
        // Sin conexión, el mensaje corto; si la red explica por qué (por ejemplo, la compra cerró), ese motivo.
        const motivo = err instanceof Error && err.message && !/conect/i.test(err.message) ? err.message : '';
        setError(motivo ? `No se guardó: ${motivo}` : MENSAJE_FALLO);
      },
      alCambiarPendiente: setPendiente,
    });
    envio.current = e;
    return () => e.cancelar();
  }, [api, token, licitacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // El aviso de error se va solo: el carrito ya volvió a lo guardado.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(t);
  }, [error]);

  // Solo cuando cambia lo que dice el servidor, y si no hay nada mío por guardar.
  const firma = JSON.stringify(aItems(servidor, orden));
  useEffect(() => {
    if (envio.current?.sincronizar(servidor)) {
      setLocal(servidor);
      setGuardado(servidor);
    }
  }, [firma]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = (productoId: string, cantidad: number) => {
    const c = fijar(local, productoId, cantidad);
    if (mismoCarrito(c, local)) return;
    setLocal(c);
    setError('');
    envio.current?.cambiar(c);
  };

  const salir = async () => {
    await api.salir(token, licitacionId);
    envio.current?.reiniciar({});
    setLocal({});
    setGuardado({});
    setError('');
  };

  return { local, guardado, pendiente, error, cambiar, salir };
}

// ---------- El carrito ----------

/** Marca unos segundos un precio que acaba de bajar (por otros negocios, por mí o por una oferta). */
function useBajada(precio: number): { veces: number; antes?: number } {
  const previo = useRef(precio);
  const [bajada, setBajada] = useState<{ veces: number; antes?: number }>({ veces: 0 });
  useEffect(() => {
    if (precio < previo.current) {
      const antes = previo.current;
      setBajada(b => ({ veces: b.veces + 1, antes }));
      const t = setTimeout(() => setBajada(b => ({ veces: b.veces })), 4000);
      previo.current = precio;
      return () => clearTimeout(t);
    }
    previo.current = precio;
  }, [precio]);
  return bajada;
}

function FilaProducto({ p, cantidad, guardada, abierta, onCambio }: {
  p: ProductoCanasta; cantidad: number; guardada: number; abierta: boolean; onCambio: (n: number) => void;
}) {
  const vista = proyectar(p, cantidad - guardada);
  const bajada = useBajada(vista.precio);
  const pista = pistaTramo(vista.siguiente, p);
  return (
    <li className={`cn-item${cantidad > 0 ? ' en-carrito' : ''}`}>
      <span className="cn-item-icono"><Icono nombre={iconoDeProducto(p.nombre)} tam={24} /></span>
      <div className="cn-item-cuerpo">
        <h3 className="cn-item-nombre">{p.nombre}</h3>
        <div className="cn-item-fila">
          <div className="cn-item-precio">
            <span key={bajada.veces} className={`cn-item-valor${bajada.veces ? ' bajo' : ''}`}>{dinero(vista.precio)}</span>
            <span className="cn-item-por">por {p.unidad}</span>
            {p.precioSolo > vista.precio && <span className="tachado cn-item-solo" aria-label={`Comprando solo, ${dinero(p.precioSolo)}`}>{dinero(p.precioSolo)}</span>}
          </div>
          {abierta && <Selector cantidad={cantidad} p={p} onCambio={onCambio} />}
        </div>
        {bajada.antes !== undefined
          ? <p className="cn-item-pista bajo" role="status">Bajó {dinero(bajada.antes - vista.precio)} por {p.unidad}</p>
          : abierta && pista ? <p className="cn-item-pista">{pista}</p>
          : abierta && p.tramos.length > 1 && !vista.siguiente ? <p className="cn-item-pista tope">Ya tiene el mejor precio</p> : null}
      </div>
    </li>
  );
}

/** "Agregar" cuando no hay nada; - n + cuando ya está en el carrito. Botones de 44 px para el pulgar. */
function Selector({ cantidad, p, onCambio }: { cantidad: number; p: ProductoCanasta; onCambio: (n: number) => void }) {
  if (cantidad === 0) {
    return <button type="button" className="cn-agregar" onClick={() => onCambio(1)} aria-label={`Agregar ${p.nombre}`}>Agregar</button>;
  }
  return (
    <div className="cn-selector" role="group" aria-label={`Cantidad de ${p.unidadPlural}`}>
      <button type="button" onClick={() => onCambio(cantidad - 1)} aria-label={cantidad === 1 ? `Quitar ${p.nombre}` : `${una(p)} menos`}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 12h12" /></svg>
      </button>
      <output aria-live="polite">{cantidad}</output>
      <button type="button" onClick={() => onCambio(cantidad + 1)} disabled={cantidad >= CANTIDAD_MAXIMA} aria-label={`${una(p)} más`}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
      </button>
    </div>
  );
}

interface PropsCarrito {
  api: CanalApi;
  token: string;
  lic: LicitacionCanal;
  negocioId?: string;
  /** Lo que dice `GET /yo`: se usa mientras la foto del grupo no trae a este negocio. */
  participacion?: Participacion;
  abierta: boolean;
}

/** Crédito Bando: quien todavía no está en la compra y no tiene tarjeta, primero la inscribe. */
export function CarritoCompra(props: PropsCarrito) {
  const falta = useFaltaTarjeta(props.api, props.token);
  const yaEsta = !!carritoEnLaFoto(props.lic, props.negocioId) || !!props.participacion?.items?.length;
  const recien = new URLSearchParams(location.search).get('tarjeta') === 'ok';
  if (props.abierta && !yaEsta && falta) return <PedirTarjeta token={props.token} />;
  return <>{recien && falta === false && !yaEsta && <p className="cn-ok">Tarjeta inscrita. Elige tus productos.</p>}<CarritoConProductos {...props} /></>;
}

function CarritoConProductos({ api, token, lic, negocioId, participacion, abierta }: PropsCarrito) {
  const productos = useMemo(() => productosDe(lic), [lic]);
  const orden = useMemo(() => productos.map(p => p.id), [productos]);
  const servidor = carritoEnLaFoto(lic, negocioId) ?? desdeItems(participacion?.items ?? []);
  const c = useCarrito(api, token, lic.id, servidor, orden);
  const r = resumirCarrito(productos, c.local, servidor);
  const [preguntando, setPreguntando] = useState(false);
  const { enviando: saliendo, error: errorSalir, setError: setErrorSalir, enviar } = useEnvio();
  const [salio, setSalio] = useState(false);
  const enCompra = Object.keys(c.guardado).length > 0;

  useEffect(() => { if (r.productos > 0) setSalio(false); }, [r.productos]);

  const salir = () => enviar(async () => {
    await c.salir();
    setPreguntando(false);
    setSalio(true);
  }, 'No pudimos sacarte de la compra. Inténtalo de nuevo.');

  const estado = c.error
    ? <span className="cn-barra-estado error" role="alert">{c.error}</span>
    : !abierta
      ? <span className="cn-barra-estado">{enCompra ? 'La compra cerró con tu carrito' : 'La compra ya cerró'}</span>
      : c.pendiente
        ? <span className="cn-barra-estado guardando">Guardando...</span>
        : enCompra
          ? <span className="cn-barra-estado ok"><span className="cn-punto-vivo" aria-hidden="true" />Ya estás en la compra</span>
          : <span className="cn-barra-estado">{salio ? 'Saliste de la compra' : 'Agrega productos para sumarte'}</span>;

  return (
    <div className="cn-carrito">
      <ul className="cn-items">
        {productos.map(p => (
          <FilaProducto key={p.id} p={p} cantidad={c.local[p.id] ?? 0} guardada={servidor[p.id] ?? 0} abierta={abierta}
            onCambio={n => c.cambiar(p.id, n)} />
        ))}
      </ul>

      {abierta && enCompra && !preguntando && (
        <button type="button" className="cn-boton-texto cn-salir" onClick={() => setPreguntando(true)}>Salir de la compra</button>
      )}
      {preguntando && (
        <Confirmar titulo="¿Salir de la compra?" si="Sí, salir" no="No, seguir en la compra" enviando={saliendo}
          error={errorSalir} onSi={() => { void salir(); }} onNo={() => { setPreguntando(false); setErrorSalir(''); }}>
          <p>Se vacía tu carrito y dejas de sumar al grupo. Puedes volver mientras siga abierta.</p>
        </Confirmar>
      )}

      <div className="cn-barra-carrito" aria-live="polite">
        <div className="cn-barra-izq">
          {estado}
          <span className="cn-barra-detalle">
            {r.productos > 0 ? textoCantidades(r) : 'Mientras más se suman, menos pagan todos'}
          </span>
        </div>
        {r.productos > 0 && (
          <div className="cn-barra-der">
            <strong className="cn-barra-total">{dinero(r.total)}</strong>
            {r.ahorro > 0 ? <span className="cn-barra-ahorro">Ahorras {dinero(r.ahorro)}</span> : <span className="cn-barra-neto">neto</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- El grupo en vivo ----------

export interface ResumenGrupo {
  negocios: number;
  unidades: number;
  ahorro: number;
}

export function resumenGrupo(lic: LicitacionCanal): ResumenGrupo {
  const productos = productosDe(lic);
  return {
    negocios: lic.participantes.filter(p => p.cantidad > 0).length,
    unidades: productos.reduce((s, p) => s + p.totalUnidades, 0),
    ahorro: lic.ahorroTotal ?? productos.reduce((s, p) => s + p.totalUnidades * Math.max(0, p.precioSolo - p.precioActual), 0),
  };
}

/** Quién se sumó hace poco (no yo), para que se note que el grupo está vivo. */
export function ultimoEnSumarse(lic: LicitacionCanal, negocioId: string | undefined, ahora: number, ventanaMs = 20_000) {
  const otros = lic.participantes.filter(p => p.negocioId !== negocioId && p.en && ahora - Date.parse(p.en) < ventanaMs);
  return otros.sort((a, b) => Date.parse(b.en!) - Date.parse(a.en!))[0];
}
