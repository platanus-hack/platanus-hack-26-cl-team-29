// /pagos: pagos a proveedores, para el equipo de Bando. Cada factura de una compra deja un pago por transferir con la cuenta
// del proveedor; alguien transfiere desde el banco y toca "Marcar transferido" (el proveedor recibe el aviso por WhatsApp).
// Pide el mismo token que el panel del presentador. Se actualiza sola con cada `red:evento` (useRed).
// Con la marca Bando (DESIGN.md). Decisión: docs/decisiones/*-credito-bando.md

import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { TIPOS_CUENTA, type CuentaBancaria } from '../../../shared/cuenta-bancaria.ts';
import { fechaCorta } from '../../../shared/fecha.ts';
import { dinero } from '../../../shared/formato.ts';
import { formatearRut } from '../../../shared/rut.ts';
import { contar } from '../../../shared/texto.ts';
import { guardarToken, leerToken } from '../components/PanelPresentador.tsx';
import { BotonTema } from '../marca/BotonTema.tsx';
import { Boton, Cifra, Estado, Tarjeta } from '../marca/componentes.tsx';
import { Logo } from '../marca/Logo.tsx';
import { useRed } from '../red/useRed.ts';
import '../comprador/comprador.css';
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

function MarcoPagos({ children }: { children: ReactNode }) {
  return (
    <main className="bando-ui pg-pagina">
      <header className="pg-superior">
        <Logo className="pg-logo" />
        <BotonTema className="bm-boton-icono" />
      </header>
      <div className="pg-cuerpo">{children}</div>
    </main>
  );
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
      <MarcoPagos>
        <h1 className="bm-titulo">Pagos a proveedores</h1>
        <form className="bm-formulario pg-token" onSubmit={e => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get('t') ?? ''); guardarToken(t); setToken(t); }}>
          <label className="bm-campo"><span className="bm-campo-etiqueta">Token de la demo</span><input name="t" type="password" autoComplete="off" defaultValue={token} /></label>
          {error && <p className="bm-error" role="alert">{error}</p>}
          <Boton type="submit" ancho>Entrar</Boton>
        </form>
      </MarcoPagos>
    );
  }
  if (!datos) return <MarcoPagos><p className="bm-bajada">Cargando…</p></MarcoPagos>;

  const total = datos.porTransferir.reduce((s, p) => s + p.monto, 0);
  return (
    <MarcoPagos>
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Pagos a proveedores</h1>
          <p className="bm-bajada">Transfiere desde el banco de Bando y márcalo aquí: al proveedor le llega el aviso.</p>
        </div>
        {datos.porTransferir.length > 0 && (
          <Cifra etiqueta={`${contar(datos.porTransferir.length, 'pago')} por transferir`} valor={dinero(total)} tamano="grande" />
        )}
      </header>
      {error && <p className="bm-error" role="alert">{error}</p>}
      {datos.porTransferir.length === 0 && <p className="bm-nota">No hay pagos por transferir.</p>}
      <ul className="pg-lista">
        {datos.porTransferir.map(p => <PorTransferir key={p.id} p={p} token={token} alMarcar={cargar} />)}
      </ul>
      {datos.transferidos.length > 0 && (
        <section className="pg-seccion">
          <h2 className="bm-etiqueta">Últimos transferidos</h2>
          <ul className="bm-tarjeta pg-transferidos">
            {datos.transferidos.map(p => (
              <li key={p.id}>
                <div className="pg-izq">
                  <strong>{p.proveedor}</strong>
                  <span>{p.folio ? `Factura ${p.folio} · ` : ''}{fechaCorta(p.pagadoAlProveedorEn!)}{p.comprobante ? ` · op. ${p.comprobante}` : ''}</span>
                </div>
                <div className="pg-der">
                  <strong>{dinero(p.monto)}</strong>
                  <Estado tono="exito">Transferido</Estado>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </MarcoPagos>
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
    <li><Tarjeta className="pg-pago">
      <div className="pg-cabeza">
        <strong className="pg-proveedor">{p.proveedor}</strong>
        <strong className="pg-monto">{dinero(p.monto)}</strong>
      </div>
      <p className="pg-detalle">{p.folio ? `Factura ${p.folio} · ` : ''}desde el {fechaCorta(p.otorgadoEn)}</p>
      {c
        ? <dl className="pg-cuenta"><dt>Banco</dt><dd>{c.banco}</dd><dt>Tipo</dt><dd>{TIPOS_CUENTA[c.tipo]}</dd><dt>Número</dt><dd>{c.numero}</dd><dt>Titular</dt><dd>{c.titular} · {formatearRut(c.rutTitular)}</dd></dl>
        : <p className="bm-error">Sin cuenta: pídele que la deje en su panel (/proveedor).</p>}
      <div className="pg-marcar">
        <label className="bm-campo">
          <span className="bm-campo-etiqueta">N° de operación (opcional)</span>
          <input value={comprobante} onChange={e => setComprobante(e.target.value)} />
        </label>
        <Boton disabled={enviando || !c} onClick={marcar}>{enviando ? 'Marcando…' : 'Marcar transferido'}</Boton>
      </div>
      {error && <p className="bm-error" role="alert">{error}</p>}
    </Tarjeta></li>
  );
}
