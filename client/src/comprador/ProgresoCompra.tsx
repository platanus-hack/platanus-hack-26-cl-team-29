// Cómo va una compra en grupo (DESIGN.md, Paper "C3"): el frasco de miel que se llena con las unidades del grupo y la
// escalera de tramos, con el precio de hoy y cuánto falta para el siguiente. Sin tramos todavía (nadie ofertó), "Esperando
// ofertas". La ven el comprador (al sumarse) y el proveedor (en la compra donde compite).

import { dinero } from '../../../shared/formato.ts';
import type { SiguienteTramo, Tramo } from '../../../shared/precios.ts';
import { contar } from '../../../shared/texto.ts';
import { dineroMasIva, faltanUnidades } from '../../../shared/precios.ts';
import { NotaPreciosNetos } from '../marca/componentes.tsx';
import { ABEJA } from '../marca/recursos.ts';
import { escalera, frasco, rango } from './compra.ts';

export interface ProductoProgreso {
  unidad: string;
  unidadPlural: string;
  precioSolo: number;
  tramos: Tramo[];
}

/**
 * `vista`: unidades del grupo (con lo que el comprador está por sumar), precio de hoy y el siguiente tramo.
 * `tuyas`: lo que está por sumar y todavía no guarda: el número grande es lo que ya juntó el grupo y lo suyo se ve
 * aparte, como vista previa ("con tus 12: 12 de 25"), para no contar como hecho lo que aún no se suma.
 */
export function ProgresoCompra({ p, vista, tuyas = 0 }: {
  p: ProductoProgreso; vista: { unidades: number; precio: number; siguiente: SiguienteTramo | null }; tuyas?: number;
}) {
  const f = frasco(p.tramos, vista.unidades, vista.siguiente);
  const grupo = Math.max(0, vista.unidades - tuyas);
  const llenadoGrupo = vista.unidades > 0 ? f.llenado * (grupo / vista.unidades) : 0;
  const peldanos = escalera(p.tramos, vista.unidades);
  return p.tramos.length > 0 ? (
      <section className="bm-tarjeta bm-tramos" aria-label="Precios por volumen">
        <div className="bm-frasco" role="img" aria-label={`${grupo} de ${contar(f.meta, p.unidad, p.unidadPlural)}${tuyas ? `; con tus ${tuyas}, ${vista.unidades}` : ''}`}>
          {tuyas > 0 && <span className="bm-miel bm-miel-previa" style={{ height: `${f.llenado * 100}%` }} />}
          <span className="bm-miel" style={{ height: `${llenadoGrupo * 100}%` }} />
          {f.marcas.map(m => <span key={m} className="bm-marca-tramo" style={{ bottom: `${m * 100}%` }} />)}
          <span className="bm-frasco-cifra">
            <strong>{grupo}</strong>de {contar(f.meta, p.unidad, p.unidadPlural)}
            {tuyas > 0 && <small className="bm-frasco-previa">con tus {tuyas}: {vista.unidades}</small>}
          </span>
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
        <NotaPreciosNetos className="bm-tramos-nota" />
      </section>
    ) : (
      <section className="bm-tarjeta bm-esperando" aria-label="Esperando ofertas">
        <img className="ilustracion" src={ABEJA.celebra} alt="" />
        <h2>Esperando ofertas de proveedores</h2>
        <p>Los proveedores ven esta compra y ofertan su precio por volumen. Al cerrar gana el mejor para todo el grupo.</p>
        <p>Van <strong>{contar(vista.unidades, p.unidad, p.unidadPlural)}</strong>{p.precioSolo > 0 ? <> · referencia hoy <strong>{dineroMasIva(p.precioSolo)}</strong> por {p.unidad}</> : null}.</p>
      </section>
    );
}
