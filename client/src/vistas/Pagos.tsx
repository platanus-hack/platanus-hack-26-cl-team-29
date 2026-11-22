// /pagos: pagos a proveedores, para el equipo de Bando. Cada factura de una compra deja un pago por transferir con la cuenta
// del proveedor; alguien transfiere desde el banco y toca "Marcar transferido" (el proveedor recibe el aviso por WhatsApp).
// Pide el mismo token que el panel del presentador. Se actualiza sola con cada `red:evento` (useRed).
// Decisión: docs/decisiones/*-credito-bando.md

import { useCallback, useEffect, useState } from 'react';
import { TIPOS_CUENTA, type CuentaBancaria } from '../../../shared/cuenta-bancaria.ts';
import { fechaCorta } from '../../../shared/fecha.ts';
import { dinero } from '../../../shared/formato.ts';
import { formatearRut } from '../../../shared/rut.ts';
import { contar } from '../../../shared/texto.ts';
import { guardarToken, leerToken } from '../components/PanelPresentador.tsx';
import { useRed } from '../red/useRed.ts';
import '../canal/canal.css';
import './pagos.css';

interface Pago {
  id: string;
  proveedor: string;
  monto: number;
  folio: number | null;
  otorgadoEn: string;
  pagadoAlProveedorEn: string | null;
  comprobante: string | null;
  cuenta: CuentaBancaria | null;
}

export function Pagos() {
  const { eventos } = useRed();
  const evento = eventos[0]?.clave;
  const [token, setToken] = useState(leerToken);
  const [datos, setDatos] = useState<{ porTransferir: Pago[]; transferidos: Pago[] } | null>(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    if (!token) return;
    const r = await fetch('/api/pagos/operacion/pagos', { headers: { 'x-demo-token': token } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.mensaje ?? 'No se pudo cargar');
    setError('');
    setDatos(d);
  }, [token]);
  useEffect(() => { void cargar(); }, [cargar, evento]);

  if (!token || (error && !datos)) {
    return (
      <main className="pg-pagina">
        <h1 className="pg-titulo">Pagos a proveedores</h1>
        <form className="formulario pg-token" onSubmit={e => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get('t') ?? ''); guardarToken(t); setToken(t); }}>
          <label className="campo"><span>Token de la demo</span><input name="t" type="password" autoComplete="off" defaultValue={token} /></label>
          {error && <p className="error">{error}</p>}
          <button className="boton" type="submit">Entrar</button>
        </form>
      </main>
    );
  }
  if (!datos) return <main className="pg-pagina"><p className="vacio">Cargando...</p></main>;

  const total = datos.porTransferir.reduce((s, p) => s + p.monto, 0);
  return (
    <main className="pg-pagina">
      <h1 className="pg-titulo">Pagos a proveedores</h1>
      <p className="mono tenue">{datos.porTransferir.length ? `${contar(datos.porTransferir.length, 'pago')} por transferir: ${dinero(total)}.` : 'No hay pagos por transferir.'} Transfiere desde el banco de Bando y márcalo aquí: al proveedor le llega el aviso.</p>
      {error && <p className="error">{error}</p>}
      <ul className="pg-lista">
        {datos.porTransferir.map(p => <PorTransferir key={p.id} p={p} token={token} alMarcar={cargar} />)}
      </ul>
      {datos.transferidos.length > 0 && (
        <>
          <h2 className="etiqueta pg-sub">Últimos transferidos</h2>
          <ul className="tarjeta cn-documentos">
            {datos.transferidos.map(p => (
              <li key={p.id}>
                <div className="cn-doc-izq"><strong>{p.proveedor}</strong><span className="mono tenue nombre">{p.folio ? `Factura ${p.folio} · ` : ''}{fechaCorta(p.pagadoAlProveedorEn!)}{p.comprobante ? ` · op. ${p.comprobante}` : ''}</span></div>
                <div className="cn-doc-der"><strong className="mono">{dinero(p.monto)}</strong><span className="cn-chip recibida">transferido</span></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function PorTransferir({ p, token, alMarcar }: { p: Pago; token: string; alMarcar: () => Promise<void> }) {
  const [comprobante, setComprobante] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const marcar = async () => {
    setEnviando(true);
    const r = await fetch(`/api/pagos/operacion/pagos/${encodeURIComponent(p.id)}/transferido`, {
      method: 'POST', headers: { 'x-demo-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ comprobante }),
    });
    if (!r.ok) setError((await r.json().catch(() => ({}))).mensaje ?? 'No se pudo marcar');
    setEnviando(false);
    await alMarcar();
  };
  const c = p.cuenta;
  return (
    <li className="tarjeta pg-pago">
      <div className="pg-cabeza">
        <strong>{p.proveedor}</strong>
        <strong className="mono pg-monto">{dinero(p.monto)}</strong>
      </div>
      <p className="mono tenue">{p.folio ? `Factura ${p.folio} · ` : ''}desde el {fechaCorta(p.otorgadoEn)}</p>
      {c
        ? <dl className="pg-cuenta mono"><dt>Banco</dt><dd>{c.banco}</dd><dt>Tipo</dt><dd>{TIPOS_CUENTA[c.tipo]}</dd><dt>Número</dt><dd>{c.numero}</dd><dt>Titular</dt><dd>{c.titular} · {formatearRut(c.rutTitular)}</dd></dl>
        : <p className="error">Sin cuenta: pídele que la deje en su panel (/proveedor).</p>}
      <div className="pg-marcar">
        <input aria-label="Número de operación (opcional)" placeholder="N° de operación (opcional)" value={comprobante} onChange={e => setComprobante(e.target.value)} />
        <button type="button" className="boton" disabled={enviando || !c} onClick={marcar}>{enviando ? 'Marcando...' : 'Marcar transferido'}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </li>
  );
}
