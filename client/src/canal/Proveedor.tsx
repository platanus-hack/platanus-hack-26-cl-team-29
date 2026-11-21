// /proveedor: panel web del proveedor. Las mismas acciones que el proveedor hace por WhatsApp:
// cerrar y facturar la compra conjunta, confirmar y facturar pedidos y emitir notas de crédito.
// Toda acción en el SII pasa por un paso de confirmación en la página y recién ahí envía `confirmado: true`.

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { AvisoFuente } from '../components/Cabecera.tsx';
import { dinero, nota } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import { useAhora } from '../red/useRed.ts';
import type { Documento, Negocio } from '../red/tipos.ts';
import type { CanalApi } from './api.ts';
import { ConectarSii } from './ConectarSii.tsx';
import {
  estaAbierta, estaFacturada, licitacionVigente, montoNotaCredito, ordenesDeLaCompra, precioDelGrupo, resumenFacturacion, totalOrden, unidadPara, type Unidad,
} from './logica.ts';
import { Icono, iconoDeProducto, LogoSii, Monograma } from './iconos.tsx';
import { Confirmar, ListaDocumentos, Marca, useConfirmacion, useEnvio, Vacio } from './piezas.tsx';
import type { ConfigRed, LicitacionCanal, OrdenCanal, YoProveedor } from './tipos.ts';
import { useCanal, useDatosConSesion, useGuardado } from './useCanal.ts';
import './canal.css';

const cantidadEn = (n: number, u: Unidad) => contar(n, u.singular, u.plural);

export function Proveedor() {
  const { api, config, foto, cambio, fuente } = useCanal();
  // Solo en sessionStorage: el código del proveedor no queda guardado en el equipo al cerrar la pestaña.
  const [token, guardar] = useGuardado('domino.proveedor.token', 'sesion');
  const salir = useCallback(() => guardar(null), [guardar]);
  const tokenValido = token && api && token.startsWith('falso-') === (api.modo === 'falso') ? token : null;
  const { datos: yo, error, recargar } = useDatosConSesion(api, tokenValido, cambio, (a, t) => a.yoProveedor(t), salir);

  if (!api || !foto) return <main className="cn-pagina"><p className="vacio">Conectando con la red...</p></main>;
  if (!tokenValido) return <Acceso api={api} fuente={fuente} onEntrar={guardar} />;
  if (!yo) return <main className="cn-pagina"><p className={error ? 'error' : 'vacio'}>{error || 'Cargando tu panel...'}</p></main>;

  const lics = yo.licitaciones ?? foto.licitaciones;
  const lic = licitacionVigente(lics);
  // Las órdenes de la compra conjunta se facturan juntas desde su tarjeta, no una por una.
  const deCompras = new Set(lics.flatMap(l => ordenesDeLaCompra(l, yo.ordenes)).map(o => o.id));
  const nuevos = yo.ordenes.filter(o => o.estado === 'enviada' && !deCompras.has(o.id)).sort((a, b) => Date.parse(a.creadaEn) - Date.parse(b.creadaEn));
  const reclamos = yo.ordenes.filter(o => o.estado === 'reclamada');
  const comprador = (id: string) => foto.negocios.find(n => n.id === id);
  const props = { api, token: tokenValido, alCambiar: recargar };

  return (
    <div className="cn-app cn-panel">
      <header className="cn-cabecera">
        <Marca />
        <Monograma nombre={yo.proveedor?.nombre ?? 'Proveedor'} rubro={false} logoUrl={lic?.proveedorId === yo.proveedor?.id ? config?.proveedorLogoUrl : undefined} />
        <div className="cn-quien">
          <strong className="nombre">{yo.proveedor?.nombre ?? 'Proveedor'}</strong>
          <span className="mono tenue">Panel del proveedor <AvisoFuente fuente={fuente} /></span>
        </div>
        <button type="button" className="cn-boton-texto" onClick={salir}>Salir</button>
      </header>

      <main className="cn-contenido cn-rejilla">
        {error && <p className="error">{error}</p>}
        <div className="cn-columna">
          {lic ? <CompraDelProveedor {...props} lic={lic} yo={yo} config={config} /> : (
            <Vacio titulo="No hay una compra conjunta abierta" texto="Cuando parta una, aquí ves cuántos negocios se suman y la cierras y facturas con un toque." />
          )}

          <section className="cn-seccion">
            <h2 className="cn-titulo">Pedidos nuevos {nuevos.length > 0 && <span className="cn-globo">{nuevos.length}</span>}</h2>
            {nuevos.length ? nuevos.map(o => (
              <PedidoNuevo key={o.id} {...props} orden={o} comprador={comprador(o.compradorId)} config={config} />
            )) : <p className="mono tenue cn-texto">No tienes pedidos nuevos por ahora. Cuando un negocio te pida, aparece aquí para confirmarlo y facturarlo.</p>}
          </section>

          {reclamos.length > 0 && (
            <section className="cn-seccion">
              <h2 className="cn-titulo">Reclamos <span className="cn-globo magenta">{reclamos.length}</span></h2>
              {reclamos.map(o => (
                <Reclamo key={o.id} {...props} orden={o} comprador={comprador(o.compradorId)} documentos={yo.documentos} config={config} />
              ))}
            </section>
          )}
        </div>

        <div className="cn-columna">
          <ConectarSii api={api} token={tokenValido} />
          <MiNota yo={yo} />
          <MisDocumentos yo={yo} comprador={comprador} />
        </div>
      </main>
    </div>
  );
}

