// Piezas comunes de /app y /proveedor: el paso de confirmación, el estado en el SII y el selector de cantidad.

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { nombreDocumento } from '../../../shared/documentos.ts';
import { dinero } from '../../../shared/formato.ts';
import { textoEstadoSii } from '../red/formato.ts';
import type { Documento } from '../red/tipos.ts';
import { GlifoWhatsapp } from '../components/Iconos.tsx';
import { Icono, LogoSii } from './iconos.tsx';
import { enlaceWhatsapp, formatearTelefono } from '../../../shared/telefono.ts';
import { confirmacion, mensajeDeError, type Confirmacion, type EventoConfirmacion, SIN_CONFIRMACION } from './logica.ts';

/** Un envío a la API con su estado: `enviando` mientras corre y `error` con el mensaje si falla. */
export function useEnvio() {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const enviar = async (tarea: () => Promise<unknown>, siFalla?: string) => {
    setEnviando(true);
    setError('');
    try {
      await tarea();
    } catch (e) {
      setError(mensajeDeError(e, siFalla));
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, error, setError, enviar };
}

/** Paso de confirmación en la página: pedir → (sí) → enviando → listo o error. */
export function useConfirmacion<A>(ejecutar: (accion: A) => Promise<void>) {
  const [estado, despachar] = useReducer(
    (e: Confirmacion<A>, ev: EventoConfirmacion<A>) => confirmacion(e, ev),
    SIN_CONFIRMACION as Confirmacion<A>,
  );
  const confirmar = useCallback(async (accion: A) => {
    despachar({ tipo: 'confirmar' });
    try {
      await ejecutar(accion);
      despachar({ tipo: 'listo' });
    } catch (e) {
      despachar({ tipo: 'fallo', mensaje: mensajeDeError(e) });
    }
  }, [ejecutar]);
  const cancelar = () => despachar({ tipo: 'cancelar' });
  const confirmarPedida = () => { if (estado.fase === 'preguntando' || estado.fase === 'error') void confirmar(estado.accion); };
  return {
    estado,
    pedir: (accion: A) => despachar({ tipo: 'pedir', accion }),
    cancelar,
    confirmar: confirmarPedida,
    /** Lo que necesita `<Confirmar>` para mostrar este paso: `<Confirmar ... {...c.panel}>`. */
    panel: {
      enviando: estado.fase === 'enviando',
      error: estado.fase === 'error' ? estado.mensaje : undefined,
      onSi: confirmarPedida,
      onNo: cancelar,
    },
  };
}

interface PropsConfirmar {
  titulo: string;
  children: ReactNode;
  si: string;
  no?: string;
  /** Acción con efecto legal en el SII: se pinta en azul SII. */
  sii?: boolean;
  enviando: boolean;
  error?: string;
  onSi: () => void;
  onNo: () => void;
}

/** Panel de confirmación dentro de la página (nunca un diálogo del navegador). */
export function Confirmar({ titulo, children, si, no = 'No, volver', sii, enviando, error, onSi, onNo }: PropsConfirmar) {
  // En el teléfono el panel puede abrirse bajo las pestañas fijas: se trae a la vista entero.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.current?.scrollIntoView({ block: 'nearest', behavior: quieto ? 'auto' : 'smooth' });
  }, []);
  return (
    <div ref={panel} className={`cn-confirmar${sii ? ' sii' : ''}`} role="alertdialog" aria-label={titulo}>
      {sii && <p className="etiqueta cn-con-sii"><LogoSii tam={16} /> Se registra en el SII</p>}
      <h3>{titulo}</h3>
      <div className="cn-confirmar-texto">{children}</div>
      {error && <p className="error">{error}</p>}
      <div className="cn-acciones">
        <button type="button" className="boton" onClick={onSi} disabled={enviando} autoFocus>
          {enviando ? 'Enviando...' : error ? 'Reintentar' : si}
        </button>
        <button type="button" className="cn-boton-texto" onClick={onNo} disabled={enviando}>{no}</button>
      </div>
    </div>
  );
}

