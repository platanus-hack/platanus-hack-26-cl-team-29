import { useRef, useState, type FormEvent } from 'react';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { licitacionActual, resumenLicitacion } from '../red/derivar.ts';
import { cantidadCon, cuentaRegresiva, dinero, unidadDe } from '../red/formato.ts';
import { useAhora, useRed } from '../red/useRed.ts';

const COMUNAS = ['Ñuñoa', 'Macul', 'La Reina', 'Providencia', 'Peñalolén', 'Santiago', 'San Joaquín', 'La Florida', 'Las Condes', 'Maipú'];

interface Sumado {
  nombre: string;
  cantidad: number;
  precioAlSumarse?: number;
}

export function Unirse() {
  const { estado, fuente, unirse } = useRed();
  const ahora = useAhora();
  const [nombre, setNombre] = useState('');
  const [comuna, setComuna] = useState('');
  const [cantidad, setCantidad] = useState(2);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [sumado, setSumado] = useState<Sumado | null>(null);
  const idPedido = useRef(new URLSearchParams(location.search).get('licitacion'));

  if (!estado) return <Cargando />;
  const lic = licitacionActual(estado, idPedido.current) ?? licitacionActual(estado);
  if (!lic) {
    return <main className="unirse"><p className="vacio">No hay una compra conjunta abierta en este momento.</p></main>;
  }
  const r = resumenLicitacion(lic, estado);
  const unidad = unidadDe(lic.producto);
  const precio = r.mejor?.precioUnitario;
  const cerrada = lic.estado === 'cerrada' || Date.parse(lic.cierraEn) <= ahora;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || cantidad < 1) return setError('Escribe el nombre de tu negocio y cuántos quieres.');
    setEnviando(true);
    setError('');
    try {
      await unirse(lic.id, { nombre: nombre.trim(), comuna: comuna.trim(), cantidad });
      setSumado({ nombre: nombre.trim(), cantidad, precioAlSumarse: precio });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos sumarte. Inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const cabecera = (
    <header>
      <div className="lic-meta" style={{ fontSize: 13 }}>
        <span className="en-vivo">En vivo</span>
        {!cerrada && <span>cierra en {cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}</span>}
        <AvisoFuente fuente={fuente} />
      </div>
      <h1>Compra conjunta de <span className="amarillo">{lic.producto}</span></h1>
      <p className="mono" style={{ color: 'var(--color-muted)', margin: '8px 0 0' }}>{lic.comuna}</p>
    </header>
  );

  const precioActual = (
    <section className="tarjeta">
      <div className="resumen">
        <div>
          <p className="etiqueta">Precio por {unidad.singular} hoy</p>
          <div className="numero-grande">{precio ? dinero(precio) : 'Sin ofertas'}</div>
        </div>
        {r.precioSolo !== undefined && (
          <div style={{ textAlign: 'right' }}>
            <p className="etiqueta">Solo</p>
            <div className="mono tachado" style={{ fontSize: 20, marginTop: 8 }}>{dinero(r.precioSolo)}</div>
          </div>
        )}
      </div>
      <p className="mono" style={{ margin: '12px 0 0', color: 'var(--color-muted)', fontSize: 14 }}>
        {r.compradores} negocios, {cantidadCon(r.totalUnidades, lic.producto)} en total
      </p>
    </section>
  );

  if (sumado) {
    const bajo = sumado.precioAlSumarse !== undefined && precio !== undefined && precio < sumado.precioAlSumarse;
    return (
      <main className="unirse">
        {cabecera}
        <section className="tarjeta confirmacion">
          <p className="etiqueta verde">Listo, estás en el grupo</p>
          <h2 style={{ margin: '12px 0 0', fontSize: 26 }}>{sumado.nombre} suma {cantidadCon(sumado.cantidad, lic.producto)}</h2>
          <div className="bajada">
            <span className="numero-grande amarillo">{precio ? dinero(precio) : 'Sin ofertas'}</span>
            {bajo && <span className="mono tachado" style={{ fontSize: 22 }}>{dinero(sumado.precioAlSumarse!)}</span>}
          </div>
          <p className="mono" style={{ margin: '12px 0 0', color: bajo ? 'var(--color-green)' : 'var(--color-muted)', fontSize: 15, lineHeight: 1.5 }}>
            {bajo
              ? `Bajó ${dinero(sumado.precioAlSumarse! - precio!)} por ${unidad.singular} desde que te sumaste.`
              : 'Mira la pantalla: con cada negocio que se suma, los proveedores bajan el precio.'}
          </p>
          {r.ahorroPorUnidad > 0 && (
            <p className="mono" style={{ margin: '12px 0 0', color: 'var(--color-muted)', fontSize: 15 }}>
              Ahorras {dinero(r.ahorroPorUnidad * sumado.cantidad)} frente a comprar solo.
            </p>
          )}
          <p className="mono" style={{ margin: '12px 0 0', color: 'var(--color-muted)', fontSize: 14 }}>
            Ya son {r.compradores} negocios, {cantidadCon(r.totalUnidades, lic.producto)} en total.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="unirse">
      {cabecera}
      {precioActual}
      {cerrada ? (
        <p className="vacio">Esta compra conjunta ya cerró.</p>
      ) : (
        <form className="formulario tarjeta" onSubmit={enviar}>
          <label className="campo">
            <span className="etiqueta">Nombre de tu negocio</span>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Almacén Las Rosas" autoComplete="organization" maxLength={60} required />
          </label>
          <label className="campo">
            <span className="etiqueta">Comuna</span>
            <input value={comuna} onChange={e => setComuna(e.target.value)} list="comunas" placeholder="Ñuñoa" maxLength={40} />
            <datalist id="comunas">{COMUNAS.map(c => <option key={c} value={c} />)}</datalist>
          </label>
          <div className="campo">
            <span className="etiqueta">¿Cuántos {unidad.plural}?</span>
            <div className="stepper">
              <button type="button" className="boton secundario" aria-label="Menos" onClick={() => setCantidad(c => Math.max(1, c - 1))}>-</button>
              <input type="number" inputMode="numeric" min={1} max={500} value={cantidad} onChange={e => setCantidad(Math.max(1, Number(e.target.value) || 1))} aria-label="Cantidad" />
              <button type="button" className="boton secundario" aria-label="Más" onClick={() => setCantidad(c => c + 1)}>+</button>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="boton" disabled={enviando}>{enviando ? 'Sumándote...' : 'Sumarme a la compra'}</button>
        </form>
      )}
    </main>
  );
}
