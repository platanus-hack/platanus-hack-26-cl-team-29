// "Conectar mi SII" en el panel del proveedor: el proveedor sube su certificado y el RUT de su empresa, y el servidor
// trae solo del SII los datos de la empresa, la resolución y los CAF. Lo que el SII no entregue se completa a mano en
// los pasos de abajo, cada uno resumido en una línea cuando ya está listo. El certificado y su clave solo viajan al subirlos: no quedan en
// el navegador (ni en localStorage ni en el estado, la clave se borra al enviarla).

import { explicarRechazoSii } from '../../../shared/sii-rechazos.ts';
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { fechaCorta, horaEnChile } from '../../../shared/fecha.ts';
import { nombreDocumento, TIPOS_DOCUMENTO, type TipoDocumento } from '../../../shared/documentos.ts';
import { contar } from '../../../shared/texto.ts';
import type { CanalApi } from './api.ts';
import { LogoSii } from '../marca/LogoSii.tsx';
import { mensajeDeError } from './logica.ts';
import { useEnvio } from './piezas.tsx';
import { useDatoEnVivo } from './useCanal.ts';
import { Modal } from '../marca/Modal.tsx';
import { Boton, Estado } from '../marca/componentes.tsx';
import type { CafSii, EstadoConexionSii, DatosEmpresaSii, FoliosSii, PasoSii } from './tipos.ts';

const POLEO_MS = 1500;
const NOMBRE_PASO: Record<PasoSii['id'], string> = {
  empresa: 'Datos de la empresa', resolucion: 'Resolución', caf_33: 'Folios de factura', caf_52: 'Folios de guía', caf_61: 'Folios de nota de crédito',
};
const ESTADO_PASO: Record<PasoSii['estado'], string> = { pendiente: 'En espera', en_curso: 'Consultando...', listo: 'Listo', omitido: 'Sin cambios', error: 'Falta' };


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

const buscandoEnSii = (e: EstadoConexionSii): boolean =>
  !!e.automatico?.activo || e.cafs.some(c => c.escaneando) || e.folios.some(f => f.estado === 'reponiendo');

/** Lo que dice el botón: conectado, usando la demo o por conectar. */
const etiquetaSii = (e: EstadoConexionSii) =>
  (e.demo?.usando ? `Usando ${e.demo.empresa} (Demo)` : e.conectado ? `SII conectado${e.empresa ? ` · ${e.empresa.razonSocial}` : ''}` : 'Conectar mi SII');

/**
 * El botón del SII en Facturas: dice si está conectado y abre un modal con la conexión (estado, pasos y la opción demo).
 * Folios repuestos, bajos o en espera llegan en vivo por `red:evento` (`sii.folios`); mientras la conexión automática
 * corre o se reponen folios, también se consulta el avance.
 */
export function BotonSii({ api, token }: Props) {
  const [abierto, setAbierto] = useState(false);
  const cargar = useCallback(() => api.siiEstado(token), [api, token]);
  const { dato: estado, setDato: setEstado, error } = useDatoEnVivo(api, cargar, 'sii.folios', buscandoEnSii, POLEO_MS);
  const cerrar = useCallback(() => setAbierto(false), []);
  if (!estado) return error ? <p className="bm-error">{error}</p> : null;
  return (
    <>
      <Boton variante={estado.conectado ? 'secundario' : 'sii'} onClick={() => setAbierto(true)}>
        {estado.conectado && <LogoSii tam={16} />}{etiquetaSii(estado)}
      </Boton>
      {abierto && (
        <Modal titulo="Conexión con el SII" onCerrar={cerrar}>
          <ConectarSii api={api} token={token} estado={estado} setEstado={setEstado} />
        </Modal>
      )}
    </>
  );
}

