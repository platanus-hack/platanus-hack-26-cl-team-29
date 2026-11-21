import type { ReactNode } from 'react';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { Icono, LogoSii, Monograma, type NombreIcono } from '../components/Iconos.tsx';
import { useFilasQueCaben } from '../components/medidas.ts';
import {
  cicloDeOrden, contadores, describirEvento, licitacionActual, negocioPorId, ordenActual, ranking, totalesCanasta, unidadDeLicitacion,
  type CambioNota, type FilaRanking,
} from '../red/derivar.ts';
import { dinero, miles, nota } from '../../../shared/formato.ts';
import { contar, haceCuanto, pedidoDe, unidadDe } from '../red/formato.ts';
import type { EstadoRed, EventoRed, TipoEvento } from '../red/tipos.ts';
import { useAhora, useConfigRed, useRed, type EventoVisto } from '../red/useRed.ts';

export function Contador({ valor, texto, color, marca }: { valor: number; texto: string; color?: string; marca?: ReactNode }) {
  return (
    <div className="tarjeta contador">
      <div className="contador-fila">
        <div className={`numero-grande ${color ?? ''}`}>{miles(valor)}</div>
        {marca}
      </div>
      <p className="etiqueta">{texto}</p>
    </div>
  );
}

function Fila({ fila, logoUrl }: { fila: FilaRanking; logoUrl?: string }) {
  const c = fila.cambio;
  const baja = c && fila.nota < c.anterior;
  return (
    <li className={`fila-ranking ${c ? (baja ? 'baja' : 'sube') : ''}`}>
      <span className="puesto">{fila.puesto}</span>
      <Monograma nombre={fila.proveedor.nombre} logoUrl={logoUrl} />
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

/** `logoUrl` es el logo del proveedor de la demo (`proveedorSala`); los demás llevan monograma. */
export function Ranking({ estado, cambios, ahora, logoUrl, proveedorSala }: {
  estado: EstadoRed; cambios: CambioNota[]; ahora: number; logoUrl?: string; proveedorSala?: string;
}) {
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
        <ol className="ranking ajustable" ref={lista}>{visibles.map(f => <Fila key={f.proveedor.id} fila={f} logoUrl={f.proveedor.id === proveedorSala ? logoUrl : undefined} />)}</ol>
      ) : (
        <p className="vacio">Aún no hay proveedores con nota.</p>
      )}
    </section>
  );
}

const ICONO_EVENTO: Partial<Record<TipoEvento, NombreIcono>> = {
  'orden.creada': 'pedido',
  'orden.confirmada': 'check',
  'recepcion.registrada': 'caja',
  'nota.cambiada': 'nota',
  'licitacion.precio_bajo': 'baja',
  'licitacion.cerrada': 'cerrada',
};
const EVENTO_SII = new Set<TipoEvento>(['documento.emitido', 'documento.actualizado', 'reclamo.registrado', 'nota_credito.emitida', 'licitacion.facturada']);

/** Lo del SII lleva su logo; quien se suma o oferta, su monograma; el resto, un ícono de línea. */
function IconoEvento({ e, estado }: { e: EventoRed; estado: EstadoRed }) {
  if (EVENTO_SII.has(e.tipo)) return <LogoSii />;
  const quien = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  if (e.tipo === 'licitacion.participante') {
    const p = quien(e.datos.participante);
    const nombre = typeof p.nombre === 'string' ? p.nombre : negocioPorId(estado, String(p.negocioId ?? ''))?.nombre;
    if (nombre) return <Monograma nombre={nombre} rubro />;
  }
  if (e.tipo === 'licitacion.oferta') {
    const o = quien(e.datos.oferta);
    const nombre = typeof o.proveedorNombre === 'string' ? o.proveedorNombre : negocioPorId(estado, String(o.proveedorId ?? ''))?.nombre;
    if (nombre) return <Monograma nombre={nombre} />;
  }
  return <Icono nombre={ICONO_EVENTO[e.tipo] ?? 'pedido'} />;
}

export function Feed({ estado, eventos, ahora }: { estado: EstadoRed; eventos: EventoVisto[]; ahora: number }) {
  const [lista, caben] = useFilasQueCaben<HTMLUListElement>(5, eventos.length > 0);
  return (
    <section className="tarjeta apilada crece">
      <p className="etiqueta">Pasando ahora</p>
      {eventos.length ? (
        <ul className="feed ajustable" ref={lista}>
          {eventos.slice(0, caben).map(e => (
            <li key={e.clave}>
              <span className="feed-icono"><IconoEvento e={e} estado={estado} /></span>
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

/** Resumen de la compra conjunta en curso: total de la canasta y ahorro, negocios y unidades. Lleva a /licitacion. */
export function MiniLicitacion({ estado }: { estado: EstadoRed }) {
  const lic = licitacionActual(estado);
  if (!lic) return null;
  const c = totalesCanasta(lic);
  const productos = lic.productos?.length ?? 1;
  const unidad = productos > 1 ? { singular: 'unidad', plural: 'unidades' } : unidadDeLicitacion(lic);
  return (
    <a className="tarjeta mini-lic" href="/licitacion">
      <p className="etiqueta">
        Compra conjunta{productos > 1 ? ` · ${contar(productos, 'producto')}` : ''} {lic.estado !== 'abierta' && <span className="magenta">· cerrada</span>}
      </p>
      <div className="mini-lic-precio">
        <span className="numero-grande">{dinero(c.monto)}</span>
        <span className="tenue">neto</span>
      </div>
      {c.ahorro > 0 && <p className="mini-lic-ahorro verde">la sala ahorra {dinero(c.ahorro)}</p>}
      <p>{contar(c.negocios, 'negocio')} · {contar(c.unidades, unidad.singular, unidad.plural)}</p>
    </a>
  );
}

export function RedEnVivo() {
  const { estado, eventos, cambios, fuente } = useRed();
  const config = useConfigRed(fuente);
  const ahora = useAhora();
  if (!estado) return <Cargando />;

  const cuenta = contadores(estado);
  const orden = ordenActual(estado);
  const pasos = orden ? cicloDeOrden(estado, orden, eventos) : [];
  const item = orden?.items[0];

  return (
    <main className="pagina proyeccion red">
      <header className="red-cabecera">
        <div className="marca" aria-hidden>B</div>
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
                  {pedidoDe(item.cantidad, item.producto)} a{' '}
                  <span className="amarillo">{dinero(item.precioUnitario)}</span> por {unidadDe(item.producto).singular}
                </h2>
                <p className="orden-partes">
                  {negocioPorId(estado, orden.compradorId)?.nombre ?? 'Comprador'} → {negocioPorId(estado, orden.proveedorId)?.nombre ?? 'Proveedor'} · {orden.id}
                </p>
                <ol className="ciclo" aria-label="Ciclo de la orden">
                  {pasos.map((p, i) => (
                    <li key={p.titulo} className={`paso ${p.carril} ${p.estado}`}>
                      <span className="num">{i + 1} · {p.carril === 'sii' ? <LogoSii /> : p.carril}</span>
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
            <Contador valor={cuenta.documentosSii} texto={cuenta.documentosSii === 1 ? 'documento en el SII' : 'documentos en el SII'} marca={<LogoSii />} />
          </div>
          <Ranking estado={estado} cambios={cambios} ahora={ahora} logoUrl={config.proveedorLogoUrl ?? negocioPorId(estado, licitacionActual(estado)?.proveedorId)?.logoUrl} proveedorSala={licitacionActual(estado)?.proveedorId} />
          <MiniLicitacion estado={estado} />
        </div>
      </div>
    </main>
  );
}
