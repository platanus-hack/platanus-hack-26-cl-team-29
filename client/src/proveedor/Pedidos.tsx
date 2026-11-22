// Pedidos del proveedor (DESIGN.md, Paper "P2c"): cuántos hay en cada estado y la lista, el más nuevo primero.
// Los pedidos por confirmar se confirman aquí mismo (como en Ventas); de los demás se lee su estado.

import { useState } from 'react';
import { totalOrden } from '../../../shared/precios.ts';
import { haceCuanto } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import type { Negocio } from '../red/tipos.ts';
import { Monograma } from '../canal/iconos.tsx';
import { TotalConIva } from '../marca/componentes.tsx';
import type { ConfigRed, YoProveedor } from '../canal/tipos.ts';
import { detalleDe, FilaPedido, type PropsAccion } from './Ventas.tsx';
import { contarPorGrupo, ESTADO_PEDIDO, grupoDe, GRUPOS_PEDIDO, type GrupoPedido } from './pedidos.ts';

export function Pedidos({ yo, config, comprador, ...acciones }: PropsAccion & { yo: YoProveedor; config: ConfigRed | null; comprador: (id: string) => Negocio | undefined }) {
  const ahora = useAhora();
  const [filtro, setFiltro] = useState<GrupoPedido | null>(null);
  const cuenta = contarPorGrupo(yo.ordenes);
  const lista = yo.ordenes
    .filter(o => !filtro || grupoDe(o.estado) === filtro)
    .sort((a, b) => Date.parse(b.creadaEn) - Date.parse(a.creadaEn));

  return (
    <div className="bp-pagina">
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Pedidos</h1>
          <p className="bm-bajada">Confirma los pedidos nuevos y factura en el SII. Cobras apenas el local confirma la recepción.</p>
        </div>
      </header>

      <div className="bm-tarjeta bp-contadores" role="group" aria-label="Filtrar por estado">
        {GRUPOS_PEDIDO.map(g => (
          <button key={g.id} type="button" className={`bp-contador ${g.id}`} aria-pressed={filtro === g.id} onClick={() => setFiltro(filtro === g.id ? null : g.id)}>
            <span>{g.titulo}</span><strong>{cuenta[g.id]}</strong>
          </button>
        ))}
      </div>

      {!lista.length ? (
        <p className="bp-nada">{filtro ? 'No hay pedidos en este estado.' : 'Todavía no tienes pedidos. Cuando un negocio te pida o cierres una compra en grupo, aparecen aquí.'}</p>
      ) : (
        <ul className="bm-tarjeta bp-filas bp-tabla">
          {lista.map(o => {
            if (o.estado === 'enviada' || o.estado === 'confirmada') return <FilaPedido key={o.id} {...acciones} orden={o} comprador={comprador(o.compradorId)} config={config} />;
            const quien = comprador(o.compradorId)?.nombre ?? 'Un negocio';
            const estado = ESTADO_PEDIDO[o.estado];
            return (
              <li key={o.id} className="bp-fila">
                <span className="bp-fila-icono"><Monograma nombre={quien} tam={32} /></span>
                <div className="bp-fila-texto">
                  <strong>{quien}{o.licitacionId ? ' · compra en grupo' : ''}</strong>
                  <span>{detalleDe(o, config)} · {haceCuanto(o.creadaEn, ahora)}</span>
                </div>
                <TotalConIva neto={totalOrden(o)} className="bp-monto" />
                <span className={`bp-estado ${estado.tono}`}>{estado.texto}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
