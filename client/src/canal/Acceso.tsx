// Entrar a la web con la marca Bando (DESIGN.md): el número de WhatsApp, el código de 6 dígitos que llega por WhatsApp
// y, solo si el número es nuevo en la red, el nombre y el RUT del negocio. Una sola pantalla para /unirse, /app y
// /proveedor: una tarjeta blanca centrada sobre crema, como "Conecta tu SII" en Paper.

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { enlaceWhatsapp, formatearTelefono, telefonoParaWhatsapp } from '../../../shared/telefono.ts';
import { formatearRutAlEscribir, RUT_INVALIDO, RUT_SIN_CONFIRMAR, validarRut } from '../../../shared/rut.ts';
import { Logo } from '../marca/Logo.tsx';
import { ICONO_FLUJO } from '../marca/recursos.ts';
import { BotonTema } from '../marca/BotonTema.tsx';
import type { CanalApi } from './api.ts';
import { TELEFONO_PROVEEDOR_FALSO } from './falso.ts';
import { LogoSii } from '../marca/LogoSii.tsx';
import { mensajeDeError } from './logica.ts';
import { useEnvio } from './piezas.tsx';
import type { ConfigRed, DatosEntrada, FacturaA } from './tipos.ts';
import type { useCanal } from './useCanal.ts';
import '../comprador/comprador.css';

type Paso = 'telefono' | 'codigo' | 'registro';

const TELEFONO_INVALIDO = 'Escribe tu número de WhatsApp, por ejemplo 9 1234 5678.';
const PASO: Record<Paso, string> = { telefono: 'Paso 1 de 2', codigo: 'Paso 2 de 2', registro: 'Último paso' };

