// Piezas comunes de /app y /proveedor: el paso de confirmación, el estado en el SII y el selector de cantidad.

import { useCallback, useReducer, type ReactNode } from 'react';
import { textoEstadoSii } from '../red/formato.ts';
import { confirmacion, SIN_CONFIRMACION, type Confirmacion, type EventoConfirmacion } from './logica.ts';

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
      despachar({ tipo: 'fallo', mensaje: e instanceof Error ? e.message : 'No pudimos completarlo. Inténtalo de nuevo.' });
    }
  }, [ejecutar]);
  return {
    estado,
    pedir: (accion: A) => despachar({ tipo: 'pedir', accion }),
    cancelar: () => despachar({ tipo: 'cancelar' }),
    confirmar: () => { if (estado.fase === 'preguntando' || estado.fase === 'error') void confirmar(estado.accion); },
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
  return (
    <div className={`cn-confirmar${sii ? ' sii' : ''}`} role="alertdialog" aria-label={titulo}>
      {sii && <p className="etiqueta">Trámite legal en el SII</p>}
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
  return <span className={`cn-sii ${CLASE_SII[estado ?? ''] ?? 'en-curso'}`}>{texto}</span>;
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
      <span className="marca" aria-hidden="true">D</span>
      <span>Dominó</span>
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