// ---------- Acceso ----------

function Acceso({ api, fuente, onEntrar }: { api: CanalApi; fuente: ReturnType<typeof useCanal>['fuente']; onEntrar: (token: string) => void }) {
  const [codigo, setCodigo] = useState('');
  const { enviando, error, setError, enviar: enviarA } = useEnvio();
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!codigo.trim()) return setError('Escribe tu código de acceso.');
    void enviarA(async () => onEntrar((await api.sesionProveedor(codigo.trim())).token), 'No pudimos entrar. Revisa el código.');
  };
  return (
    <main className="cn-pagina cn-bienvenida">
      <Marca><AvisoFuente fuente={fuente} /></Marca>
      <h1>Panel del proveedor</h1>
      <p className="cn-bajada">Confirma pedidos, factura en el SII y resuelve reclamos, igual que por WhatsApp.</p>
      <form className="formulario tarjeta" onSubmit={enviar}>
        <label className="campo">
          <span className="etiqueta">Código de acceso</span>
          <input value={codigo} onChange={e => setCodigo(e.target.value)} autoComplete="one-time-code" autoCapitalize="characters" maxLength={40} required />
        </label>
        {api.modo === 'falso' && <p className="mono tenue">Con datos de prueba sirve cualquier código.</p>}
        {error && <p className="error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Entrando...' : 'Entrar'}</button>
      </form>
    </main>
  );
}

// ---------- Compra conjunta ----------

type AccionCompra = { tipo: 'cerrar' } | { tipo: 'facturar'; facturas: number; total: number };

interface PropsAccion {
  api: CanalApi;
  token: string;
  alCambiar: () => void;
}

