// /proveedores: el buscador donde viven todos los proveedores, los de la red (registrados en Bando) y los de Mercado
// Público, en una sola lista unida por RUT. Clic en uno → su ficha (?p=<clave>): categoría, giros del SII, antigüedad y
// precios de referencia con la fuente y fecha de cada dato. Se actualiza sola con cada `red:evento` (useRed).
// Nunca muestra compradores de la red ni organismos públicos por nombre: solo conteos.

import { useEffect, useState } from 'react';
import { CATEGORIAS, nombreCategoria } from '../../../shared/categorias.ts';
import { fechaCorta } from '../../../shared/fecha.ts';
import { dinero, nota } from '../../../shared/formato.ts';
import { contar, segun } from '../../../shared/texto.ts';
import { LogoSii, Monograma } from '../canal/iconos.tsx';
import { useRed } from '../red/useRed.ts';
import '../canal/canal.css';
import './proveedores.css';

type TipoFuente = 'bando' | 'mercado_publico' | 'sii';
interface Categoria { id: string; nombre: string; fuente: 'bando' | 'mercado_publico' | 'sii' | 'ia' | 'reglas'; porque?: string }
interface Resumen {
  clave: string;
  rut: string | null;
  nombre: string;
  region: string;
  comuna: string;
  categoria: Categoria | null;
  secundarias: string[];
  fuentes: { tipo: TipoFuente; fecha: string | null }[];
  nota: number | null;
  organismos: number;
  destacados: string[];
}
interface Precio { producto: string; unidad: string; datos: number; minimo: number; mediana: number; maximo: number; fecha: string | null; fuente: 'bando' | 'mercado_publico' }
interface Ficha extends Resumen {
  sii: { inicioActividades: string | null; giros: { codigo: string; descripcion: string }[]; consultado: string } | null;
  productos: Precio[];
}
interface MetaMp { mercadoPublico: { fuente: 'mercado_publico' | 'ejemplo'; hasta: string | null } }
interface Busqueda extends MetaMp { total: number; pagina: number; paginas: number; conteos: Record<string, number>; resultados: Resumen[] }

const NOMBRE_FUENTE: Record<TipoFuente | 'ia' | 'reglas', string> = {
  bando: 'En Bando', mercado_publico: 'Mercado Público', sii: 'SII', ia: 'Inferido por IA', reglas: 'Por palabras clave',
};

const claveEnUrl = () => new URLSearchParams(location.search).get('p');

/** GET que se repite con cada evento de la red: así la vista nunca depende de recargar. */
function useJson<T>(url: string | null, evento: number | undefined) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) return;
    let activo = true;
    const t = setTimeout(() => {
      fetch(url, { headers: { accept: 'application/json' } })
        .then(async r => {
          if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw new Error(r.status === 404 ? 'No encontramos ese proveedor.' : 'No pudimos cargar los proveedores.');
          return r.json() as Promise<T>;
        })
        .then(d => { if (activo) { setDatos(d); setError(''); } })
        .catch((e: Error) => activo && setError(e.message));
    }, 150);
    return () => { activo = false; clearTimeout(t); };
  }, [url, evento]);
  return { datos, error };
}

const lugar = (r: Pick<Resumen, 'comuna' | 'region'>) => [r.comuna, r.region].filter(Boolean).join(', ');

/** "Desde 1993 · 33 años": el SII entrega el inicio como DD-MM-AAAA. */
function antiguedad(inicio: string | null): string | null {
  const anio = Number(inicio?.match(/(\d{4})/)?.[1]);
  if (!anio) return null;
  const anos = new Date().getFullYear() - anio;
  return `Desde ${anio} · ${contar(anos, 'año')}`;
}

function ChipsFuente({ fuentes }: { fuentes: Resumen['fuentes'] }) {
  return (
    <span className="pv-fuentes">
      {fuentes.map(f => (
        <span key={f.tipo} className={`pv-chip pv-chip-${f.tipo}`} title={f.fecha ? `Dato del ${fechaCorta(f.fecha)}` : undefined}>
          {f.tipo === 'sii' && <LogoSii tam={14} />}{NOMBRE_FUENTE[f.tipo]}{f.fecha ? ` · ${fechaCorta(f.fecha)}` : ''}
        </span>
      ))}
    </span>
  );
}