export function Acceso({ api, config, fuente, titulo, bajada, onEntrar }: {
  api: CanalApi; config: ConfigRed | null; fuente: ReturnType<typeof useCanal>['fuente'];
  titulo: string; bajada: string; onEntrar: (token: string) => void;
}) {
  const [paso, setPaso] = useState<Paso>('telefono');
  const [telefono, setTelefono] = useState('');
  const [codigo, setCodigo] = useState('');
  const [retenido, setRetenido] = useState(false);
  const { enviando, error, setError, enviar } = useEnvio();

  const pedirCodigo = (e?: FormEvent) => {
    e?.preventDefault();
    if (!telefonoParaWhatsapp(telefono)) return setError(TELEFONO_INVALIDO);
    void enviar(async () => {
      setRetenido((await api.pedirCodigo(telefono)).retenido);
      setCodigo('');
      setPaso('codigo');
    }, 'No pudimos mandarte el código. Inténtalo de nuevo.');
  };

  const consultarRut = useCallback((rut: string) => api.consultarRut(telefono, codigo, rut), [api, telefono, codigo]);

  const entrarCon = async (datos?: DatosEntrada, conCodigo = codigo) => {
    const r = await api.entrar(telefono, conCodigo, datos);
    if ('registro' in r) setPaso('registro');
    else onEntrar(r.token);
  };

  const verificarCodigo = (c: string) => {
    if (!/^\d{6}$/.test(c)) return setError('El código tiene 6 dígitos.');
    void enviar(() => entrarCon(undefined, c), 'No pudimos entrar. Inténtalo de nuevo.');
  };
  const verificar = (e: FormEvent) => {
    e.preventDefault();
    verificarCodigo(codigo);
  };
  // Pegar el mensaje entero (o solo el código) deja los 6 dígitos y entra sin apretar nada.
  const alPegar = (e: ClipboardEvent<HTMLInputElement>) => {
    const pegado = /\d{6}/.exec(e.clipboardData.getData('text').replace(/[\s-]/g, ''))?.[0];
    if (!pegado) return;
    e.preventDefault();
    setCodigo(pegado);
    verificarCodigo(pegado);
  };

  // El enlace del mensaje de WhatsApp (`?entrar=<token>`): entra solo, o sigue al registro con el código ya validado.
  // Se saca de la URL antes de usarlo, para que no quede en el historial ni se reenvíe al recargar.
  const tokenDelEnlace = useRef(new URLSearchParams(location.search).get('entrar'));
  useEffect(() => {
    const token = tokenDelEnlace.current;
    if (!token) return;
    tokenDelEnlace.current = null;
    const url = new URL(location.href);
    url.searchParams.delete('entrar');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    void enviar(async () => {
      const r = await api.entrarConEnlace(token);
      if ('token' in r) return onEntrar(r.token);
      setTelefono(r.telefono);
      setCodigo(r.codigo);
      setPaso('registro');
    }, 'El enlace venció o ya se usó. Pide un código nuevo.');
  }, [api, enviar, onEntrar]);

  const volver = () => {
    setError('');
    setPaso('telefono');
  };
  const numero = formatearTelefono(telefonoParaWhatsapp(telefono) ?? telefono);
  const whatsapp = enlaceWhatsapp(config?.whatsappNumero, 'Hola');

  return (
    <main className="bando-ui bm-acceso">
      <div className="bm-acceso-tarjeta">
        <header className="bm-acceso-cabecera">
          <Logo />
          <span>{PASO[paso]}</span>
        </header>

        <img className="bm-acceso-icono ilustracion" src={ICONO_FLUJO.entrar} alt="" />
        <div className="bm-acceso-textos">
          <h1>{paso === 'telefono' ? titulo : paso === 'codigo' ? 'Revisa tu WhatsApp' : 'Registra tu negocio'}</h1>
          <p>
            {paso === 'telefono' ? bajada
              : paso === 'codigo' ? <>Te mandamos un código por WhatsApp al <strong>{numero}</strong>.</>
              : 'Es tu primera vez en la red: cuéntanos de tu negocio.'}
          </p>
        </div>

        {paso === 'telefono' && (
          <form className="bm-formulario" onSubmit={pedirCodigo}>
            <Campo etiqueta="Tu número de WhatsApp">
              <input type="tel" inputMode="tel" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="9 1234 5678"
                autoComplete="tel" maxLength={20} required autoFocus />
            </Campo>
            {error && <p className="bm-error" role="alert">{error}</p>}
            <button className="bm-boton bm-ancho" disabled={enviando}>{enviando ? 'Mandando...' : 'Mandarme el código'}</button>
          </form>
        )}

        {paso === 'codigo' && (
          <form className="bm-formulario" onSubmit={verificar}>
            {retenido && <VentanaCerrada enlace={whatsapp} />}
            <Campo etiqueta="Código">
              <input className="bm-codigo" value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} onPaste={alPegar} inputMode="numeric"
                autoComplete="one-time-code" placeholder="123456" maxLength={6} required autoFocus />
            </Campo>
            {error && <p className="bm-error" role="alert">{error}</p>}
            <button className="bm-boton bm-ancho" disabled={enviando}>{enviando ? 'Entrando...' : 'Entrar'}</button>
            <div className="bm-acceso-enlaces">
              <button type="button" className="bm-boton-texto" onClick={() => pedirCodigo()} disabled={enviando}>Mandar otro código</button>
              <button type="button" className="bm-boton-texto" onClick={volver}>Cambiar número</button>
            </div>
          </form>
        )}

        {paso === 'registro' && (
          <>
            <FormularioNegocio onEntrar={entrarCon} consultarRut={consultarRut} />
            <button type="button" className="bm-boton-texto bm-acceso-volver" onClick={volver}>Cambiar número</button>
          </>
        )}

        {paso === 'telefono' && whatsapp && (
          <p className="bm-acceso-pie">
            ¿Prefieres WhatsApp? <a href={whatsapp} target="_blank" rel="noreferrer">Escríbenos al {formatearTelefono(config?.whatsappNumero ?? '')}</a>
          </p>
        )}
      </div>

      <div className="bm-acceso-notas">
        <BotonTema className="bm-boton-icono" />
        <AvisoFuente fuente={fuente} />
        {api.modo === 'falso' && (
          <p>Con datos de prueba sirve cualquier código de 6 dígitos. Para entrar como proveedor usa el {formatearTelefono(TELEFONO_PROVEEDOR_FALSO)}.</p>
        )}
      </div>
    </main>
  );
}

/** Dirección y comuna del negocio: van en su factura del SII. Las piden el registro y Facturas si faltan. */
export function CamposDireccion({ direccion, comuna, onDireccion, onComuna }: {
  direccion: string; comuna: string; onDireccion: (v: string) => void; onComuna: (v: string) => void;
}) {
  return (
    <>
      <Campo etiqueta="Dirección de tu negocio">
        <input value={direccion} onChange={e => onDireccion(e.target.value)} placeholder="Av. Irarrázaval 1234" autoComplete="street-address" maxLength={70} required />
      </Campo>
      <Campo etiqueta="Comuna">
        <input value={comuna} onChange={e => onComuna(e.target.value)} list="bm-comunas" placeholder="Ñuñoa" maxLength={40} required />
        <datalist id="bm-comunas">{COMUNAS.map(c => <option key={c} value={c} />)}</datalist>
      </Campo>
    </>
  );
}

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <label className="bm-campo">
      <span className="bm-campo-etiqueta">{etiqueta}</span>
      {children}
      {ayuda}
    </label>
  );
}