function CompraDelProveedor({ api, token, alCambiar, lic, yo, config }: PropsAccion & { lic: LicitacionCanal; yo: YoProveedor; config: ConfigRed | null }) {
  const ahora = useAhora();
  const u = unidadPara(lic.producto, config);
  const g = precioDelGrupo(lic);
  const total = g.unidades * (g.precio ?? 0);
  const abierta = estaAbierta(lic, ahora);
  const facturada = estaFacturada(lic, yo.ordenes);
  const ejecutar = useCallback(async (a: AccionCompra) => {
    if (a.tipo === 'cerrar') await api.cerrar(token, lic.id);
    else await api.facturar(token, lic.id);
    alCambiar();
  }, [api, token, lic.id, alCambiar]);
  const c = useConfirmacion(ejecutar);
  const f = resumenFacturacion(lic, yo.ordenes);

  return (
    <section className="tarjeta cn-compra">
      <div className="cn-fila-meta">
        {abierta ? <span className="en-vivo">En vivo</span> : <span className="cn-chip">{facturada ? 'Facturada' : 'Cerrada'}</span>}
        {abierta && <span className="mono">cierra en {cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}</span>}
      </div>
      <p className="etiqueta cn-sub">Compra conjunta</p>
      <h2 className="cn-producto cn-con-icono"><Icono nombre={iconoDeProducto(lic.producto)} tam={28} /><span>{lic.producto}</span></h2>
      <dl className="cn-cifras">
        <div><dt>Negocios</dt><dd>{lic.participantes.length}</dd></div>
        <div><dt>{u.plural}</dt><dd>{g.unidades}</dd></div>
        <div><dt>Precio por {u.singular}</dt><dd>{g.precio !== undefined ? dinero(g.precio) : '-'}</dd></div>
        <div><dt>Total neto</dt><dd className="amarillo">{dinero(total)}</dd></div>
      </dl>
      {abierta && g.siguiente && (
        <p className="mono tenue cn-texto">Con {cantidadEn(g.siguiente.faltan, u)} más, el precio baja a {dinero(g.siguiente.precio)}.</p>
      )}

      {c.estado.fase === 'nada' && !facturada && (
        lic.estado === 'abierta' ? (
          <button type="button" className="boton cn-ancho" onClick={() => c.pedir({ tipo: 'cerrar' })}>Cerrar compra</button>
        ) : (
          <button type="button" className="boton cn-ancho cn-boton-sii" onClick={() => c.pedir({ tipo: 'facturar', ...f })}><LogoSii /> Facturar todo en el SII</button>
        )
      )}
      {facturada && <p className="cn-ok cn-con-sii"><LogoSii />Facturada en el SII. Cada negocio ya recibió su factura.</p>}

      {c.estado.fase !== 'nada' && c.estado.accion.tipo === 'cerrar' && (
        <Confirmar
          titulo="¿Cierras la compra conjunta?"
          si="Sí, cerrar"
          {...c.panel}
        >
          <p>Nadie más podrá sumarse. Queda una orden por negocio: {contar(lic.participantes.length, 'negocio')}, {cantidadEn(g.unidades, u)} a {g.precio !== undefined ? dinero(g.precio) : '-'} por {u.singular}.</p>
        </Confirmar>
      )}
      {c.estado.fase !== 'nada' && c.estado.accion.tipo === 'facturar' && (
        <Confirmar
          sii
          titulo={`¿Emites ${contar(c.estado.accion.facturas, 'factura')} en el SII?`}
          si="Sí, factura todo"
          {...c.panel}
        >
          <p className="cn-cifra-confirmar">{dinero(c.estado.accion.total)} neto en total</p>
          <p>Una factura por negocio, con la orden de compra como referencia, en un solo envío al SII. Le avisamos a cada negocio con su folio.</p>
        </Confirmar>
      )}
    </section>
  );
}

// ---------- Pedidos nuevos ----------

function detalleDe(orden: OrdenCanal, config: ConfigRed | null): string {
  return orden.items.map(i => `${i.producto}, ${cantidadEn(i.cantidad, unidadPara(i.producto, config))}`).join('; ');
}

function PedidoNuevo({ api, token, alCambiar, orden, comprador, config }: PropsAccion & { orden: OrdenCanal; comprador?: Negocio; config: ConfigRed | null }) {
  const ejecutar = useCallback(async () => {
    await api.confirmarOrden(token, orden.id);
    alCambiar();
  }, [api, token, orden.id, alCambiar]);
  const c = useConfirmacion(ejecutar);
  const total = totalOrden(orden);
  const quien = comprador?.nombre ?? 'Un negocio';
  return (
    <article className="tarjeta cn-pedido">
      <header className="cn-pedido-cabecera">
        <div>
          <p className="etiqueta cn-con-sii"><Monograma nombre={quien} tam={24} />{quien}{comprador?.comuna ? ` · ${comprador.comuna}` : ''}</p>
          <h3>{detalleDe(orden, config)}</h3>
          <p className="mono tenue">{dinero(total)} neto</p>
        </div>
        <span className="cn-chip enviada">Nuevo</span>
      </header>
      {c.estado.fase === 'nada' ? (
        <button type="button" className="boton cn-ancho" onClick={() => c.pedir(undefined)}><LogoSii /> Confirmar y facturar</button>
      ) : (
        <Confirmar
          sii
          titulo="¿Confirmas y facturas?"
          si="Sí, factura"
          {...c.panel}
        >
          <p className="cn-cifra-confirmar">1 factura · {dinero(total)} neto</p>
          <p>Emitimos en el SII la factura con la orden de compra de {quien} y su guía de despacho. Le avisamos a {quien}.</p>
        </Confirmar>
      )}
    </article>
  );
}

// ---------- Reclamos ----------