/** La conexión: su estado y, al abrirla (de entrada si no está conectado), los pasos. */
function ConectarSii({ api, token, estado, setEstado }: Props & { estado: EstadoConexionSii; setEstado: (e: EstadoConexionSii) => void }) {
  const [abierta, setAbierta] = useState(!estado.conectado);

  const factura = estado.folios.find(f => f.tipo === 33);
  const usandoDemo = !!estado.demo?.usando;
  return (
    <section className="bp-sii">
      <div className="bp-sii-meta">
        <Estado tono={estado.conectado ? 'sii' : 'neutro'}>
          {usandoDemo ? `Usando ${estado.demo!.empresa} (Demo)` : estado.conectado ? 'SII conectado' : 'SII sin conectar'}
        </Estado>
        <span>Certificación (maullin)</span>
      </div>
      {estado.conectado && estado.empresa ? (
        <>
          <p className="bm-titulo">{estado.empresa.razonSocial}</p>
          {factura && <FoliosFactura api={api} token={token} folios={factura} alCambiar={setEstado} />}
        </>
      ) : (
        <>
          <h2 className="bm-titulo bp-con-sii"><LogoSii tam={28} /><span>Conectar mi SII</span></h2>
          <p className="bm-bajada">
            Sube tu certificado digital y el RUT de tu empresa. Traemos del SII tus datos y tus folios (CAF), sin anular nada. Así tus facturas, guías y notas de crédito salen a tu nombre.
          </p>
        </>
      )}
      {!abierta && !usandoDemo && (
        <Boton ancho variante={estado.conectado ? 'secundario' : 'sii'} onClick={() => setAbierta(true)}>
          {estado.conectado && <LogoSii />}{estado.conectado ? 'Ver conexión' : 'Conectar mi SII'}
        </Boton>
      )}
      {estado.demo && (!estado.conectado || usandoDemo) && <UsarDemo api={api} token={token} demo={estado.demo} alCambiar={setEstado} />}
      {abierta && !usandoDemo && (
        <Pasos api={api} token={token} estado={estado} alCambiar={setEstado} onCerrar={() => setAbierta(false)} />
      )}
      <p className="bp-tenue">En uso real, cada proveedor conecta su propio certificado y sus folios.</p>
    </section>
  );
}

/** Solo demo: emitir con la empresa de la demo en vez de subir su certificado, o dejar de hacerlo. */
function UsarDemo({ api, token, demo, alCambiar }: Props & { demo: NonNullable<EstadoConexionSii['demo']>; alCambiar: (e: EstadoConexionSii) => void }) {
  const { enviando, error, enviar } = useEnvio();
  const cambiar = (usar: boolean) => enviar(async () => alCambiar(await api.siiUsarDemo(token, usar)));
  return (
    <>
      {demo.usando
        ? <p className="bm-bajada">Tus facturas salen emitidas por {demo.empresa} en el SII de certificación. Es solo para la demo.</p>
        : null}
      <button type="button" className="bm-boton-texto" disabled={enviando} onClick={() => cambiar(!demo.usando)}>
        {enviando ? 'Cambiando...' : demo.usando ? 'Dejar de usar la conexión de la demo' : `o usar ${demo.empresa} (Demo)`}
      </button>
      {error && <p className="bm-error">{error}</p>}
    </>
  );
}