const CLASE_SII: Record<string, string> = { aceptado: 'ok', recibido: 'en-curso', simulado: 'simulado', reparo: 'en-curso', rechazado: 'mal', fallido: 'mal' };

export function EstadoSii({ estado }: { estado: string | null | undefined }) {
  const texto = textoEstadoSii(estado);
  if (!texto) return null;
  return <span className={`cn-sii ${CLASE_SII[estado ?? ''] ?? 'en-curso'}`}><LogoSii tam={12} />{texto}</span>;
}

/** Documentos del SII, el más nuevo primero: tipo y folio, la contraparte, el monto (la nota de crédito resta) y su estado. */
export function ListaDocumentos({ documentos, contraparte }: { documentos: readonly Documento[]; contraparte: (d: Documento) => string }) {
  const docs = [...documentos].sort((a, b) => Date.parse(b.emitidoEn ?? '') - Date.parse(a.emitidoEn ?? '') || (b.folio ?? 0) - (a.folio ?? 0));
  return (
    <ul className="tarjeta cn-documentos">
      {docs.map(d => (
        <li key={d.id}>
          <Icono nombre="documento" />
          <div className="cn-doc-izq">
            <strong>{nombreDocumento(d.tipo)} {d.folio !== null ? `folio ${d.folio}` : ''}</strong>
            <span className="mono tenue nombre">{contraparte(d)}</span>
          </div>
          <div className="cn-doc-der">
            <strong className="mono">{d.monto !== undefined ? (d.tipo === 61 ? `-${dinero(d.monto)}` : dinero(d.monto)) : ''}</strong>
            <EstadoSii estado={d.estadoSii} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Cantidad({ valor, min = 1, max, onCambio, etiqueta }: {
  valor: number; min?: number; max: number; onCambio: (n: number) => void; etiqueta: string;
}) {
  const fijar = (n: number) => onCambio(Math.min(max, Math.max(min, Math.round(n) || min)));
  return (
    <div className="stepper cn-stepper">
      <button type="button" className="boton secundario" aria-label="Menos" onClick={() => fijar(valor - 1)} disabled={valor <= min}>-</button>
      <input type="number" inputMode="numeric" min={min} max={max} value={valor} aria-label={etiqueta} onChange={e => fijar(Number(e.target.value))} />
      <button type="button" className="boton secundario" aria-label="Más" onClick={() => fijar(valor + 1)} disabled={valor >= max}>+</button>
    </div>
  );
}

export function Marca({ children }: { children?: ReactNode }) {
  return (
    <div className="cn-marca">
      <span className="marca" aria-hidden="true">B</span>
      <span>Bando</span>
      {children}
    </div>
  );
}

/** Estado vacío con una guía de qué hacer. */
export function Vacio({ titulo, texto, accion, onAccion }: { titulo: string; texto: string; accion?: string; onAccion?: () => void }) {
  return (
    <section className="cn-seccion">
      <div className="tarjeta cn-vacio">
        <h3>{titulo}</h3>
        <p className="mono tenue">{texto}</p>
        {accion && onAccion && <button type="button" className="boton cn-ancho" onClick={onAccion}>{accion}</button>}
      </div>
    </section>
  );
}

/** "Pedir por WhatsApp": la alternativa al carrito web. Sin número configurado, no se muestra. */
export function BotonWhatsapp({ numero }: { numero: string | null | undefined }) {
  const enlace = enlaceWhatsapp(numero, 'Quiero sumarme');
  if (!enlace || !numero) return null;
  return (
    <a className="cn-boton-whatsapp" href={enlace} target="_blank" rel="noreferrer">
      <GlifoWhatsapp className="cn-icono" tam={22} />
      <span className="cn-wa-textos">
        <strong>Pedir por WhatsApp</strong>
        <span>{formatearTelefono(numero)}</span>
      </span>
    </a>
  );
}
