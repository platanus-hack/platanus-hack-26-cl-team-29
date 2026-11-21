import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { cicloDeOrden, contadores, describirEvento, licitacionActual, negocioPorId, ordenActual, ranking, resumenLicitacion, type FilaRanking } from '../red/derivar.ts';
import { cantidadCon, dinero, haceCuanto, miles, nota } from '../red/formato.ts';
import { useAhora, useRed } from '../red/useRed.ts';

function Contador({ valor, texto, color }: { valor: number; texto: string; color?: string }) {
  return (
    <div className="tarjeta contador">
      <div className={`numero-grande ${color ?? ''}`}>{miles(valor)}</div>
      <p className="etiqueta">{texto}</p>
    </div>
  );
}

function Fila({ fila }: { fila: FilaRanking }) {
  const c = fila.cambio;
  const baja = c && fila.nota < c.anterior;
  return (
    <li className={`fila-ranking ${c ? (baja ? 'baja' : 'sube') : ''}`}>
      <span className="puesto">{fila.puesto}</span>
      <span>
        {fila.proveedor.nombre}
        {c && c.puestoAnterior !== fila.puesto && (
          <span className="sub">{baja ? 'bajó' : 'subió'} del {c.puestoAnterior}.° al {fila.puesto}.° lugar</span>
        )}
        {c && c.puestoAnterior === fila.puesto && <span className="sub">{baja ? 'bajó su nota' : 'subió su nota'}</span>}
      </span>
      <span className="valor-nota">
        {c && <span className="tachado">{nota(c.anterior)}</span>}
        {nota(fila.nota)} {c ? (baja ? '↓' : '↑') : ''}
      </span>
    </li>
  );
}

export function RedEnVivo() {
  const { estado, eventos, cambios, fuente } = useRed();
  const ahora = useAhora();
  if (!estado) return <Cargando />;

  const cuenta = contadores(estado);
  const filas = ranking(estado, cambios).slice(0, 6);
  const orden = ordenActual(estado);
  const pasos = orden ? cicloDeOrden(estado, orden, eventos) : [];
  const item = orden?.items[0];
  const lic = licitacionActual(estado);
  const resumenLic = lic && resumenLicitacion(lic, estado);

  return (
    <main className="pagina red">
      <header className="red-cabecera">
        <div className="marca" aria-hidden>D</div>
        <h1 className="titulo-red">La red de compras, en vivo</h1>
        <span className="en-vivo contorno">En vivo</span>
        <AvisoFuente fuente={fuente} />
      </header>

      <div className="red-cuerpo">
        <div className="columna">
          <section className="tarjeta">
            <p className="etiqueta">Todo el ciclo, para los dos lados</p>
            {orden && item ? (
              <>
                <h2 className="orden-titulo">
                  {cantidadCon(item.cantidad, item.producto)} de {item.producto} a{' '}
                  <span className="amarillo">{dinero(item.precioUnitario)}</span> por unidad
                </h2>
                <p className="orden-partes">
                  {negocioPorId(estado, orden.compradorId)?.nombre ?? 'Comprador'} → {negocioPorId(estado, orden.proveedorId)?.nombre ?? 'Proveedor'} · {orden.id}
                </p>
                <ol className="ciclo" aria-label="Ciclo de la orden">
                  {pasos.map((p, i) => (
                    <li key={p.titulo} className={`paso ${p.carril} ${p.estado}`}>
                      <span className="num">{i + 1} · {p.carril === 'sii' ? 'SII' : p.carril}</span>
                      <h3>{p.titulo}</h3>
                      <p>{p.detalle}</p>
                    </li>
                  ))}
                </ol>
                <div className="carriles">
                  <span><i style={{ background: 'var(--color-green)' }} />comprador</span>
                  <span><i style={{ background: 'var(--color-primary)' }} />proveedor</span>
                  <span><i style={{ background: 'var(--color-sii)' }} />SII, registro oficial</span>
                </div>
              </>
            ) : (
              <p className="vacio">Esperando el primer pedido por WhatsApp.</p>
            )}
          </section>

          <section className="tarjeta">
            <p className="etiqueta">Pasando ahora</p>
            {eventos.length ? (
              <ul className="feed">
                {eventos.slice(0, 7).map(e => (
                  <li key={e.clave}>
                    <span>{describirEvento(e, estado)}</span>
                    <time dateTime={e.en}>{haceCuanto(e.en, ahora)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="vacio">Todavía no pasa nada. Escribe por WhatsApp para empezar.</p>
            )}
          </section>
        </div>

        <div className="columna">
          <div className="contadores">
            <Contador valor={cuenta.negocios} texto="negocios" color="verde" />
            <Contador valor={cuenta.proveedoresConNota} texto="proveedores con nota" color="amarillo" />
            <Contador valor={cuenta.documentosSii} texto="documentos en el SII" />
          </div>
          <section className="tarjeta">
            <p className="etiqueta">
              Mejores proveedores {cambios.length > 0 && <span className="magenta">· cambió {haceCuanto(new Date(cambios.at(-1)!.en).toISOString(), ahora)}</span>}
            </p>
            {filas.length ? (
              <ol className="ranking">{filas.map(f => <Fila key={f.proveedor.id} fila={f} />)}</ol>
            ) : (
              <p className="vacio">Aún no hay proveedores con nota.</p>
            )}
          </section>
          {lic && resumenLic && (
            <a className="tarjeta mini-lic" href="/licitacion">
              <p className="etiqueta">Compra conjunta · {lic.producto} {lic.estado === 'cerrada' && <span className="magenta">· cerrada</span>}</p>
              <div className="numero-grande">{resumenLic.mejor ? dinero(resumenLic.mejor.precioUnitario) : 'Sin ofertas'}</div>
              <p>
                {resumenLic.compradores} negocios, {cantidadCon(resumenLic.totalUnidades, lic.producto)}
                {resumenLic.precioSolo !== undefined && <> · solo: <span className="tachado">{dinero(resumenLic.precioSolo)}</span></>}
              </p>
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