function Pasos({ api, token, estado, alCambiar, onCerrar }: Props & { estado: EstadoConexionSii; alCambiar: (e: EstadoConexionSii) => void; onCerrar: () => void }) {
  const [editar, setEditar] = useState<'certificado' | 'empresa' | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const { enviando, error, enviar } = useEnvio();
  const pasoCert = !estado.titular || editar === 'certificado';
  // Mientras se trae todo del SII, los pasos manuales esperan: se muestran con lo que haya faltado.
  const enCurso = !!estado.automatico?.activo;
  const pasoEmpresa = !pasoCert && !enCurso && (!estado.empresa || !estado.resolucion || estado.resolucion.rechazada || editar === 'empresa');
  const hecho = (e: EstadoConexionSii) => { alCambiar(e); setEditar(null); };

  const desconectar = () => enviar(async () => {
    hecho(await api.siiDesconectar(token));
    setDesconectando(false);
  });

  return (
    <div className="bp-pasos">
      {!estado.puedeGuardar && (
        <p className="bm-error">El servidor no tiene configurada la llave para guardar tus datos del SII (SII_LLAVE_CIFRADO). Avísale a quien administra la red.</p>
      )}

      <article className="bp-paso">
        <p className="bm-etiqueta bp-con-sii"><LogoSii tam={14} /> Paso 1 · Certificado digital</p>
        {pasoCert ? <PasoCertificado api={api} token={token} alListo={hecho} onCancelar={estado.titular ? () => setEditar(null) : undefined} /> : (
          <Resumen texto={`Titular ${estado.titular} · vence el ${fechaCorta(estado.venceEl ?? '')}`} onCambiar={() => setEditar('certificado')} />
        )}
      </article>

      {!pasoCert && estado.automatico && <Automatico api={api} token={token} estado={estado} alCambiar={alCambiar} />}

      {!pasoCert && !enCurso && (
        <article className="bp-paso">
          <p className="bm-etiqueta bp-con-sii"><LogoSii tam={14} /> Paso 2 · Tu empresa</p>
          {pasoEmpresa ? <PasoEmpresa api={api} token={token} estado={estado} alListo={hecho} onCancelar={estado.empresa ? () => setEditar(null) : undefined} /> : (
            <Resumen
              texto={`${estado.empresa!.razonSocial} · ${estado.rutEmisor} · resolución del ${fechaCorta(estado.resolucion!.fecha)} n.º ${estado.resolucion!.numero}`}
              onCambiar={() => setEditar('empresa')}
            />
          )}
        </article>
      )}

      {!pasoCert && !pasoEmpresa && !enCurso && (
        <article className="bp-paso">
          <p className="bm-etiqueta bp-con-sii"><LogoSii tam={14} /> Paso 3 · Folios (CAF)</p>
          <p className="bm-bajada">
            Los traemos solos del SII. Si falta alguno, sube el XML del CAF. Buscamos en el SII el primer folio libre, uno por segundo, para no repetir uno ya usado.
          </p>
          {TIPOS_DOCUMENTO.map(tipo => (
            <FilaCaf key={tipo} api={api} token={token} tipo={tipo} cafs={estado.cafs.filter(c => c.tipo === tipo)} alCambiar={alCambiar} />
          ))}
        </article>
      )}

      {error && <p className="bm-error">{error}</p>}
      <div className="bp-acciones-texto">
        <button type="button" className="bm-boton-texto" onClick={onCerrar}>Cerrar</button>
        {estado.titular && !desconectando && (
          <button type="button" className="bm-boton-texto" onClick={() => setDesconectando(true)}>Desconectar mi SII</button>
        )}
      </div>
      {desconectando && (
        <div className="bp-aviso" role="alertdialog" aria-label="Desconectar mi SII">
          <h3>¿Desconectas tu SII?</h3>
          <p className="bm-bajada">Borramos tu certificado, su clave y tus CAF de la red. Los documentos ya emitidos no cambian.</p>
          <div className="bp-acciones-texto">
            <button type="button" className="bm-boton" onClick={() => { void desconectar(); }} disabled={enviando}>{enviando ? 'Desconectando...' : 'Sí, desconectar'}</button>
            <button type="button" className="bm-boton-texto" onClick={() => setDesconectando(false)} disabled={enviando}>No, volver</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Resumen({ texto, onCambiar }: { texto: string; onCambiar: () => void }) {
  return (
    <div className="bp-resumen">
      <p className="bp-texto">{texto}</p>
      <button type="button" className="bm-boton-texto" onClick={onCambiar}>Cambiar</button>
    </div>
  );
}

function PasoCertificado({ api, token, alListo, onCancelar }: Props & { alListo: (e: EstadoConexionSii) => void; onCancelar?: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clave, setClave] = useState('');
  const [rut, setRut] = useState('');
  const { enviando, error, setError, enviar: enviarA } = useEnvio();
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!archivo) return setError('Elige el archivo .pfx de tu certificado.');
    if (!clave) return setError('Escribe la clave de tu certificado.');
    void enviarA(async () => {
      const estado = await api.siiCertificado(token, await leerBase64(archivo), clave, rut.trim());
      setClave('');
      alListo(estado);
    });
  };
  return (
    <form className="bm-formulario" onSubmit={enviar}>
      <label className="bm-campo">
        <span className="bm-campo-etiqueta">Archivo .pfx o .p12</span>
        <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e: ChangeEvent<HTMLInputElement>) => setArchivo(e.target.files?.[0] ?? null)} />
      </label>
      <label className="bm-campo">
        <span className="bm-campo-etiqueta">Clave del certificado</span>
        <input type="password" value={clave} onChange={e => setClave(e.target.value)} autoComplete="off" />
      </label>
      <label className="bm-campo">
        <span className="bm-campo-etiqueta">RUT de tu empresa</span>
        <input value={rut} onChange={e => setRut(e.target.value)} placeholder="76123456-7" autoCapitalize="characters" maxLength={12} />
      </label>
      <p className="bp-tenue">Si lo dejas vacío, usamos el RUT del titular del certificado.</p>
      <p className="bp-tenue">Lo guardamos cifrado y solo lo usamos para hablar con el SII. Nunca se muestra de vuelta.</p>
      {error && <p className="bm-error">{error}</p>}
      <button className="bm-boton" disabled={enviando}>{enviando ? 'Revisando certificado...' : 'Conectar con el SII'}</button>
      {onCancelar && <button type="button" className="bm-boton-texto" onClick={onCancelar}>Volver</button>}
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
  const { enviando, error, setError, enviar } = useEnvio();

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
      setError(mensajeDeError(err));
    } finally {
      setLeyendo(false);
    }
  };

  const cambiar = (campo: keyof typeof SIN_EMPRESA) => (e: ChangeEvent<HTMLInputElement>) => {
    setDatos(d => ({ ...d, [campo]: e.target.value }));
    setOrigen('manual');
  };

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const envio: DatosEmpresaSii = {
      rutEmisor: rut.trim(), ...datos, fchResol, nroResol: Number(nroResol) || 0, origen,
    };
    void enviar(async () => alListo(await api.siiGuardarEmpresa(token, envio)));
  };

  const campo = (nombre: keyof typeof SIN_EMPRESA, etiqueta: string, max: number, extra: Record<string, string> = {}) => (
    <label className="bm-campo">
      <span className="bm-campo-etiqueta">{etiqueta}</span>
      <input value={datos[nombre]} onChange={cambiar(nombre)} maxLength={max} {...extra} />
    </label>
  );

  return (
    <form className="bm-formulario" onSubmit={guardar}>
      <div className="bp-fila-campo">
        <label className="bm-campo">
          <span className="bm-campo-etiqueta">RUT de la empresa</span>
          <input value={rut} onChange={e => setRut(e.target.value)} placeholder="76123456-7" autoCapitalize="characters" maxLength={12} />
        </label>
        <button type="button" className="bm-boton secundario" onClick={() => { void leerDelSii(); }} disabled={leyendo || !rut.trim()}>
          {leyendo ? 'Leyendo...' : 'Leer del SII'}
        </button>
      </div>
      {aviso && <p className="bp-ok">{aviso}</p>}
      {campo('razonSocial', 'Razón social', 100)}
      {campo('giro', 'Giro', 80)}
      {campo('acteco', 'Código de actividad económica', 6, { inputMode: 'numeric', placeholder: '6 dígitos' })}
      {campo('direccion', 'Dirección', 70)}
      <div className="bp-dos-campos">
        {campo('comuna', 'Comuna', 20)}
        {campo('ciudad', 'Ciudad (opcional)', 20)}
      </div>
      <div className="bp-dos-campos">
        <label className="bm-campo">
          <span className="bm-campo-etiqueta">Fecha de resolución</span>
          <input type="date" value={fchResol} onChange={e => setFchResol(e.target.value)} />
        </label>
        <label className="bm-campo">
          <span className="bm-campo-etiqueta">N.º de resolución</span>
          <input inputMode="numeric" value={nroResol} onChange={e => setNroResol(e.target.value.replace(/\D/g, ''))} maxLength={6} />
        </label>
      </div>
      <p className="bp-tenue">
        Si no la trajimos del SII: en el menú de certificación del SII, "Actualizar datos de empresa y usuarios (Nuevo)", campo Fecha de resolución. En certificación el número es 0.
      </p>
      {estado.resolucion?.rechazada && (
        <p className="bm-error">El SII rechazó la carátula de un envío (RCT) con esta resolución. Revisa la fecha y guárdala: hasta entonces no emitimos con ella.</p>
      )}
      {error && <p className="bm-error">{error}</p>}
      <button className="bm-boton" disabled={enviando}>{enviando ? 'Guardando...' : 'Guardar mi empresa'}</button>
      {onCancelar && <button type="button" className="bm-boton-texto" onClick={onCancelar}>Volver</button>}
    </form>
  );
}

