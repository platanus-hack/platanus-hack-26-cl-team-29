// "Conectar mi SII" en el panel del proveedor: el proveedor sube su certificado y el RUT de su empresa, y el servidor
// trae solo del SII los datos de la empresa, la resolución y los CAF. Lo que el SII no entregue se completa a mano en
// los pasos de abajo, cada uno resumido en una línea cuando ya está listo. El certificado y su clave solo viajan al subirlos: no quedan en
// el navegador (ni en localStorage ni en el estado, la clave se borra al enviarla).

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { fechaCorta } from '../../../shared/fecha.ts';
import { nombreDocumento, TIPOS_DOCUMENTO, type TipoDocumento } from '../../../shared/documentos.ts';
import { contar } from '../../../shared/texto.ts';
import type { CanalApi } from './api.ts';
import { LogoSii } from './iconos.tsx';
import type { CafSii, EstadoConexionSii, DatosEmpresaSii, PasoSii } from './tipos.ts';

const POLEO_MS = 1500;
const NOMBRE_PASO: Record<PasoSii['id'], string> = {
  empresa: 'Datos de la empresa', resolucion: 'Resolución', caf_33: 'Folios de factura', caf_52: 'Folios de guía', caf_61: 'Folios de nota de crédito',
};
const ESTADO_PASO: Record<PasoSii['estado'], string> = { pendiente: 'En espera', en_curso: 'Consultando...', listo: 'Listo', omitido: 'Sin cambios', error: 'Falta' };

const mensaje = (e: unknown) => (e instanceof Error ? e.message : 'No pudimos completarlo. Inténtalo de nuevo.');

/** Contenido del archivo en base64, leído en el navegador. */
function leerBase64(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result).replace(/^data:[^,]*,/, ''));
    lector.onerror = () => rechazar(new Error('No pudimos leer el archivo.'));
    lector.readAsDataURL(archivo);
  });
}

interface Props {
  api: CanalApi;
  token: string;
}

/** Tarjeta del panel: el estado de la conexión y, al abrirla, los tres pasos. */
export function ConectarSii({ api, token }: Props) {
  const [estado, setEstado] = useState<EstadoConexionSii | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [error, setError] = useState('');

  const recargar = useCallback(async () => {
    try {
      setEstado(await api.siiEstado(token));
    } catch (e) {
      setError(mensaje(e));
    }
  }, [api, token]);

  useEffect(() => { void recargar(); }, [recargar]);

  // Mientras la conexión automática corre o se busca el primer folio libre de algún CAF, se consulta el avance.
  const buscando = !!estado?.automatico?.activo || !!estado?.cafs.some(c => c.escaneando);
  useEffect(() => {
    if (!buscando) return;
    const t = setInterval(() => { void recargar(); }, POLEO_MS);
    return () => clearInterval(t);
  }, [buscando, recargar]);

  if (!estado) {
    return error ? <p className="error">{error}</p> : null;
  }

  const factura = estado.cafs.find(c => c.tipo === 33);
  return (
    <section className="tarjeta cn-sii-conexion">
      <div className="cn-fila-meta">
        <span className={`cn-chip cn-con-sii ${estado.conectado ? 'conectado' : ''}`}><LogoSii tam={14} />{estado.conectado ? 'SII conectado' : 'SII sin conectar'}</span>
        <span className="mono tenue">Certificación (maullin)</span>
      </div>
      {estado.conectado && estado.empresa ? (
        <>
          <p className="cn-texto-grande cn-sub">{estado.empresa.razonSocial}</p>
          <p className="mono tenue cn-texto">{contar(factura?.libres ?? 0, 'folio libre', 'folios libres')} de factura</p>
        </>
      ) : (
        <>
          <h2 className="cn-producto cn-con-icono"><LogoSii tam={28} /><span>Conectar mi SII</span></h2>
          <p className="mono tenue cn-texto">
            Sube tu certificado digital y el RUT de tu empresa. Traemos del SII tus datos y tus folios (CAF), sin anular nada. Así tus facturas, guías y notas de crédito salen a tu nombre.
            {estado.respaldoVariables && ' Mientras no termines, la red usa el SII configurado en el servidor.'}
          </p>
        </>
      )}
      {!abierta && (
        <button type="button" className={`boton cn-ancho ${estado.conectado ? 'secundario cn-secundario' : 'cn-boton-sii'}`} onClick={() => setAbierta(true)}>
          <LogoSii /> {estado.conectado ? 'Ver conexión' : 'Conectar mi SII'}
        </button>
      )}
      {abierta && (
        <Pasos api={api} token={token} estado={estado} alCambiar={setEstado} onCerrar={() => setAbierta(false)} />
      )}
      <p className="nota-demo cn-sub">En uso real, cada proveedor conecta su propio certificado y sus folios.</p>
    </section>
  );
}

