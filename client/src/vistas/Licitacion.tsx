import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { CurvaPrecio } from '../components/CurvaPrecio.tsx';
import { useFilasQueCaben } from '../components/medidas.ts';
import { Qr } from '../components/Qr.tsx';
import { licitacionActual, resumenLicitacion, type OfertaVista, type ResumenLicitacion } from '../red/derivar.ts';
import { cantidadCon, contar, cuentaRegresiva, dinero, nota, unidadDe } from '../red/formato.ts';
import type { Licitacion as LicitacionRed } from '../red/tipos.ts';
import { useAhora, useRed } from '../red/useRed.ts';

function detalleOferta(o: OfertaVista): string {
  return `nota ${nota(o.nota)} · entrega en ${contar(o.plazoDias, 'día')}`;
}

/** Por qué pierde una oferta más barata: peor nota o, si no, entrega más lenta. */
function motivoRiesgo(o: OfertaVista, mejor?: OfertaVista): string {
  if (!mejor || o.nota < mejor.nota) return `Más barato, pero nota ${nota(o.nota)}: pierde`;
  return `Más barato, pero entrega en ${contar(o.plazoDias, 'día')}: pierde`;
}

function Grupo({ lic, r, cerrada }: { lic: LicitacionRed; r: ResumenLicitacion; cerrada: boolean }) {
  const [lista, caben] = useFilasQueCaben<HTMLUListElement>(4, r.compradores);
  const urlUnirse = `${location.origin}/unirse?licitacion=${encodeURIComponent(lic.id)}`;
  return (
    <section className="tarjeta apilada">
      <p className="etiqueta">Compradores en el grupo</p>
      <div className="grupo-total">
        <span className="numero-grande">{r.compradores}</span>
        {r.delPublico > 0 && <span className="mono verde">+{r.delPublico} del público</span>}
      </div>
      <p className="sacos">{cantidadCon(r.totalUnidades, lic.producto)} en total</p>
      <ul className="lista-grupo ajustable" ref={lista}>
        {r.ultimos.slice(0, caben).map((p, i) => (
          <li key={`${r.compradores - i}`}>
            <span className="quien">
              <span className="nombre">{p.nombre}</span>
              {p.comuna && <span className="comuna">{p.comuna}</span>}
            </span>
            <span className="verde">+{cantidadCon(p.cantidad, lic.producto)}</span>
          </li>
        ))}
      </ul>
      {!cerrada && (
        <div className="sumate">
          <h3>Súmate como almacén</h3>
          <div className="sumate-cuerpo">
            <Qr className="qr" texto={urlUnirse} />
            <div>
              <p>Escanea y mira cómo baja el precio</p>
              <p className="url">{urlUnirse.replace(/^https?:\/\//, '')}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Ofertas({ r, cerrada }: { r: ResumenLicitacion; cerrada: boolean }) {
  const [lista, caben] = useFilasQueCaben<HTMLUListElement>(5, r.ofertas.length);
  return (
    <section className="tarjeta apilada">
      <p className="etiqueta">Ofertas de proveedores</p>
      {r.ofertas.length ? (
        <ul className="ofertas ajustable" ref={lista}>
          {r.ofertas.slice(0, caben).map(o => (
            <li key={o.proveedorId} className={`oferta ${o.gana ? 'gana' : ''} ${o.riesgo ? 'riesgo' : ''}`}>
              <div className="nombre-oferta">{o.proveedor}</div>
              <div className="linea">
                <span className="precio">{dinero(o.precioUnitario)}</span>
                <span className="detalle">{detalleOferta(o)}</span>
              </div>
              <p className="aviso">
                {o.gana ? (cerrada ? 'Ganó la licitación' : 'Va ganando') : o.riesgo ? motivoRiesgo(o, r.mejor) : ' '}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vacio">Esperando la primera oferta.</p>
      )}
    </section>
  );
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

  return (
    <main className="pagina proyeccion">
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
        <Grupo lic={lic} r={r} cerrada={cerrada} />

        <section className="tarjeta apilada">
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

        <Ofertas r={r} cerrada={cerrada} />
      </div>
    </main>
  );
}
