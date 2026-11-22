// /app#credito: el crédito Bando del comprador. Bando le paga al proveedor al facturar y el negocio paga a 30, 45 o 60
// días con su tarjeta inscrita en Transbank; el cupo y el plazo suben con cada pago a tiempo. Se actualiza con cada
// `red:evento` (crédito otorgado o cobrado, tarjeta inscrita). Decisión: docs/decisiones/20261121-2018-credito-bando.md

import { useEffect, useState } from 'react';
import type { LineaCredito } from '../../../shared/credito.ts';
import { fechaCorta } from '../../../shared/fecha.ts';
import { dinero } from '../../../shared/formato.ts';
import { BANCOS, TIPOS_CUENTA, validarCuenta } from '../../../shared/cuenta-bancaria.ts';
import { contar } from '../../../shared/texto.ts';
import type { CanalApi } from './api.ts';
import { Icono } from './iconos.tsx';
import { Vacio } from './piezas.tsx';
import type { FotoRed } from './tipos.ts';
import type { Documento } from '../red/tipos.ts';
import { Boton, Estado } from '../marca/componentes.tsx';

interface CreditoComprador {
  id: string;
  proveedorId: string;
  monto: number;
  plazoDias: number;
  venceEn: string;
  estado: 'vigente' | 'pagado' | 'atrasado';
  cobro?: { en: string };
}

interface ResumenCredito {
  linea: LineaCredito;
  deuda: number;
  disponible: number;
  tarjeta: { marca: string; ultimos4: string } | null;
  creditos: CreditoComprador[];
  ambiente: 'falsa' | 'integracion' | 'produccion';
  exigeTarjeta: boolean;
}

const pedir = async <T,>(url: string, token: string, metodo = 'GET', cuerpo?: unknown): Promise<T> => {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (cuerpo !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.mensaje ?? 'No pudimos traer tu crédito.');
  return datos as T;
};

/** Dónde estaba la persona al ir a inscribir la tarjeta, para volver ahí y no a la lista de compras. */
const VOLVER_TRAS_TARJETA = 'bando:volver-tras-tarjeta';

/**
 * Al volver de Transbank con la tarjeta inscrita (`?tarjeta=ok`), lleva de vuelta al producto al que se estaba sumando
 * (`#compra/<compra>/<producto>`). Sin almacenamiento del navegador queda en la lista, como antes.
 */
export function volverTrasTarjeta() {
  let destino: string | null = null;
  try {
    destino = sessionStorage.getItem(VOLVER_TRAS_TARJETA);
    sessionStorage.removeItem(VOLVER_TRAS_TARJETA);
  } catch { /* sin almacenamiento: queda donde la dejó el servidor */ }
  if (new URLSearchParams(location.search).get('tarjeta') === 'ok' && destino?.startsWith('#compra/') && destino !== location.hash) location.hash = destino;
}

/** Transbank espera un POST de formulario con el token: se arma y se envía (sale de la página). */
export function irATransbank({ token, url }: { token: string; url: string }) {
  try { sessionStorage.setItem(VOLVER_TRAS_TARJETA, location.hash); } catch { /* sin almacenamiento: vuelve a la lista */ }
  const form = Object.assign(document.createElement('form'), { method: 'POST', action: url });
  form.append(Object.assign(document.createElement('input'), { type: 'hidden', name: 'TBK_TOKEN', value: token }));
  document.body.append(form);
  form.submit();
}

const ESTADO: Record<CreditoComprador['estado'], string> = { vigente: 'por pagar', pagado: 'pagado', atrasado: 'atrasado' };

