// La portada del comprador (Paper "C2"): lo que ahorró este mes comprando en grupo, las compras en grupo abiertas con
// su "Sumarme" y lo que tiene por recibir. Mismas piezas que el panel del proveedor (Ventas, "P2"). Se recalcula con
// cada `red:evento` (la foto y sus pedidos llegan nuevos).

import { dinero } from '../../../shared/formato.ts';
import { totalOrden } from '../../../shared/precios.ts';
import { contar } from '../../../shared/texto.ts';
import type { FotoRed, YoComprador } from '../canal/tipos.ts';
import { Monograma } from '../canal/iconos.tsx';
import { useAhora } from '../red/useRed.ts';
import { ahorroDelMes } from './compra.ts';
import { comprasAbiertas, filasDeCompras, FilaCompraEnGrupo } from './ComprasEnGrupo.tsx';
import '../proveedor/proveedor.css';

/** Cuántas compras abiertas se muestran; el resto, en "Ver todas". */
const CERCA = 3;

export function InicioComprador({ foto, yo }: { foto: FotoRed; yo: YoComprador }) {
  const ahora = useAhora();
  const delMes = ahorroDelMes(yo.ordenes, foto.licitaciones, new Date(ahora));
  const abiertas = comprasAbiertas(filasDeCompras(foto.licitaciones), ahora);
  const porRecibir = yo.ordenes.filter(o => o.estado === 'facturada');
  const proveedor = (id: string) => foto.negocios.find(n => n.id === id)?.nombre ?? 'Proveedor';

  return (
    <div className="bp-pagina">
      <header className="bp-hero">
        <div>
          <p className="bm-bajada">{delMes ? 'Este mes ahorraste' : 'Compra junto a otros negocios'}</p>
          {delMes ? (
            <p className="bm-ahorro-mes">
              <strong className="bp-cifra">{dinero(delMes.ahorro)}</strong>
              {delMes.porcentaje > 0 && <span>−{delMes.porcentaje}% vs comprar solo</span>}
            </p>
          ) : <p className="bm-bajada">Mientras más negocios se suman, más baja el precio para todos.</p>}
        </div>
        <a className="bm-boton" href="#compra/nueva">Nueva compra</a>
      </header>

      <div className="bp-columnas">
        <section className="bm-tarjeta bp-bloque">
          <header className="bp-bloque-cabecera"><h2>Compras en grupo abiertas</h2>{abiertas.length > CERCA && <a href="#compra">Ver todas</a>}</header>
          {abiertas.length ? (
            <ul className="bm-lista bp-margen">
              {abiertas.slice(0, CERCA).map(f => <FilaCompraEnGrupo key={`${f.lic.id}-${f.p.id}`} {...f} yo={yo} ahora={ahora} abierta />)}
            </ul>
          ) : <p className="bp-nada">No hay compras en grupo abiertas. Inicia una con «Nueva compra» y los negocios de la red se suman.</p>}
        </section>

        <section className="bm-tarjeta bp-bloque">
          <header className="bp-bloque-cabecera"><h2>Por recibir</h2>{porRecibir.length > 0 && <a href="#recepcion">{contar(porRecibir.length, 'pedido')}</a>}</header>
          {porRecibir.length ? (
            <ul className="bp-filas">
              {porRecibir.slice(0, CERCA).map(o => (
                <li key={o.id} className="bm-fila-proveedor">
                  <Monograma nombre={proveedor(o.proveedorId)} tam={32} />
                  <span className="bm-fila-cuerpo">
                    <strong className="bm-fila-nombre">{proveedor(o.proveedorId)}</strong>
                    <span className="bm-fila-abajo">{o.items.map(i => `${i.producto} × ${i.cantidad}`).join(', ')}</span>
                  </span>
                  <span className="bm-nota-proveedor">{dinero(totalOrden(o))}</span>
                </li>
              ))}
            </ul>
          ) : <p className="bp-nada">Nada por recibir. Cuando un proveedor te facture, aparece aquí para confirmar que llegó.</p>}
        </section>
      </div>
    </div>
  );
}