export function Proveedores() {
  const { eventos } = useRed();
  const evento = eventos[0]?.clave;
  const [clave, setClave] = useState(claveEnUrl);
  useEffect(() => {
    const alVolver = () => setClave(claveEnUrl());
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, []);
  const abrir = (c: string | null) => {
    history.pushState(null, '', c ? `/proveedores?p=${encodeURIComponent(c)}` : '/proveedores');
    setClave(c);
    window.scrollTo(0, 0);
  };
  return (
    <main className="pv-pagina">
      {clave ? <FichaProveedor clave={clave} evento={evento} volver={() => abrir(null)} /> : <Buscador evento={evento} abrir={abrir} />}
    </main>
  );
}

function Buscador({ evento, abrir }: { evento: number | undefined; abrir: (clave: string) => void }) {
  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState('');
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ q, categoria, pagina: String(pagina) });
  const { datos, error } = useJson<Busqueda>(`/api/proveedores?${params}`, evento);
  const elegir = (c: string) => { setCategoria(actual => (actual === c ? '' : c)); setPagina(1); };

  return (
    <>
      <header className="pv-cabecera">
        <p className="pv-ceja">Proveedores · Bando y Mercado Público</p>
        <h1 className="pv-titulo">Encuentra a quién comprarle</h1>
        <div className="pv-busqueda">
          <input
            type="search" value={q} autoFocus enterKeyHint="search" aria-label="Buscar proveedores"
            placeholder="Nombre, RUT, rubro o producto" onChange={e => { setQ(e.target.value); setPagina(1); }}
          />
        </div>
        <div className="pv-categorias" role="group" aria-label="Filtrar por categoría">
          {CATEGORIAS.filter(c => datos?.conteos[c.id] || categoria === c.id).map(c => (
            <button key={c.id} type="button" className="pv-categoria" aria-pressed={categoria === c.id} onClick={() => elegir(c.id)}>
              {c.nombre} <span className="tenue">{datos?.conteos[c.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!datos && !error && <p className="vacio">Buscando proveedores...</p>}
      {datos && (
        <>
          <p className="pv-total mono">
            {contar(datos.total, 'proveedor', 'proveedores')}
            {datos.mercadoPublico.hasta && ` · Mercado Público al ${fechaCorta(datos.mercadoPublico.hasta)}`}
            {datos.mercadoPublico.fuente === 'ejemplo' && <span className="fuente-falsa">datos de ejemplo</span>}
          </p>
          {!datos.resultados.length && <p className="vacio">Nadie calza con "{q}". Prueba con un producto, como arroz o pollo.</p>}
          <ul className="pv-lista">
            {datos.resultados.map(r => (
              <li key={r.clave}>
                <button type="button" className="pv-fila" onClick={() => abrir(r.clave)}>
                  <Monograma nombre={r.nombre} tam={44} rubro={false} />
                  <span className="pv-fila-cuerpo">
                    <span className="pv-fila-nombre">{r.nombre}</span>
                    <span className="pv-fila-detalle mono">
                      {[r.categoria?.nombre, ...r.secundarias.slice(0, 2).map(nombreCategoria)].filter(Boolean).join(' · ') || 'Sin categoría todavía'}
                    </span>
                    {lugar(r) && <span className="pv-fila-detalle mono tenue">{lugar(r)}</span>}
                    <span className="pv-fila-pie">
                      <ChipsFuente fuentes={r.fuentes} />
                      {r.organismos > 0 && <span className="pv-organismos mono">{contar(r.organismos, 'organismo')} le {segun(r.organismos, 'compra', 'compran')}</span>}
                    </span>
                  </span>
                  {r.nota !== null && <span className="pv-nota" title="Nota en la red de Bando">{nota(r.nota)}</span>}
                </button>
              </li>
            ))}
          </ul>
          {datos.paginas > 1 && (
            <nav className="pv-paginas mono" aria-label="Páginas">
              <button type="button" className="pv-categoria" disabled={datos.pagina <= 1} onClick={() => setPagina(datos.pagina - 1)}>Anterior</button>
              <span>Página {datos.pagina} de {datos.paginas}</span>
              <button type="button" className="pv-categoria" disabled={datos.pagina >= datos.paginas} onClick={() => setPagina(datos.pagina + 1)}>Siguiente</button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

function FichaProveedor({ clave, evento, volver }: { clave: string; evento: number | undefined; volver: () => void }) {
  const { datos, error } = useJson<{ proveedor: Ficha } & MetaMp>(`/api/proveedores/${encodeURIComponent(clave)}`, evento);
  const atras = <button type="button" className="pv-volver mono" onClick={volver}>← Todos los proveedores</button>;
  if (error) return <>{atras}<p className="error">{error}</p></>;
  if (!datos) return <>{atras}<p className="vacio">Cargando la ficha...</p></>;
  const p = datos.proveedor;
  const mp = p.fuentes.find(f => f.tipo === 'mercado_publico');
  const bando = p.fuentes.find(f => f.tipo === 'bando');
  const anos = antiguedad(p.sii?.inicioActividades ?? null);
  const deEjemplo = datos.mercadoPublico.fuente === 'ejemplo' && !bando;
  const siiTexto = !p.rut ? 'Sin RUT para consultar.' : deEjemplo ? 'Proveedor de ejemplo: no se consulta.' : 'Consultando sus giros...';
  return (
    <>
      {atras}
      <header className="pv-cabecera-ficha">
        <Monograma nombre={p.nombre} tam={56} rubro={false} />
        <div>
          <p className="pv-ceja">Ficha del proveedor{p.rut ? ` · RUT ${p.rut}` : ''}</p>
          <h1 className="pv-titulo">{p.nombre}</h1>
          {lugar(p) && <p className="pv-fila-detalle mono tenue">{lugar(p)}</p>}
        </div>
      </header>

      <section className="pv-dicen">
        <article className={`pv-dice${bando ? ' pv-dice-bando' : ''}`}>
          <p className="etiqueta">Bando dice</p>
          <p>{bando ? (p.nota !== null ? `Está en la red. Nota ${nota(p.nota)} de 5 según "¿llegó bien?".` : 'Está en la red.') : 'Todavía no usa Bando.'}</p>
        </article>
        <article className="pv-dice">
          <p className="etiqueta">Mercado Público dice</p>
          <p>{mp ? `${contar(p.organismos, 'organismo público', 'organismos públicos')} le ${segun(p.organismos, 'compró', 'compraron')}. Última venta el ${fechaCorta(mp.fecha ?? '')}.` : 'No le vende al Estado.'}</p>
        </article>
        <article className="pv-dice">
          <p className="etiqueta pv-con-sii"><LogoSii tam={14} /> El SII dice</p>
          {p.sii ? (
            <ul className="pv-giros">
              {p.sii.giros.slice(0, 4).map(g => <li key={g.codigo}>{g.descripcion.toLowerCase()}</li>)}
              {!p.sii.giros.length && <li>Sin giros informados.</li>}
            </ul>
          ) : <p className="tenue">{siiTexto}</p>}
        </article>
      </section>

      <section className="pv-cifras">
        <div className="pv-cifra pv-cifra-volt">
          <p className="etiqueta">Categoría</p>
          <p className="pv-cifra-valor">{p.categoria?.nombre ?? 'Sin categoría'}</p>
          <p className="pv-cifra-pie mono">
            {p.categoria ? `${NOMBRE_FUENTE[p.categoria.fuente]}${p.categoria.porque ? `: ${p.categoria.porque}` : ''}` : 'Faltan datos para clasificarlo'}
          </p>
          {p.secundarias.length > 0 && <p className="pv-cifra-pie mono tenue">También: {p.secundarias.map(nombreCategoria).join(', ')}</p>}
        </div>
        <div className="pv-cifra pv-cifra-sii">
          <p className="etiqueta">Antigüedad</p>
          <p className="pv-cifra-valor">{anos ?? 'Sin dato'}</p>
          <p className="pv-cifra-pie mono">{p.sii ? `Inicio de actividades en el SII · consultado el ${fechaCorta(p.sii.consultado)}` : 'Aún no consultado en el SII'}</p>
        </div>
        <div className="pv-cifra pv-cifra-magenta">
          <p className="etiqueta">Productos con precio</p>
          <p className="pv-cifra-valor">{p.productos.length}</p>
          <p className="pv-cifra-pie mono">mediana y rango de lo que cobró</p>
        </div>
      </section>

      <section className="pv-productos">
        <h2 className="etiqueta">Precios de referencia</h2>
        {!p.productos.length && <p className="vacio">Todavía no hay precios de este proveedor.</p>}
        <ul className="pv-precios">
          {p.productos.map(x => (
            <li key={`${x.fuente}|${x.producto}|${x.unidad}`} className="pv-precio">
              <span className="pv-precio-producto">{x.producto}</span>
              <span className="pv-precio-mediana mono">{dinero(x.mediana)} <span className="tenue">/ {x.unidad}</span></span>
              <span className="pv-precio-pie mono tenue">
                {x.minimo !== x.maximo ? `${dinero(x.minimo)} a ${dinero(x.maximo)} · ` : ''}
                {contar(x.datos, 'precio')} · {NOMBRE_FUENTE[x.fuente]}{x.fecha ? ` · ${fechaCorta(x.fecha)}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {datos.mercadoPublico.fuente === 'ejemplo' && mp && <p className="fuente-falsa">Mercado Público con datos de ejemplo</p>}
      </section>
    </>
  );
}