export function MiCredito({ api, token, foto, cambio }: { api: CanalApi; token: string; foto: FotoRed; cambio: number }) {
  const [datos, setDatos] = useState<ResumenCredito | null>(null);
  const [error, setError] = useState('');
  const [inscribiendo, setInscribiendo] = useState(false);
  const vuelta = new URLSearchParams(location.search).get('tarjeta');

  useEffect(() => {
    if (api.modo !== 'real') return;
    let activo = true;
    pedir<ResumenCredito>('/api/pagos/yo', token)
      .then(d => { if (activo) { setDatos(d); setError(''); } })
      .catch((e: Error) => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [api.modo, token, cambio]);

  if (api.modo !== 'real') return <Vacio titulo="Crédito Bando" texto="Disponible con la red real: Bando le paga al proveedor y tú pagas a 30 días." />;
  if (!datos) return <section className="cn-seccion"><p className={error ? 'error' : 'vacio'}>{error || 'Cargando tu crédito...'}</p></section>;

  const { linea, tarjeta } = datos;
  const inscribir = async () => {
    setInscribiendo(true);
    try {
      irATransbank(await pedir('/api/pagos/yo/tarjeta', token, 'POST'));
    } catch (e) {
      setError((e as Error).message);
      setInscribiendo(false);
    }
  };
  const proveedor = (id: string) => foto.negocios.find(n => n.id === id)?.nombre ?? 'Proveedor';

  return (
    <section className="cn-seccion">
      {vuelta === 'ok' && <p className="cn-ok">Tarjeta inscrita. Tus compras se pagan solas al vencer.</p>}
      {vuelta === 'error' && <p className="error">No se inscribió la tarjeta. Puedes intentarlo de nuevo.</p>}
      {error && <p className="error">{error}</p>}

      <div className="tarjeta cn-credito">
        <p className="etiqueta">Crédito Bando · nivel {linea.nombre}</p>
        <p className="cn-credito-cupo">{dinero(datos.disponible)}</p>
        <p className="mono tenue">disponible de {dinero(linea.cupo)} · pagas a {linea.plazoDias} días</p>
        <div className="cn-credito-barra" role="img" aria-label={`Usado ${dinero(datos.deuda)} de ${dinero(linea.cupo)}`}>
          <span style={{ width: `${Math.min(100, (datos.deuda / linea.cupo) * 100)}%` }} />
        </div>
        <p className="mono cn-credito-sube">
          {linea.siguiente
            ? `Con ${contar(linea.siguiente.faltan, 'pago', 'pagos')} a tiempo más subes a ${linea.siguiente.nombre}: ${dinero(linea.siguiente.cupo)} a ${linea.siguiente.plazoDias} días.`
            : 'Tienes el cupo y el plazo más altos.'}
        </p>
        <p className="mono tenue cn-nota-pie">Bando le paga al proveedor apenas sale la factura.</p>
      </div>

      <div className="tarjeta cn-credito-tarjeta">
        <Icono nombre="tarjeta" />
        {tarjeta
          ? <div><strong>{tarjeta.marca} terminada en {tarjeta.ultimos4}</strong><p className="mono tenue">Se cobra sola el día que vence cada compra.</p></div>
          : <div><strong>Inscribe tu tarjeta</strong><p className="mono tenue">Una vez, en Transbank. Bando nunca ve el número.</p></div>}
        {!tarjeta && <button type="button" className="boton" disabled={inscribiendo} onClick={inscribir}>{inscribiendo ? 'Abriendo Transbank...' : 'Inscribir'}</button>}
      </div>
      {datos.ambiente !== 'produccion' && (
        <p className="nota-demo">{datos.ambiente === 'integracion' ? 'Transbank en ambiente de prueba: usa una tarjeta de prueba, no se cobra.' : 'Pasarela de prueba: no se cobra.'}</p>
      )}

      {datos.creditos.length > 0 && (
        <ul className="tarjeta cn-documentos">
          {datos.creditos.map(c => (
            <li key={c.id}>
              <Icono nombre="documento" />
              <div className="cn-doc-izq">
                <strong>{proveedor(c.proveedorId)}</strong>
                <span className="mono tenue nombre">
                  {c.estado === 'pagado' && c.cobro ? `pagado el ${fechaCorta(c.cobro.en)}` : c.plazoDias ? `vence el ${fechaCorta(c.venceEn)}` : 'se cobra hoy (excede tu cupo)'}
                </span>
              </div>
              <div className="cn-doc-der">
                <strong className="mono">{dinero(c.monto)}</strong>
                <span className={`cn-chip ${c.estado === 'pagado' ? 'recibida' : c.estado === 'atrasado' ? 'reclamada' : ''}`}>{ESTADO[c.estado]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * ¿Le falta la tarjeta para comprar? true = le falta (y se exige), false = la tiene o no se exige, null = cargando o red falsa.
 * Se pide una vez: al volver de Transbank la página se recarga.
 */
export function useFaltaTarjeta(api: CanalApi, token: string): boolean | null {
  const [falta, setFalta] = useState<boolean | null>(null);
  useEffect(() => {
    if (api.modo !== 'real') return;
    let activo = true;
    pedir<ResumenCredito>('/api/pagos/yo', token)
      .then(d => { if (activo) setFalta(d.exigeTarjeta && !d.tarjeta); })
      .catch(() => { if (activo) setFalta(false); });
    return () => { activo = false; };
  }, [api.modo, token]);
  return falta;
}

/** En vez del carrito, mientras no tenga tarjeta: como en Uber, se inscribe una vez antes de la primera compra. */
export function PedirTarjeta({ token }: { token: string }) {
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState('');
  const inscribir = async () => {
    setAbriendo(true);
    try {
      irATransbank(await pedir('/api/pagos/yo/tarjeta', token, 'POST'));
    } catch (e) {
      setError((e as Error).message);
      setAbriendo(false);
    }
  };
  return (
    <div className="tarjeta cn-pedir-tarjeta">
      <Icono nombre="tarjeta" tam={28} />
      <h3>Inscribe tu tarjeta para comprar</h3>
      <p className="mono tenue">Bando le paga al proveedor al instante y tú pagas a 30 días, solo. Se inscribe una vez en Transbank; Bando nunca ve el número.</p>
      <button type="button" className="boton" disabled={abriendo} onClick={inscribir}>{abriendo ? 'Abriendo Transbank...' : 'Inscribir tarjeta'}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Los pagos más recientes que se listan; el total los cuenta todos. */
const PAGOS_A_LA_VISTA = 5;

/** /proveedor: lo que Bando le pagó al proveedor por cada factura, al instante. Sin datos del comprador. */
interface PagoDeBando { documentoId: string; monto: number; en: string; transferido: boolean }

/**
 * Panel del proveedor: lo que Bando le paga por cada factura (por recibir o transferido) y la cuenta donde lo recibe.
 * Bando transfiere desde el banco y lo marca; recién ahí cuenta como recibido.
 */
export function BandoTePago({ api, token, documentos, cambio }: { api: CanalApi; token: string; documentos: Documento[]; cambio: number }) {
  const [datos, setDatos] = useState<{ pagos: PagoDeBando[]; cuenta: string | null } | null>(null);
  const [editando, setEditando] = useState(false);
  useEffect(() => {
    if (api.modo !== 'real') return;
    let activo = true;
    pedir<{ pagos: PagoDeBando[]; cuenta: string | null }>('/api/pagos/proveedor', token)
      .then(d => { if (activo) setDatos(d); })
      .catch(() => {});
    return () => { activo = false; };
  }, [api.modo, token, cambio]);

  if (!datos) return null;
  const { pagos, cuenta } = datos;
  const folio = (documentoId: string) => documentos.find(d => d.id === documentoId)?.folio;
  const porRecibir = pagos.filter(p => !p.transferido).reduce((s, p) => s + p.monto, 0);
  return (
    <div className="bp-pagos">
      {cuenta && !editando
        ? <p className="bp-texto">Recibes en tu {cuenta}. <Boton variante="texto" onClick={() => setEditando(true)}>Cambiar</Boton></p>
        : <CuentaParaRecibir token={token} alGuardar={c => { setDatos({ ...datos, cuenta: c }); setEditando(false); }} />}
      {pagos.length > 0 && (
        <ul className="bm-tarjeta bp-filas">
          {pagos.slice(0, PAGOS_A_LA_VISTA).map(p => (
            <li key={p.documentoId} className="bp-fila">
              <span className="bp-fila-icono"><Icono nombre="documento" /></span>
              <div className="bp-fila-texto">
                <strong>{p.transferido ? `Bando te transfirió ${dinero(p.monto)}` : `Por recibir ${dinero(p.monto)}`}</strong>
                <span>{folio(p.documentoId) ? `Factura ${folio(p.documentoId)} · ` : ''}{fechaCorta(p.en)}</span>
              </div>
              <Estado tono={p.transferido ? 'exito' : 'aviso'}>{p.transferido ? 'Transferido' : 'Por transferir'}</Estado>
            </li>
          ))}
        </ul>
      )}
      {pagos.length > 0 && (
        <p className="bp-tenue">{porRecibir ? `${dinero(porRecibir)} por recibir. ` : ''}El negocio le paga a Bando a plazo; tú no esperas sus 30 días.</p>
      )}
    </div>
  );
}

/** Formulario de la cuenta bancaria del proveedor. Se valida aquí y otra vez en el servidor, con la misma función. */
function CuentaParaRecibir({ token, alGuardar }: { token: string; alGuardar: (cuentaCorta: string) => void }) {
  const [c, setC] = useState({ banco: '', tipo: '', numero: '', rutTitular: '', titular: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof c) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });
  const guardar = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const valida = validarCuenta(c);
    if (typeof valida === 'string') return setError(valida);
    setGuardando(true);
    try {
      alGuardar((await pedir<{ cuenta: string }>('/api/pagos/proveedor/cuenta', token, 'PUT', valida)).cuenta);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <form className="bm-formulario" onSubmit={guardar}>
      <p className="bm-bajada">¿Dónde te transferimos? Bando te paga cada factura sin esperar el plazo del comprador.</p>
      <label className="bm-campo"><span className="bm-campo-etiqueta">Banco</span>
        <select value={c.banco} onChange={campo('banco')}><option value="">Elige tu banco</option>{BANCOS.map(b => <option key={b}>{b}</option>)}</select>
      </label>
      <label className="bm-campo"><span className="bm-campo-etiqueta">Tipo de cuenta</span>
        <select value={c.tipo} onChange={campo('tipo')}><option value="">Elige el tipo</option>{Object.entries(TIPOS_CUENTA).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
      </label>
      <label className="bm-campo"><span className="bm-campo-etiqueta">Número de cuenta</span><input inputMode="numeric" autoComplete="off" value={c.numero} onChange={campo('numero')} /></label>
      <label className="bm-campo"><span className="bm-campo-etiqueta">RUT del titular</span><input autoComplete="off" value={c.rutTitular} onChange={campo('rutTitular')} placeholder="12.345.678-5" /></label>
      <label className="bm-campo"><span className="bm-campo-etiqueta">Nombre del titular</span><input autoComplete="off" value={c.titular} onChange={campo('titular')} /></label>
      {error && <p className="bm-error">{error}</p>}
      <Boton type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar cuenta'}</Boton>
    </form>
  );
}
