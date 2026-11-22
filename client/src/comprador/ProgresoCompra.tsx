// Cómo va una compra en grupo (DESIGN.md, Paper "C3"): el frasco de miel que se llena con las unidades del grupo y la
// escalera de tramos, con el precio de hoy y cuánto falta para el siguiente. Sin tramos todavía (nadie ofertó), "Esperando
// ofertas". La ven el comprador (al sumarse) y el proveedor (en la compra donde compite).

import { dinero } from '../../../shared/formato.ts';
import type { SiguienteTramo, Tramo } from '../../../shared/precios.ts';
import { contar } from '../../../shared/texto.ts';
import { faltanUnidades } from '../../../shared/precios.ts';
import { ABEJA } from '../marca/recursos.ts';
import { escalera, frasco, rango } from './compra.ts';

export interface ProductoProgreso {
  unidad: string;
  unidadPlural: string;
  precioSolo: number;
  tramos: Tramo[];
}

/** `vista`: unidades del grupo (con lo que el comprador está por sumar), precio de hoy y el siguiente tramo. */
export function ProgresoCompra({ p, vista }: { p: ProductoProgreso; vista: { unidades: number; precio: number; siguiente: SiguienteTramo | null } }) {
  const f = frasco(p.tramos, vista.unidades, vista.siguiente);
  const peldanos = escalera(p.tramos, vista.unidades);
  return p.tramos.length > 0 ? (
      <section className="bm-tarjeta bm-tramos" aria-label="Precios por volumen">
        <div className="bm-frasco" role="img" aria-label={`${vista.unidades} de ${contar(f.meta, p.unidad, p.unidadPlural)}`}>
          <span className="bm-miel" style={{ height: `${f.llenado * 100}%` }} />
          {f.marcas.map(m => <span key={m} className="bm-marca-tramo" style={{ bottom: `${m * 100}%` }} />)}
          <span className="bm-frasco-cifra"><strong>{vista.unidades}</strong>de {contar(f.meta, p.unidad, p.unidadPlural)}</span>
        </div>
        <ol className="bm-escalera">
          {peldanos.map(t => (
            <li key={t.desde} className={`bm-peldano ${t.estado}`}>
              <div>
                <span className="bm-peldano-rango">
                  {rango(t, p)}{t.estado === 'siguiente' ? ' · siguiente tramo' : t.estado === 'actual' ? ' · precio de hoy' : ''}
                </span>
                {t.estado === 'siguiente' && vista.siguiente && <strong>{faltanUnidades(vista.siguiente, p)}</strong>}
                {t.estado === 'actual' && <strong>Todos pagan esto</strong>}
              </div>
              <span className="bm-peldano-precio">{dinero(t.estado === 'actual' ? vista.precio : t.precio)}</span>
            </li>
          ))}
          {p.precioSolo > Math.max(0, ...p.tramos.map(t => t.precioUnitario)) && (
            <li className="bm-peldano superado">
              <div><span className="bm-peldano-rango">Comprando solo</span></div>
              <span className="bm-peldano-precio">{dinero(p.precioSolo)}</span>
            </li>
          )}
        </ol>
      </section>
    ) : (
      <section className="bm-tarjeta bm-esperando" aria-label="Esperando ofertas">
        <img className="ilustracion" src={ABEJA.celebra} alt="" />
        <h2>Esperando ofertas de proveedores</h2>
        <p>Los proveedores ven esta compra y ofertan su precio por volumen. Al cerrar gana el mejor para todo el grupo.</p>
        <p>Van <strong>{contar(vista.unidades, p.unidad, p.unidadPlural)}</strong>{p.precioSolo > 0 ? <> · referencia hoy <strong>{dinero(p.precioSolo)}</strong> por {p.unidad}</> : null}.</p>
      </section>
    );
}