function Pasos({ api, token, estado, alCambiar, onCerrar }: Props & { estado: EstadoConexionSii; alCambiar: (e: EstadoConexionSii) => void; onCerrar: () => void }) {
  const [editar, setEditar] = useState<'certificado' | 'empresa' | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const [error, setError] = useState('');
  const pasoCert = !estado.titular || editar === 'certificado';
  // Mientras se trae todo del SII, los pasos manuales esperan: se muestran con lo que haya faltado.
  const enCurso = !!estado.automatico?.activo;
  const pasoEmpresa = !pasoCert && !enCurso && (!estado.empresa || !estado.resolucion || estado.resolucion.rechazada || editar === 'empresa');
  const hecho = (e: EstadoConexionSii) => { alCambiar(e); setEditar(null); };

  const desconectar = async () => {
    setError('');
    try {
      hecho(await api.siiDesconectar(token));
      setDesconectando(false);
    } catch (e) {
      setError(mensaje(e));
    }
  };

  return (
    <div className="cn-pasos">
      {!estado.puedeGuardar && (
        <p className="error">El servidor no tiene configurada la llave para guardar tus datos del SII (SII_LLAVE_CIFRADO). Avísale a quien administra la red.</p>
      )}

      <article className="cn-paso">
        <p className="etiqueta cn-con-sii"><LogoSii tam={14} /> Paso 1 · Certificado digital</p>
        {pasoCert ? <PasoCertificado api={api} token={token} alListo={hecho} onCancelar={estado.titular ? () => setEditar(null) : undefined} /> : (
          <Resumen texto={`Titular ${estado.titular} · vence el ${fechaCorta(estado.venceEl ?? '')}`} onCambiar={() => setEditar('certificado')} />
        )}
      </article>

      {!pasoCert && estado.automatico && <Automatico api={api} token={token} estado={estado} alCambiar={alCambiar} />}

      {!pasoCert && !enCurso && (
        <article className="cn-paso">
          <p className="etiqueta cn-con-sii"><LogoSii tam={14} /> Paso 2 · Tu empresa</p>
          {pasoEmpresa ? <PasoEmpresa api={api} token={token} estado={estado} alListo={hecho} onCancelar={estado.empresa ? () => setEditar(null) : undefined} /> : (
            <Resumen
              texto={`${estado.empresa!.razonSocial} · ${estado.rutEmisor} · resolución del ${fechaCorta(estado.resolucion!.fecha)} n.º ${estado.resolucion!.numero}`}
              onCambiar={() => setEditar('empresa')}
            />
          )}
        </article>
      )}

      {!pasoCert && !pasoEmpresa && !enCurso && (
        <article className="cn-paso">
          <p className="etiqueta cn-con-sii"><LogoSii tam={14} /> Paso 3 · Folios (CAF)</p>
          <p className="mono tenue cn-texto">
            Los traemos solos del SII. Si falta alguno, sube el XML del CAF. Buscamos en el SII el primer folio libre, uno por segundo, para no repetir uno ya usado.
          </p>
          {TIPOS_DOCUMENTO.map(tipo => (
            <FilaCaf key={tipo} api={api} token={token} tipo={tipo} caf={estado.cafs.find(c => c.tipo === tipo)} alCambiar={alCambiar} />
          ))}
        </article>
      )}

      {error && <p className="error">{error}</p>}
      <div className="cn-acciones">
        <button type="button" className="cn-boton-texto" onClick={onCerrar}>Cerrar</button>
        {estado.titular && !desconectando && (
          <button type="button" className="cn-boton-texto" onClick={() => setDesconectando(true)}>Desconectar mi SII</button>
        )}
      </div>
      {desconectando && (
        <div className="cn-confirmar" role="alertdialog" aria-label="Desconectar mi SII">
          <h3>¿Desconectas tu SII?</h3>
          <p className="cn-confirmar-texto">Borramos tu certificado, su clave y tus CAF de la red. Los documentos ya emitidos no cambian.</p>
          <div className="cn-acciones">
            <button type="button" className="boton" onClick={() => { void desconectar(); }}>Sí, desconectar</button>
            <button type="button" className="cn-boton-texto" onClick={() => setDesconectando(false)}>No, volver</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Resumen({ texto, onCambiar }: { texto: string; onCambiar: () => void }) {
  return (
    <div className="cn-resumen">
      <p className="mono">{texto}</p>
      <button type="button" className="cn-boton-texto" onClick={onCambiar}>Cambiar</button>
    </div>
  );
}

function PasoCertificado({ api, token, alListo, onCancelar }: Props & { alListo: (e: EstadoConexionSii) => void; onCancelar?: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clave, setClave] = useState('');
  const [rut, setRut] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!archivo) return setError('Elige el archivo .pfx de tu certificado.');
    if (!clave) return setError('Escribe la clave de tu certificado.');
    setEnviando(true);
    setError('');
    try {
      const estado = await api.siiCertificado(token, await leerBase64(archivo), clave, rut.trim());
      setClave('');
      alListo(estado);
    } catch (err) {
      setError(mensaje(err));
      setEnviando(false);
    }
  };
  return (
    <form className="formulario" onSubmit={enviar}>
      <label className="campo">
        <span className="etiqueta">Archivo .pfx o .p12</span>
        <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e: ChangeEvent<HTMLInputElement>) => setArchivo(e.target.files?.[0] ?? null)} />
      </label>
      <label className="campo">
        <span className="etiqueta">Clave del certificado</span>
        <input type="password" value={clave} onChange={e => setClave(e.target.value)} autoComplete="off" />
      </label>
      <label className="campo">
        <span className="etiqueta">RUT de tu empresa</span>
        <input value={rut} onChange={e => setRut(e.target.value)} placeholder="76123456-7" autoCapitalize="characters" maxLength={12} />
      </label>
      <p className="mono tenue cn-nota-pie">Si lo dejas vacío, usamos el RUT del titular del certificado.</p>
      <p className="mono tenue cn-nota-pie">Lo guardamos cifrado y solo lo usamos para hablar con el SII. Nunca se muestra de vuelta.</p>
      {error && <p className="error">{error}</p>}
      <button className="boton" disabled={enviando}>{enviando ? 'Revisando certificado...' : 'Conectar con el SII'}</button>
      {onCancelar && <button type="button" className="cn-boton-texto" onClick={onCancelar}>Volver</button>}
    </form>
  );
}