/** Meta solo deja escribirle a quien nos habló en las últimas 24 h: el código queda esperando hasta que escriba. */
function VentanaCerrada({ enlace }: { enlace: string }) {
  return (
    <p className="bm-nota">
      Si no te llega, escríbenos un «Hola» por WhatsApp y el código te llega al instante.
      {enlace && <> <a href={enlace} target="_blank" rel="noreferrer">Abrir WhatsApp</a></>}
    </p>
  );
}

// ---------- Registro ----------

const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'Santiago', 'San Joaquín', 'La Florida', 'Las Condes', 'Maipú'];
const RUBROS: Array<[string, string]> = [
  ['almacen', 'Almacén'], ['minimarket', 'Minimarket'], ['panaderia', 'Panadería'], ['restaurante', 'Restaurante'],
  ['cafe', 'Café'], ['botilleria', 'Botillería'], ['farmacia', 'Farmacia'], ['otro', 'Otro'],
];

/** El rubro de la lista que sugiere el giro del SII ("Venta al por menor en almacenes" → almacén); si no se reconoce, ninguno. */
const RUBRO_DEL_GIRO: Array<[RegExp, string]> = [
  [/panader|amasander/i, 'panaderia'], [/minimarket|supermercado/i, 'minimarket'], [/almac[eé]n|abarrote/i, 'almacen'],
  [/cafeter|caf[eé]\b/i, 'cafe'], [/restaur|fuente de soda|comida/i, 'restaurante'], [/botiller|licor|bebidas alcoh/i, 'botilleria'],
  [/farmac/i, 'farmacia'],
];
const AYUDA_RUT: Record<'nada' | 'buscando' | 'listo' | 'simulado' | 'sinConfirmar' | 'error', string> = {
  nada: 'Con tu RUT traemos tus datos del SII. Tu factura sale a ese RUT (ambiente de certificación).',
  buscando: 'Buscando en el SII...',
  listo: 'Datos del SII: revísalos y corrige lo que haga falta.',
  simulado: 'Datos de prueba del SII: revísalos y corrige lo que haga falta.',
  sinConfirmar: RUT_SIN_CONFIRMAR,
  error: '',
};
const rubroDelGiro = (giro: string) => RUBRO_DEL_GIRO.find(([re]) => re.test(giro))?.[1];

type DatosDelRut = { estado: 'nada' } | { estado: 'buscando' } | { estado: 'listo'; datos: FacturaA } | { estado: 'error'; mensaje: string };

/**
 * Con un RUT válido y una pausa al escribir (400 ms), sus datos del SII. Solo manda la última consulta: si la persona
 * sigue escribiendo, la respuesta anterior se descarta.
 */
function useDatosDelRut(rut: string, consultar: (rut: string) => Promise<FacturaA>): DatosDelRut {
  const [r, setR] = useState<DatosDelRut>({ estado: 'nada' });
  useEffect(() => {
    setR({ estado: 'nada' });
    if (!validarRut(rut)) return;
    let vigente = true;
    const espera = window.setTimeout(() => {
      setR({ estado: 'buscando' });
      consultar(rut).then(
        datos => { if (vigente) setR({ estado: 'listo', datos }); },
        e => { if (vigente) setR({ estado: 'error', mensaje: mensajeDeError(e, 'No pudimos consultar el SII: escribe tus datos.') }); },
      );
    }, 400);
    return () => { vigente = false; window.clearTimeout(espera); };
  }, [rut, consultar]);
  return r;
}

/**
 * Lo que se pide a un número nuevo. Primero el RUT (su factura sale a ese RUT en el SII, ambiente de certificación): con
 * un RUT válido se consultan sus datos y se completan los campos vacíos, sin pisar lo que la persona ya escribió. Si el
 * SII no responde, se escribe a mano. Rubro opcional.
 */
