import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { CurvaPrecio } from '../components/CurvaPrecio.tsx';
import { Qr } from '../components/Qr.tsx';
import { licitacionActual, resumenLicitacion, type OfertaVista } from '../red/derivar.ts';
import { cantidadCon, cuentaRegresiva, dinero, nota, unidadDe } from '../red/formato.ts';
import { useAhora, useRed } from '../red/useRed.ts';

function detalleOferta(o: OfertaVista, cerrada: boolean): string {
  const entrega = `entrega en ${o.plazoDias} ${o.plazoDias === 1 ? 'día' : 'días'}`;
  if (o.riesgo) return `más barato, pero nota ${nota(o.nota)} y ${entrega}: pierde`;
  return [`nota ${nota(o.nota)}`, entrega, o.gana ? (cerrada ? 'ganó' : 'va ganando') : ''].filter(Boolean).join(' · ');
}

export function Licitacion() {
  const { estado, fuente } = useRed();
  const ahora = useAhora(500);
  if (!estado) return <Cargando />;
  const lic = licitacionActual(estado);
  if (!lic) {
    return (
      <main className="pagina">
        <span className="en-vivo">Licitación en vivo</span> <AvisoFuente fuente={fuente} />
        <p className="vacio">No hay una compra conjunta abierta.</p>
      </main>
    );
  }

  const r = resumenLicitacion(lic, estado);
  const restante = Date.parse(lic.cierraEn) - ahora;
  const cerrada = lic.estado === 'cerrada' || restante <= 0;
  const unidad = unidadDe(lic.producto);
  const urlUnirse = `${location.origin}/unirse?licitacion=${encodeURIComponent(lic.id)}`;

  return (
    <main className="pagina">
      <header className="lic-cabecera">
        <div>
          <div className="lic-meta">
            <span className="en-vivo">Licitación en vivo</span>
            <span>{lic.producto} · {lic.comuna}</span>
            <AvisoFuente fuente={fuente} />
          </div>
          <h1 className="lic-titulo">
            Los agentes armaron el pedido. <span className="amarillo">Los proveedores compiten.</span>
          </h1>
        </div>
        <div className={`cuenta ${cerrada ? 'cerrada' : ''}`}>
          <p className="etiqueta">{cerrada ? 'Licitación' : 'Cierra en'}</p>
          <div className="numero-grande">{cerrada ? 'Cerrada' : cuentaRegresiva(restante)}</div>
        </div>
      </header>

      <div className="lic-cuerpo">
        <section className="tarjeta" style={{ display: 'flex', flexDirection: 'column' }}>
          <p className="etiqueta">Compradores en el grupo</p>
          <div className="grupo-total">
            <span className="numero-grande">{r.compradores}</span>
            {r.delPublico > 0 && <span className="mono verde">+{r.delPublico} del público</span>}
          </div>
          <p className="mono" style={{ margin: '16px 0 0', color: 'var(--color-muted)' }}>{cantidadCon(r.totalUnidades, lic.producto)} en total</p>
          <ul className="lista-grupo">
            {r.ultimos.map((p, i) => (
              <li key={`${r.compradores - i}`}>
                <span>{p.nombre}{p.comuna ? ` · ${p.comuna}` : ''}</span>
                <span className="verde">+{cantidadCon(p.cantidad, lic.producto)}</span>
              </li>
            ))}
          </ul>
          <div style={{ flex: 1 }} />
          {!cerrada && (
            <div className="sumate">
              <Qr className="qr" texto={urlUnirse} />
              <div>
                <h3>Súmate como almacén</h3>
                <p>Escanea y mira cómo baja el precio</p>
                <p className="url">{urlUnirse.replace(/^https?:\/\//, '')}</p>
              </div>
            </div>
          )}
        </section>

        <section className="tarjeta">
          <div className="mejor-oferta">
            <div>
              <p className="etiqueta">Mejor oferta por {unidad.singular}</p>
              <div className="numero-grande">{r.mejor ? dinero(r.mejor.precioUnitario) : 'Sin ofertas'}</div>
            </div>
            {r.precioSolo !== undefined && (
              <div className="precio-solo">
                <p className="etiqueta">Comprando solo</p>
                <div className="numero-grande tachado">{dinero(r.precioSolo)}</div>
              </div>
            )}
          </div>
          {r.ahorroPorUnidad > 0 && (
            <div className="ahorro">-{r.porcentaje}% · ahorro grupal {dinero(r.ahorroGrupal)}</div>
          )}
          <CurvaPrecio puntos={r.curva} precioSolo={r.precioSolo} />
          <div className="leyenda"><i />cada punto es una contraoferta de un proveedor cuando el grupo crece</div>
        </section>

        <section className="tarjeta">
          <p className="etiqueta">Ofertas de proveedores</p>
          {r.ofertas.length ? (
            <ul className="ofertas">
              {r.ofertas.slice(0, 5).map(o => (
                <li key={o.proveedorId} className={`oferta ${o.gana ? 'gana' : ''} ${o.riesgo ? 'riesgo' : ''}`}>
                  <div className="linea"><span>{o.proveedor}</span><span>{dinero(o.precioUnitario)}</span></div>
                  <p>{detalleOferta(o, cerrada)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="vacio">Esperando la primera oferta.</p>
          )}
        </section>
      </div>
    </main>
  );
}
