// /app#credito: el crédito Bando del comprador. Bando le paga al proveedor al facturar y el negocio paga a 30, 45 o 60
// días con su tarjeta inscrita en Transbank; el cupo y el plazo suben con cada pago a tiempo. Se actualiza con cada
// `red:evento` (crédito otorgado o cobrado, tarjeta inscrita). Decisión: docs/decisiones/20261121-2018-credito-bando.md

import { useEffect, useState } from 'react';
import type { LineaCredito } from '../../../shared/credito.ts';
import { fechaCorta } from '../../../shared/fecha.ts';
import { dinero } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import type { CanalApi } from './api.ts';
import { Icono } from './iconos.tsx';
import { Vacio } from './piezas.tsx';
import type { FotoRed } from './tipos.ts';

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
}

const pedir = async <T,>(url: string, token: string, metodo = 'GET'): Promise<T> => {
  const res = await fetch(url, { method: metodo, headers: { authorization: `Bearer ${token}` } });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.mensaje ?? 'No pudimos traer tu crédito.');
  return datos as T;
};

/** Transbank espera un POST de formulario con el token: se arma y se envía (sale de la página). */
function irATransbank({ token, url }: { token: string; url: string }) {
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