function FormularioNegocio({ onEntrar, consultarRut }: {
  onEntrar: (datos: DatosEntrada) => Promise<void>; consultarRut: (rut: string) => Promise<FacturaA>;
}) {
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [rutRevisado, setRutRevisado] = useState(false);
  /** Error del RUT (formato o respuesta del SII): va bajo su campo. */
  const [errorRut, setErrorRut] = useState('');
  const campoRut = useRef<HTMLInputElement>(null);
  const [comuna, setComuna] = useState('');
  const [direccion, setDireccion] = useState('');
  const [rubro, setRubro] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const rutMalo = rutRevisado && rut.length > 0 && !validarRut(rut);
  const delSii = useDatosDelRut(rut, consultarRut);
  const avisoRut = errorRut || (delSii.estado === 'error' ? delSii.mensaje : '') || (rutMalo ? RUT_INVALIDO : '');

  // Lo que trae el SII completa solo los campos vacíos.
  useEffect(() => {
    if (delSii.estado !== 'listo') return;
    const d = delSii.datos;
    const siVacio = (nuevo?: string) => (actual: string) => (actual.trim() || !nuevo ? actual : nuevo);
    setNombre(siVacio(d.razonSocial));
    setDireccion(siVacio(d.direccion));
    setComuna(siVacio(d.comuna));
    setRubro(r => r ?? rubroDelGiro(d.giro));
  }, [delSii]);
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
    if (!direccion.trim() || !comuna.trim()) return setError('Escribe la dirección y la comuna de tu negocio: van en tu factura.');
    setEnviando(true);
    setErrorRut('');
    try {
      await onEntrar({ nombre: nombre.trim(), comuna: comuna.trim(), direccion: direccion.trim(), rut, ...(rubro ? { rubro } : {}) });
    } catch (err) {
      const mensaje = mensajeDeError(err, 'No pudimos registrarte. Inténtalo de nuevo.');
      if (/\bRUT\b|SII/.test(mensaje)) marcarRut(mensaje); else setError(mensaje);
      setEnviando(false);
    }
  };

  return (
    <form className="bm-formulario" onSubmit={enviar}>
      <Campo etiqueta="RUT de tu negocio o persona" ayuda={
        <span id="bm-rut-ayuda" className={avisoRut ? 'bm-ayuda bm-error' : 'bm-ayuda'} role={avisoRut ? 'alert' : 'status'}>
          {avisoRut || <><LogoSii tam={14} />{AYUDA_RUT[delSii.estado !== 'listo' ? delSii.estado : delSii.datos.sinConfirmar ? 'sinConfirmar' : delSii.datos.simulado ? 'simulado' : 'listo']}</>}
        </span>
      }>
        <input ref={campoRut} value={rut} onChange={e => { setRut(formatearRutAlEscribir(e.target.value)); setRutRevisado(false); setErrorRut(''); }} onBlur={() => setRutRevisado(true)}
          placeholder="12.345.678-5" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} required autoFocus
          aria-invalid={!!avisoRut} aria-describedby="bm-rut-ayuda" />
      </Campo>
      <Campo etiqueta="Nombre de tu negocio">
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Almacén Las Rosas" autoComplete="organization" maxLength={60} required />
      </Campo>
      <CamposDireccion direccion={direccion} comuna={comuna} onDireccion={setDireccion} onComuna={setComuna} />
      <fieldset className="bm-campo bm-rubros">
        <legend className="bm-campo-etiqueta">Rubro (opcional)</legend>
        <div className="bm-chips">
          {RUBROS.map(([id, texto]) => (
            <button key={id} type="button" className={`bm-chip${rubro === id ? ' elegido' : ''}`} aria-pressed={rubro === id}
              onClick={() => setRubro(r => (r === id ? undefined : id))}>{texto}</button>
          ))}
        </div>
      </fieldset>
      {error && <p className="bm-error" role="alert">{error}</p>}
      <button className="bm-boton bm-ancho" disabled={enviando}>{enviando ? 'Buscando tu RUT en el SII...' : 'Entrar'}</button>
    </form>
  );
}

/** Mientras llegan los datos con sesión. Si fallan (por ejemplo, un negocio que no vende abre el panel), deja entrar con otro número. */
export function CargandoCuenta({ error, texto, onSalir }: { error: string; texto: string; onSalir: () => void }) {
  if (!error) return <p className="vacio">{texto}</p>;
  return (
    <>
      <p className="error">{error}</p>
      <button type="button" className="cn-boton-texto" onClick={onSalir}>Entrar con otro número</button>
    </>
  );
}