/** Los CAF de un tipo: puede haber varios rangos (la reposición suma los que reobtiene o pide). */
function FilaCaf({ api, token, tipo, cafs, alCambiar }: Props & { tipo: TipoDocumento; cafs: CafSii[]; alCambiar: (e: EstadoConexionSii) => void }) {
  const { enviando, error, setError, enviar } = useEnvio();
  const [avisos, setAvisos] = useState<string[]>([]);
  const [manual, setManual] = useState('');
  const [aMano, setAMano] = useState(false);

  const subir = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    await enviar(async () => {
      const r = await api.siiCaf(token, await leerBase64(archivo));
      setAvisos(r.avisos);
      alCambiar(r.estado);
    });
  };

  const fijar = (e: FormEvent) => {
    e.preventDefault();
    void enviar(async () => {
      alCambiar(await api.siiFolio(token, tipo, Number(manual)));
      setAMano(false);
      setManual('');
    });
  };

  const caf = cafs.at(-1);
  const enBusqueda = cafs.find(c => c.escaneando);
  const p = enBusqueda?.progreso;
  const libres = cafs.reduce((n, c) => n + (c.libres ?? 0), 0);
  return (
    <div className="bp-caf">
      <div className="bp-caf-cabecera">
        <div>
          <strong>{nombreDocumento(tipo)} ({tipo})</strong>
          {cafs.length === 0 && <p className="bp-tenue">Sin CAF</p>}
          {cafs.slice(-3).map(c => <p key={c.desde} className="bp-tenue">Folios {c.desde} a {c.hasta} · autorizado el {fechaCorta(c.fa)}</p>)}
          {cafs.length > 3 && <p className="bp-tenue">y {contar(cafs.length - 3, 'rango anterior', 'rangos anteriores')}</p>}
        </div>
        <label className={`bm-boton secundario${enviando ? ' deshabilitado' : ''}`}>
          {enviando ? 'Subiendo...' : caf ? 'Subir otro' : 'Subir CAF'}
          <input type="file" accept=".xml,text/xml,application/xml" onChange={e => { void subir(e); }} disabled={enviando} hidden />
        </label>
      </div>
      {enBusqueda && p && (
        <div className="bp-progreso" role="status">
          <p className="bp-texto">Buscando el primer folio libre en el SII: folio {p.folio}, {contar(p.revisados, 'revisado')}</p>
          <div className="bp-carga" aria-hidden="true"><span /></div>
        </div>
      )}
      {caf && !enBusqueda && cafs.some(c => c.primerLibre !== null) && (
        <p className="bp-ok"><LogoSii />{cafs.length === 1 && caf.primerLibre !== null ? `Primer folio libre: ${caf.primerLibre} · ` : ''}{contar(libres, 'folio libre', 'folios libres')}</p>
      )}
      {cafs.filter(c => c.error).map(c => <p key={c.desde} className="bm-error">{c.error}</p>)}
      {avisos.map(a => <p key={a} className="bp-tenue">{a}</p>)}
      {error && <p className="bm-error">{error}</p>}
      {caf && (aMano ? (
        <form className="bp-fila-campo" onSubmit={fijar}>
          <label className="bm-campo">
            <span className="bm-campo-etiqueta">Primer folio a usar</span>
            <input inputMode="numeric" value={manual} onChange={e => setManual(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button className="bm-boton secundario" disabled={enviando}>{enviando ? 'Guardando...' : 'Usar este folio'}</button>
        </form>
      ) : (
        <button type="button" className="bm-boton-texto" onClick={() => setAMano(true)}>Indicar el primer folio a mano</button>
      ))}
    </div>
  );
}

const ESTADO_FOLIOS: Record<FoliosSii['estado'], string> = {
  suficiente: 'Al día', bajo: 'Bajo el mínimo', reponiendo: 'Trayendo folios del SII...', en_espera: 'El SII pidió esperar', sin_caf: 'Sin CAF',
};

/**
 * Folios de factura libres y su reposición automática (reobtener primero, pedir solo lo que falta, nunca anular).
 * "Traer más folios" corre la misma reposición; en espera tras un rechazo del SII no se puede insistir.
 */
function FoliosFactura({ api, token, folios, alCambiar }: Props & { folios: FoliosSii; alCambiar: (e: EstadoConexionSii) => void }) {
  const { enviando, error, enviar } = useEnvio();
  const ocupado = enviando || folios.estado === 'reponiendo' || folios.estado === 'en_espera';
  const traer = () => enviar(async () => { alCambiar(await api.siiTraerFolios(token, 33)); });
  return (
    <div className="bp-folios" aria-live="polite">
      <p className="bp-texto bp-con-sii">
        <LogoSii tam={14} />
        <span>Folios de factura: {contar(folios.libres, 'libre')} · <span className={`bp-folios-estado ${folios.estado}`}>{ESTADO_FOLIOS[folios.estado]}</span></span>
      </p>
      {folios.estado === 'bajo' && <p className="bp-tenue">Se mantienen al menos {contar(folios.minimo, 'folio')}: se repondrán al emitir.</p>}
      {folios.esperaHasta && <p className="bp-tenue">Se vuelve a intentar a las {horaEnChile(Date.parse(folios.esperaHasta))}.</p>}
      {explicarRechazoSii(folios.mensajeSii) && <p className="bm-error">{explicarRechazoSii(folios.mensajeSii)}</p>}
      {folios.mensajeSii && <p className="bp-tenue">El SII dice: «{folios.mensajeSii}»</p>}
      {error && <p className="bm-error">{error}</p>}
      <button type="button" className="bm-boton secundario bm-ancho" onClick={() => { void traer(); }} disabled={ocupado}>
        <LogoSii /> {folios.estado === 'reponiendo' || enviando ? 'Trayendo folios...' : 'Traer más folios'}
      </button>
    </div>
  );
}

/** Avance de la conexión automática: un paso por línea, con el texto del SII cuando algo falta. */
function Automatico({ api, token, estado, alCambiar }: Props & { estado: EstadoConexionSii; alCambiar: (e: EstadoConexionSii) => void }) {
  const { enviando, error, enviar } = useEnvio();
  const auto = estado.automatico!;
  const reintentar = () => enviar(async () => { alCambiar(await api.siiAutomatico(token, estado.rutEmisor ?? '')); });
  return (
    <article className="bp-paso" aria-live="polite">
      <p className="bm-etiqueta bp-con-sii"><LogoSii tam={14} /> {auto.activo ? 'Conectando con el SII...' : 'Traído del SII'}</p>
      {auto.pasos.map(p => (
        <div key={p.id} className="bp-resumen">
          <div>
            <p className="bp-texto">{NOMBRE_PASO[p.id]} · {ESTADO_PASO[p.estado]}</p>
            {(explicarRechazoSii(p.mensajeSii) ?? p.detalle) && <p className={p.estado === 'error' ? 'bm-error' : 'bp-tenue'}>{explicarRechazoSii(p.mensajeSii) ?? p.detalle}</p>}
            {p.mensajeSii && <p className="bp-tenue">El SII dice: «{p.mensajeSii}»</p>}
          </div>
        </div>
      ))}
      {error && <p className="bm-error">{error}</p>}
      {!auto.activo && auto.pasos.some(p => p.estado === 'error') && (
        <button type="button" className="bm-boton secundario bm-ancho" onClick={() => { void reintentar(); }} disabled={enviando}>
          <LogoSii /> {enviando ? 'Trayendo del SII...' : 'Volver a traer del SII'}
        </button>
      )}
    </article>
  );
}
