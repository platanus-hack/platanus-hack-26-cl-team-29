import { useState } from 'react';
import type { AccionDemo } from '../red/useRed.ts';
import { useEnvio } from '../canal/piezas.tsx';

/** El token vive solo en la pestaña (sessionStorage): nunca en el código ni en localStorage. */
const CLAVE_TOKEN = 'sala.tokenDemo';

function leerToken(): string {
  try {
    return sessionStorage.getItem(CLAVE_TOKEN) ?? '';
  } catch {
    return '';
  }
}

function guardarToken(token: string) {
  try {
    sessionStorage.setItem(CLAVE_TOKEN, token);
  } catch {
    // Sin sessionStorage (modo privado estricto): el token queda solo en memoria.
  }
}

const ACCIONES: Array<[AccionDemo, string, string]> = [
  ['reiniciar', 'Reiniciar demo', 'La demo volvió al inicio.'],
  ['cerrar', 'Cerrar ahora', 'Pedido cerrado.'],
  ['confirmar', 'Confirmar facturas', 'Facturas en camino al SII.'],
];

interface Props {
  licitacionId?: string;
  accion: (accion: AccionDemo, token: string, licitacionId?: string) => Promise<void>;
  alCerrar: () => void;
}

/** Panel oculto del presentador: se abre y se cierra con la tecla "d". */
export function PanelPresentador({ licitacionId, accion, alCerrar }: Props) {
  const [token, setToken] = useState(leerToken);
  const [mensaje, setMensaje] = useState('');
  const [enCurso, setEnCurso] = useState<AccionDemo | null>(null);
  const { enviando, error, enviar } = useEnvio();

  const ejecutar = (a: AccionDemo, exito: string) => {
    if (enviando) return;
    setMensaje('');
    setEnCurso(a);
    void enviar(async () => {
      await accion(a, token, licitacionId);
      setMensaje(exito);
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
        {ACCIONES.map(([a, texto, exito]) => (
          <button key={a} type="button" className="boton" disabled={enviando || (a !== 'reiniciar' && !licitacionId)} onClick={() => ejecutar(a, exito)}>
            {enviando && enCurso === a ? 'Enviando...' : texto}
          </button>
        ))}
      </div>
      {(error || mensaje) && <p className="mono panel-mensaje">{error || mensaje}</p>}
    </aside>
  );
}
