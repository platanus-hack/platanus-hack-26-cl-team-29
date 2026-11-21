// Entrar a la web: el número de WhatsApp, el código de 6 dígitos que llega por WhatsApp y, solo si el número es nuevo
// en la red, el nombre y el RUT del negocio. Una sola pantalla para /unirse, /app y /proveedor.

import { useState, type FormEvent } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { enlaceWhatsapp, formatearTelefono, telefonoParaWhatsapp } from '../../../shared/telefono.ts';
import type { CanalApi } from './api.ts';
import { FormularioNegocio } from './Carrito.tsx';
import { TELEFONO_PROVEEDOR_FALSO } from './falso.ts';
import { Marca, useEnvio } from './piezas.tsx';
import type { ConfigRed, DatosEntrada } from './tipos.ts';
import type { useCanal } from './useCanal.ts';

type Paso = 'telefono' | 'codigo' | 'registro';

const TELEFONO_INVALIDO = 'Escribe tu número de WhatsApp, por ejemplo 9 1234 5678.';

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

  const entrarCon = async (datos?: DatosEntrada) => {
    const r = await api.entrar(telefono, codigo, datos);
    if ('registro' in r) setPaso('registro');
    else onEntrar(r.token);
  };

  const verificar = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(codigo)) return setError('El código tiene 6 dígitos.');
    void enviar(() => entrarCon(), 'No pudimos entrar. Inténtalo de nuevo.');
  };

  const volver = () => {
    setError('');
    setPaso('telefono');
  };
  const numero = formatearTelefono(telefonoParaWhatsapp(telefono) ?? telefono);

  return (
    <main className="cn-pagina cn-bienvenida">
      <Marca><AvisoFuente fuente={fuente} /></Marca>
      <h1>{paso === 'registro' ? 'Registra tu negocio' : titulo}</h1>
      <p className="cn-bajada">
        {paso === 'telefono' ? bajada
          : paso === 'codigo' ? <>Te mandamos un código por WhatsApp al <strong>{numero}</strong>.</>
          : 'Es tu primera vez en la red: cuéntanos de tu negocio. Tus facturas salen a tu RUT.'}
      </p>

      {paso === 'telefono' && (
        <form className="formulario tarjeta" onSubmit={pedirCodigo}>
          <label className="campo">
            <span className="etiqueta">Tu número de WhatsApp</span>
            <input type="tel" inputMode="tel" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="9 1234 5678"
              autoComplete="tel" maxLength={20} required autoFocus />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="boton" disabled={enviando}>{enviando ? 'Mandando...' : 'Mandarme el código'}</button>
        </form>
      )}

      {paso === 'codigo' && (
        <form className="formulario tarjeta" onSubmit={verificar}>
          {retenido && <VentanaCerrada numero={config?.whatsappNumero} />}
          <label className="campo">
            <span className="etiqueta">Código</span>
            <input value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric"
              autoComplete="one-time-code" placeholder="123456" maxLength={6} required autoFocus className="mono" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="boton" disabled={enviando}>{enviando ? 'Entrando...' : 'Entrar'}</button>
          <div className="cn-fila-meta">
            <button type="button" className="cn-boton-texto" onClick={() => pedirCodigo()} disabled={enviando}>Mandar otro código</button>
            <button type="button" className="cn-boton-texto" onClick={volver}>Cambiar número</button>
          </div>
        </form>
      )}

      {paso === 'registro' && (
        <>
          <FormularioNegocio boton="Entrar" onEntrar={entrarCon} />
          <button type="button" className="cn-boton-texto" onClick={volver}>Cambiar número</button>
        </>
      )}

      {api.modo === 'falso' && (
        <p className="mono tenue">Con datos de prueba sirve cualquier código de 6 dígitos. Para entrar como proveedor usa el {formatearTelefono(TELEFONO_PROVEEDOR_FALSO)}.</p>
      )}
    </main>
  );
}

/** Meta solo deja escribirle a quien nos habló en las últimas 24 h: el código queda esperando hasta que escriba. */
function VentanaCerrada({ numero }: { numero: string | null | undefined }) {
  const enlace = enlaceWhatsapp(numero, 'Hola');
  return (
    <p className="cn-ayuda">
      Si no te llega, escríbenos un “Hola” por WhatsApp y el código te llega al tiro.
      {enlace && <> <a href={enlace} target="_blank" rel="noreferrer">Abrir WhatsApp</a></>}
    </p>
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
