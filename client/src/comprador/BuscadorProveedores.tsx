// El buscador de proveedores de /app (Proveedores → Todos): los de la red (registrados en Bando) y los de Mercado
// Público, en una sola lista unida por RUT. Clic en uno → su ficha (#proveedores/<clave>): categoría, giros del SII, antigüedad y
// precios de referencia con la fuente y fecha de cada dato, y su contacto (teléfono, WhatsApp o correo) con la página de donde salió.
// Solo aparecen proveedores a los que se les puede escribir: los de la red y los que tienen contacto. Se actualiza sola con cada `red:evento` (`evento`).
// Nunca muestra compradores de la red ni organismos públicos por nombre: solo conteos.

import { useState } from 'react';
import { CATEGORIAS, nombreCategoria } from '../../../shared/categorias.ts';
import { fechaCorta } from '../../../shared/fecha.ts';
import { dinero, nota } from '../../../shared/formato.ts';
import { enlaceWhatsapp, formatearTelefono } from '../../../shared/telefono.ts';
import { contar, segun } from '../../../shared/texto.ts';
import { Monograma } from '../canal/iconos.tsx';
import { LogoSii } from '../marca/LogoSii.tsx';
import { useJson } from '../red/useJson.ts';
import '../canal/canal.css';
import './buscador-proveedores.css';

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
interface Contacto { telefono: string | null; email: string | null; web: string | null; fuente: string }

interface Ficha extends Resumen {
  contacto: Contacto | null;
  sii: { inicioActividades: string | null; giros: { codigo: string; descripcion: string }[]; consultado: string } | null;
  productos: Precio[];
}
interface MetaMp { mercadoPublico: { fuente: 'mercado_publico' | 'ejemplo'; hasta: string | null } }
interface Busqueda extends MetaMp { total: number; pagina: number; paginas: number; conteos: Record<string, number>; resultados: Resumen[] }

const NOMBRE_FUENTE: Record<TipoFuente | 'ia' | 'reglas', string> = {
  bando: 'En Bando', mercado_publico: 'Mercado Público', sii: 'SII', ia: 'Inferido por IA', reglas: 'Por palabras clave',
};

const lugar = (r: Pick<Resumen, 'comuna' | 'region'>) => [r.comuna, r.region].filter(Boolean).join(', ');

/** "Desde 1993 · 33 años": el SII entrega el inicio como DD-MM-AAAA. */
function antiguedad(inicio: string | null): string | null {
  const anio = Number(inicio?.match(/(\d{4})/)?.[1]);
  if (!anio) return null;
  const anos = new Date().getFullYear() - anio;
  return `Desde ${anio} · ${contar(anos, 'año')}`;
}

const dominio = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/** Teléfono (y WhatsApp si es celular), correo y sitio, con la página de donde salió. */
function ContactoProveedor({ c, nombre }: { c: Contacto; nombre: string }) {
  const saludo = `Hola, los encontré en Bando. Quiero cotizar con ${nombre}.`;
  return (
    <section className="pv-contacto" aria-label="Contacto">
      {c.telefono?.startsWith('569') && <a className="pv-contacto-boton" href={enlaceWhatsapp(c.telefono, saludo)} target="_blank" rel="noreferrer">WhatsApp</a>}
      {c.telefono && <a className="pv-contacto-boton" href={`tel:+${c.telefono}`}>{formatearTelefono(c.telefono)}</a>}
      {c.email && <a className="pv-contacto-boton" href={`mailto:${c.email}?subject=${encodeURIComponent('Cotización')}`}>{c.email}</a>}
      {c.web && <a className="pv-contacto-boton" href={c.web} target="_blank" rel="noreferrer">{dominio(c.web)}</a>}
      <p className="pv-contacto-fuente mono tenue">Encontrado en <a href={c.fuente} target="_blank" rel="noreferrer">{dominio(c.fuente)}</a></p>
    </section>
  );
}

/** La lista con buscador y categorías, con las mismas filas que "Mis proveedores"; `abrir` lleva a la ficha de uno. */
export function Buscador({ evento, abrir }: { evento: number | undefined; abrir: (clave: string) => void }) {
  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState('');
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ q, categoria, pagina: String(pagina) });
  const { datos, error } = useJson<Busqueda>(`/api/proveedores?${params}`, evento);
  const elegir = (c: string) => { setCategoria(actual => (actual === c ? '' : c)); setPagina(1); };

  return (
    <>
      <div className="bm-busqueda">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input type="search" value={q} enterKeyHint="search" aria-label="Buscar proveedores"
          placeholder="Nombre, RUT, rubro o producto" onChange={e => { setQ(e.target.value); setPagina(1); }} />
      </div>
      <div className="bm-chips" role="group" aria-label="Categoría">
        {CATEGORIAS.filter(c => datos?.conteos[c.id] || categoria === c.id).map(c => (
          <button key={c.id} type="button" className={`bm-chip${categoria === c.id ? ' elegido' : ''}`} aria-pressed={categoria === c.id} onClick={() => elegir(c.id)}>
            {c.nombre} {datos?.conteos[c.id] ?? 0}
          </button>
        ))}
      </div>

      {error && <p className="bm-error">{error}</p>}
      {!datos && !error && <p className="bm-vacio-texto">Buscando proveedores...</p>}
      {datos && !datos.resultados.length && <p className="bm-vacio-texto">Nadie calza con "{q}". Prueba con un producto, como arroz o pollo.</p>}
      {datos && datos.resultados.length > 0 && (
        <ul className="bm-tarjeta bm-lista">
          {datos.resultados.map(r => (
            <li key={r.clave} className="bm-fila-enlace">
              <button type="button" className="bm-fila-proveedor" onClick={() => abrir(r.clave)}>
                <Monograma nombre={r.nombre} tam={40} rubro={false} />
                <span className="bm-fila-cuerpo">
                  <strong className="bm-fila-nombre">{r.nombre}</strong>
                  <span className="bm-fila-abajo">{[r.categoria?.nombre, r.comuna || r.region, ...r.fuentes.map(f => NOMBRE_FUENTE[f.tipo])].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="bm-nota-proveedor">{r.nota !== null ? <>★ {nota(r.nota)}</> : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {datos && datos.paginas > 1 && (
        <nav className="bm-paginas" aria-label="Páginas">
          <button type="button" className="bm-boton-texto" disabled={datos.pagina <= 1} onClick={() => setPagina(datos.pagina - 1)}>Anterior</button>
          <span>{contar(datos.total, 'proveedor', 'proveedores')} · página {datos.pagina} de {datos.paginas}</span>
          <button type="button" className="bm-boton-texto" disabled={datos.pagina >= datos.paginas} onClick={() => setPagina(datos.pagina + 1)}>Siguiente</button>
        </nav>
      )}
    </>
  );
}

/** La ficha de un proveedor: qué dicen Bando, Mercado Público y el SII, su contacto y sus precios de referencia. */
export function FichaProveedor({ clave, evento, volver }: { clave: string; evento: number | undefined; volver: () => void }) {
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
      {p.contacto && <ContactoProveedor c={p.contacto} nombre={p.nombre} />}

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