const SIN_EMPRESA = { razonSocial: '', giro: '', acteco: '', direccion: '', comuna: '', ciudad: '' };

function PasoEmpresa({ api, token, estado, alListo, onCancelar }: Props & { estado: EstadoConexionSii; alListo: (e: EstadoConexionSii) => void; onCancelar?: () => void }) {
  const [rut, setRut] = useState(estado.rutEmisor ?? '');
  const [datos, setDatos] = useState(() => estado.empresa
    ? { ...SIN_EMPRESA, ...estado.empresa, acteco: String(estado.empresa.acteco), ciudad: estado.empresa.ciudad ?? '' }
    : SIN_EMPRESA);
  const [origen, setOrigen] = useState<'sii' | 'manual'>(estado.origenEmpresa ?? 'manual');
  const [fchResol, setFchResol] = useState(estado.resolucion?.fecha ?? '');
  const [nroResol, setNroResol] = useState(String(estado.resolucion?.numero ?? 0));
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const leerDelSii = async () => {
    setLeyendo(true);
    setAviso('');
    setError('');
    try {
      const f = await api.siiConsultarEmpresa(token, rut.trim());
      setDatos({ razonSocial: f.razonSocial, giro: f.giro, acteco: String(f.acteco || ''), direccion: f.direccion, comuna: f.comuna, ciudad: f.ciudad ?? '' });
      setOrigen('sii');
      setAviso('Datos leídos del SII. Revísalos antes de guardar.');
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setLeyendo(false);
    }
  };

  const cambiar = (campo: keyof typeof SIN_EMPRESA) => (e: ChangeEvent<HTMLInputElement>) => {
    setDatos(d => ({ ...d, [campo]: e.target.value }));
    setOrigen('manual');
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    const envio: DatosEmpresaSii = {
      rutEmisor: rut.trim(), ...datos, fchResol, nroResol: Number(nroResol) || 0, origen,
    };
    try {
      alListo(await api.siiGuardarEmpresa(token, envio));
    } catch (err) {
      setError(mensaje(err));
      setEnviando(false);
    }
  };

  const campo = (nombre: keyof typeof SIN_EMPRESA, etiqueta: string, max: number, extra: Record<string, string> = {}) => (
    <label className="campo">
      <span className="etiqueta">{etiqueta}</span>
      <input value={datos[nombre]} onChange={cambiar(nombre)} maxLength={max} {...extra} />
    </label>
  );

  return (
    <form className="formulario" onSubmit={guardar}>
      <div className="cn-fila-campo">
        <label className="campo">
          <span className="etiqueta">RUT de la empresa</span>
          <input value={rut} onChange={e => setRut(e.target.value)} placeholder="76123456-7" autoCapitalize="characters" maxLength={12} />
        </label>
        <button type="button" className="boton secundario cn-boton-leer" onClick={() => { void leerDelSii(); }} disabled={leyendo || !rut.trim()}>
          {leyendo ? 'Leyendo...' : 'Leer del SII'}
        </button>
      </div>
      {aviso && <p className="cn-ok">{aviso}</p>}
      {campo('razonSocial', 'Razón social', 100)}
      {campo('giro', 'Giro', 80)}
      {campo('acteco', 'Código de actividad económica', 6, { inputMode: 'numeric', placeholder: '6 dígitos' })}
      {campo('direccion', 'Dirección', 70)}
      <div className="cn-dos-campos">
        {campo('comuna', 'Comuna', 20)}
        {campo('ciudad', 'Ciudad (opcional)', 20)}
      </div>
      <div className="cn-dos-campos">
        <label className="campo">
          <span className="etiqueta">Fecha de resolución</span>
          <input type="date" value={fchResol} onChange={e => setFchResol(e.target.value)} />
        </label>
        <label className="campo">
          <span className="etiqueta">N.º de resolución</span>
          <input inputMode="numeric" value={nroResol} onChange={e => setNroResol(e.target.value.replace(/\D/g, ''))} maxLength={6} />
        </label>
      </div>
      <p className="mono tenue cn-nota-pie">
        Si no la trajimos del SII: en el menú de certificación del SII, "Actualizar datos de empresa y usuarios (Nuevo)", campo Fecha de resolución. En certificación el número es 0.
      </p>
      {estado.resolucion?.rechazada && (
        <p className="error">El SII rechazó la carátula de un envío (RCT) con esta resolución. Revisa la fecha y guárdala: hasta entonces no emitimos con ella.</p>
      )}
      {error && <p className="error">{error}</p>}
      <button className="boton" disabled={enviando}>{enviando ? 'Guardando...' : 'Guardar mi empresa'}</button>
      {onCancelar && <button type="button" className="cn-boton-texto" onClick={onCancelar}>Volver</button>}
    </form>
  );
}