function Reclamo({ api, token, alCambiar, orden, comprador, documentos, config }: PropsAccion & {
  orden: OrdenCanal; comprador?: Negocio; documentos: Documento[]; config: ConfigRed | null;
}) {
  const ejecutar = useCallback(async () => {
    await api.notaCredito(token, orden.id);
    alCambiar();
  }, [api, token, orden.id, alCambiar]);
  const c = useConfirmacion(ejecutar);
  const monto = montoNotaCredito(orden, documentos);
  const factura = documentos.find(d => d.ordenId === orden.id && d.tipo === 33);
  const item = orden.items[0];
  const u = unidadPara(item?.producto ?? '', config);
  const quien = comprador?.nombre ?? 'Un negocio';
  return (
    <article className="tarjeta cn-pedido reclamada">
      <header className="cn-pedido-cabecera">
        <div>
          <p className="etiqueta magenta cn-con-sii"><LogoSii tam={16} /> Reclamo en el SII</p>
          <h3>{quien} reclamó la factura{factura?.folio ? ` folio ${factura.folio}` : ''}</h3>
          <p className="mono tenue">
            {detalleDe(orden, config)}: {orden.reclamo?.faltante === 1 ? 'faltó' : 'faltaron'} {cantidadEn(orden.reclamo?.faltante ?? 0, u)}.
          </p>
        </div>
      </header>
      {c.estado.fase === 'nada' ? (
        <>
          <p className="mono tenue cn-texto">Si emites la nota de crédito hoy, tu nota sube.</p>
          <button type="button" className="boton cn-ancho" onClick={() => c.pedir(undefined)}><LogoSii /> Emitir nota de crédito por {dinero(monto)}</button>
        </>
      ) : (
        <Confirmar
          sii
          titulo="¿Emites la nota de crédito?"
          si="Sí, emítela"
          {...c.panel}
        >
          <p className="cn-cifra-confirmar">Nota de crédito · {dinero(monto)} neto</p>
          <p>Queda amarrada a la factura{factura?.folio ? ` folio ${factura.folio}` : ''} en el SII. Le avisamos a {quien}.</p>
        </Confirmar>
      )}
    </article>
  );
}

// ---------- Nota y documentos ----------

/** La nota anterior: la que manda el backend o, si no la manda, la última distinta que vio esta pestaña. */
function useNotaAnterior(actual: number | null, delBackend?: number): number | undefined {
  const vista = useRef<{ actual: number | null; anterior?: number }>({ actual });
  if (vista.current.actual !== actual) vista.current = { actual, anterior: vista.current.actual ?? undefined };
  return delBackend ?? vista.current.anterior;
}

function MiNota({ yo }: { yo: YoProveedor }) {
  const anterior = useNotaAnterior(yo.nota, yo.notaAnterior);
  if (yo.nota === null) {
    return <Vacio titulo="Todavía no tienes nota" texto="Tu nota se calcula con tus entregas: cada entrega conforme suma y cada reclamo resta." />;
  }
  const cambio = anterior !== undefined ? Math.round((yo.nota - anterior) * 10) / 10 : 0;
  return (
    <section className="tarjeta cn-mi-nota">
      <p className="etiqueta">Mi nota en la red</p>
      <div className="cn-precio">
        <span className={`numero-grande ${cambio < 0 ? 'magenta' : cambio > 0 ? 'verde' : 'amarillo'}`}>{nota(yo.nota)}</span>
        {anterior !== undefined && cambio !== 0 && <span className="mono tachado">{nota(anterior)}</span>}
      </div>
      <p className="mono tenue cn-texto">
        {cambio < 0 ? `Bajó ${nota(-cambio)} con el último cambio. ` : cambio > 0 ? `Subió ${nota(cambio)} con el último cambio. ` : ''}
        Entrega conforme suma 0,1, reclamo resta 0,4 y nota de crédito el mismo día suma 0,2.
      </p>
    </section>
  );
}

function MisDocumentos({ yo, comprador }: { yo: YoProveedor; comprador: (id: string) => Negocio | undefined }) {
  const compradorDe = (d: Documento) => comprador(yo.ordenes.find(o => o.id === d.ordenId)?.compradorId ?? '')?.nombre ?? 'Cliente';
  return (
    <section className="cn-seccion">
      <h2 className="cn-titulo"><LogoSii tam={22} /> Mis documentos en el SII</h2>
      {yo.documentos.length
        ? <ListaDocumentos documentos={yo.documentos} contraparte={compradorDe} />
        : <p className="mono tenue cn-texto">Aquí aparecen tus facturas, guías y notas de crédito con su estado en el SII.</p>}
    </section>
  );
}
