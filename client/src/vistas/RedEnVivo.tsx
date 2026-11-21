import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { useFilasQueCaben } from '../components/medidas.ts';
import {
  cicloDeOrden, contadores, describirEvento, licitacionActual, negocioPorId, ordenActual, ranking, resumenLicitacion, unidadDeLicitacion,
  type CambioNota, type FilaRanking,
} from '../red/derivar.ts';
import { cantidadCon, contar, dinero, haceCuanto, miles, nota, unidadDe } from '../red/formato.ts';
import type { EstadoRed } from '../red/tipos.ts';
import { useAhora, useRed, type EventoVisto } from '../red/useRed.ts';

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
      <span className="quien">
        <span className="nombre">{fila.proveedor.nombre}</span>
        {c && (
          <span className="sub">
            {c.puestoAnterior !== fila.puesto
              ? `${baja ? 'bajó' : 'subió'} del ${c.puestoAnterior}.° al ${fila.puesto}.° lugar`
              : baja ? 'bajó su nota' : 'subió su nota'}
          </span>
        )}
      </span>
      <span className="valor-nota">
        {c && <span className="tachado">{nota(c.anterior)}</span>}
        {nota(fila.nota)} {c ? (baja ? '↓' : '↑') : ''}
      </span>
    </li>
  );
}

function Ranking({ estado, cambios, ahora }: { estado: EstadoRed; cambios: CambioNota[]; ahora: number }) {
  const filas = ranking(estado, cambios);
  const [lista, caben] = useFilasQueCaben<HTMLOListElement>(5, cambios.length);
  // Si un proveedor que cambió queda fuera de las filas que caben, se muestra igual en la última.
  const visibles = filas.slice(0, caben);
  const fuera = filas.slice(caben).find(f => f.cambio);
  if (fuera && visibles.length) visibles[visibles.length - 1] = fuera;
  return (
    <section className="tarjeta apilada">
      <p className="etiqueta">
        Mejores proveedores {cambios.length > 0 && <span className="magenta">· cambió {haceCuanto(new Date(cambios.at(-1)!.en).toISOString(), ahora)}</span>}
      </p>
      {filas.length ? (
        <ol className="ranking ajustable" ref={lista}>{visibles.map(f => <Fila key={f.proveedor.id} fila={f} />)}</ol>
      ) : (
        <p className="vacio">Aún no hay proveedores con nota.</p>
      )}
    </section>
  );
}

function Feed({ estado, eventos, ahora }: { estado: EstadoRed; eventos: EventoVisto[]; ahora: number }) {
  const [lista, caben] = useFilasQueCaben<HTMLUListElement>(5, eventos.length > 0);
  return (
    <section className="tarjeta apilada crece">
      <p className="etiqueta">Pasando ahora</p>
      {eventos.length ? (
        <ul className="feed ajustable" ref={lista}>
          {eventos.slice(0, caben).map(e => (
            <li key={e.clave}>
              <span className="texto">{describirEvento(e, estado)}</span>
              <time dateTime={e.en}>{haceCuanto(e.en, ahora)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vacio">Todavía no pasa nada. Escribe por WhatsApp para empezar.</p>
      )}
    </section>
  );
}

export function RedEnVivo() {
  const { estado, eventos, cambios, fuente } = useRed();
  const ahora = useAhora();
  if (!estado) return <Cargando />;

  const cuenta = contadores(estado);
  const orden = ordenActual(estado);
  const pasos = orden ? cicloDeOrden(estado, orden, eventos) : [];
  const item = orden?.items[0];
  const lic = licitacionActual(estado);
  const resumenLic = lic && resumenLicitacion(lic, estado);

  return (
    <main className="pagina proyeccion red">
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
                  <span className="amarillo">{dinero(item.precioUnitario)}</span> por {unidadDe(item.producto).singular}
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
              </>
            ) : (
              <p className="vacio">Esperando el primer pedido por WhatsApp.</p>
            )}
          </section>

          <Feed estado={estado} eventos={eventos} ahora={ahora} />
        </div>

        <div className="columna">
          <div className="contadores">
            <Contador valor={cuenta.negocios} texto={cuenta.negocios === 1 ? 'negocio' : 'negocios'} color="verde" />
            <Contador valor={cuenta.proveedoresConNota} texto={cuenta.proveedoresConNota === 1 ? 'proveedor con nota' : 'proveedores con nota'} color="amarillo" />
            <Contador valor={cuenta.documentosSii} texto={cuenta.documentosSii === 1 ? 'documento en el SII' : 'documentos en el SII'} />
          </div>
          <Ranking estado={estado} cambios={cambios} ahora={ahora} />
          {lic && resumenLic && (
            <a className="tarjeta mini-lic" href="/licitacion">
              <p className="etiqueta">Compra conjunta · {lic.producto} {lic.estado !== 'abierta' && <span className="magenta">· cerrada</span>}</p>
              <div className="numero-grande">{resumenLic.precioActual !== undefined ? dinero(resumenLic.precioActual) : 'Sin ofertas'}</div>
              <p>
                {contar(resumenLic.compradores, 'negocio')}, {contar(resumenLic.totalUnidades, unidadDeLicitacion(lic).singular, unidadDeLicitacion(lic).plural)}
                {resumenLic.precioSolo !== undefined && <> · solo: <span className="tachado">{dinero(resumenLic.precioSolo)}</span></>}
              </p>
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