function FilaCaf({ api, token, tipo, caf, alCambiar }: Props & { tipo: TipoDocumento; caf?: CafSii; alCambiar: (e: EstadoConexionSii) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  const [manual, setManual] = useState('');
  const [aMano, setAMano] = useState(false);

  const subir = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setEnviando(true);
    setError('');
    try {
      const r = await api.siiCaf(token, await leerBase64(archivo));
      setAvisos(r.avisos);
      alCambiar(r.estado);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setEnviando(false);
    }
  };

  const fijar = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      alCambiar(await api.siiFolio(token, tipo, Number(manual)));
      setAMano(false);
      setManual('');
    } catch (err) {
      setError(mensaje(err));
    }
  };

  const p = caf?.progreso;
  return (
    <div className="cn-caf">
      <div className="cn-caf-cabecera">
        <div>
          <strong>{nombreDocumento(tipo)} ({tipo})</strong>
          <p className="mono tenue">
            {!caf ? 'Sin CAF' : `Folios ${caf.desde} a ${caf.hasta} · autorizado el ${fechaCorta(caf.fa)}`}
          </p>
        </div>
        <label className={`boton secundario cn-boton-archivo${enviando ? ' deshabilitado' : ''}`}>
          {enviando ? 'Subiendo...' : caf ? 'Cambiar' : 'Subir CAF'}
          <input type="file" accept=".xml,text/xml,application/xml" onChange={e => { void subir(e); }} disabled={enviando} hidden />
        </label>
      </div>
      {caf?.escaneando && p && (
        <div className="cn-progreso" role="status">
          <p className="mono">Buscando el primer folio libre en el SII: folio {p.folio}, {contar(p.revisados, 'revisado')}</p>
          <div className="cn-barra" aria-hidden="true"><span /></div>
        </div>
      )}
      {caf && !caf.escaneando && caf.primerLibre !== null && (
        <p className="cn-ok cn-con-sii"><LogoSii />Primer folio libre: {caf.primerLibre} · {contar(caf.libres ?? 0, 'folio libre', 'folios libres')}</p>
      )}
      {caf?.error && <p className="error">{caf.error}</p>}
      {avisos.map(a => <p key={a} className="mono tenue cn-nota-pie">{a}</p>)}
      {error && <p className="error">{error}</p>}
      {caf && (aMano ? (
        <form className="cn-fila-campo" onSubmit={fijar}>
          <label className="campo">
            <span className="etiqueta">Primer folio a usar</span>
            <input inputMode="numeric" value={manual} onChange={e => setManual(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button className="boton secundario cn-boton-leer">Usar este folio</button>
        </form>
      ) : (
        <button type="button" className="cn-boton-texto" onClick={() => setAMano(true)}>Indicar el primer folio a mano</button>
      ))}
    </div>
  );
}

/** Avance de la conexión automática: un paso por línea, con el texto del SII cuando algo falta. */
function Automatico({ api, token, estado, alCambiar }: Props & { estado: EstadoConexionSii; alCambiar: (e: EstadoConexionSii) => void }) {
  const [error, setError] = useState('');
  const auto = estado.automatico!;
  const reintentar = async () => {
    setError('');
    try {
      alCambiar(await api.siiAutomatico(token, estado.rutEmisor ?? ''));
    } catch (e) {
      setError(mensaje(e));
    }
  };
  return (
    <article className="cn-paso" aria-live="polite">
      <p className="etiqueta cn-con-sii"><LogoSii tam={14} /> {auto.activo ? 'Conectando con el SII...' : 'Traído del SII'}</p>
      {auto.pasos.map(p => (
        <div key={p.id} className="cn-resumen">
          <div>
            <p className="mono">{NOMBRE_PASO[p.id]} · {ESTADO_PASO[p.estado]}</p>
            {p.detalle && <p className={p.estado === 'error' ? 'error' : 'mono tenue cn-nota-pie'}>{p.detalle}</p>}
            {p.mensajeSii && <p className="mono tenue cn-nota-pie">El SII dice: «{p.mensajeSii}»</p>}
          </div>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      {!auto.activo && auto.pasos.some(p => p.estado === 'error') && (
        <button type="button" className="boton secundario cn-ancho" onClick={() => { void reintentar(); }}><LogoSii /> Volver a traer del SII</button>
      )}
    </article>
  );
}
