import { useState } from 'react';
import type { AccionDemo } from '../red/useRed.ts';
import { useEnvio } from '../canal/piezas.tsx';
import { contar } from '../../../shared/texto.ts';

/** El token vive solo en la pestaña (sessionStorage): nunca en el código ni en localStorage. */
const CLAVE_TOKEN = 'sala.tokenDemo';

export function leerToken(): string {
  try {
    return sessionStorage.getItem(CLAVE_TOKEN) ?? '';
  } catch {
    return '';
  }
}

export function guardarToken(token: string) {
  try {
    sessionStorage.setItem(CLAVE_TOKEN, token);
  } catch {
    // Sin sessionStorage (modo privado estricto): el token queda solo en memoria.
  }
}

/** Resultado de `POST /api/pagos/demo/cobrar`. */
const cobro = (r: unknown) => {
  const { cobrados = 0, fallidos = 0 } = (r ?? {}) as { cobrados?: number; fallidos?: number };
  return `${contar(cobrados, 'crédito cobrado', 'créditos cobrados')} · ${contar(fallidos, 'fallido')}.`;
};

/** Acción, texto del botón, si necesita la compra en curso y qué mostrar al terminar. */
const ACCIONES: Array<[AccionDemo, string, boolean, (r: unknown) => string]> = [
  ['reiniciar', 'Reiniciar demo', false, () => 'La demo volvió al inicio.'],
  ['cerrar', 'Cerrar ahora', true, () => 'Pedido cerrado.'],
  ['confirmar', 'Confirmar facturas', true, () => 'Facturas en camino al SII.'],
  ['cobrar', 'Cobrar vencidos', false, cobro],
];

interface Props {
  licitacionId?: string;
  accion: (accion: AccionDemo, token: string, licitacionId?: string) => Promise<unknown>;
  alCerrar: () => void;
}

/** Panel oculto del presentador: se abre y se cierra con la tecla "d". */
export function PanelPresentador({ licitacionId, accion, alCerrar }: Props) {
  const [token, setToken] = useState(leerToken);
  const [mensaje, setMensaje] = useState('');
  const [enCurso, setEnCurso] = useState<AccionDemo | null>(null);
  const { enviando, error, enviar } = useEnvio();

  const ejecutar = (a: AccionDemo, exito: (r: unknown) => string) => {
    if (enviando) return;
    setMensaje('');
    setEnCurso(a);
    void enviar(async () => {
      setMensaje(exito(await accion(a, token, licitacionId)));
    }, 'No se pudo.');
  };

  return (
    <aside className="panel-presentador" aria-label="Panel del presentador">
      <div className="panel-cabecera">
        <p className="etiqueta">Presentador</p>
        <button type="button" className="panel-x" onClick={alCerrar} aria-label="Cerrar panel">x</button>
      </div>
      <label className="campo">
        <span className="etiqueta">Token de la demo</span>
        <input
          type="password"
          value={token}
          autoComplete="off"
          onChange={e => {
            setToken(e.target.value);
            guardarToken(e.target.value);
          }}
        />
      </label>
      <div className="panel-acciones">
        {ACCIONES.map(([a, texto, conCompra, exito]) => (
          <button key={a} type="button" className="boton" disabled={enviando || (conCompra && !licitacionId)} onClick={() => ejecutar(a, exito)}>
            {enviando && enCurso === a ? 'Enviando...' : texto}
          </button>
        ))}
      </div>
      {(error || mensaje) && <p className="mono panel-mensaje">{error || mensaje}</p>}
    </aside>
  );
}
