/// <reference types="vite/client" />
// /mapa: la red sobre un mapa real de Santiago, 30 km alrededor del MUT.
// Los datos son los mismos de /red (useRed): cada `red:evento` mueve el mapa y el panel a la vez.

import { useEffect, useRef } from 'react';
import { AttributionControl, Map as MapaLibre, Marker, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
// MapLibre 6 busca su worker junto a su propio archivo; al compilar con Vite ese archivo cambia de nombre.
// Vite copia el worker a dist/assets y nos da su URL.
import urlDelWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './mapa.css';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { LogoSii } from '../components/Iconos.tsx';
import { capas, circulo, MUT, pulsoDeEvento, RADIO_KM, ubicar } from '../mapa/geo.ts';
import { contornoDeCelda, puntosDeLocales, useLocales, type Locales } from '../mapa/useLocales.ts';
import { contadores, notaDe, type CambioNota } from '../red/derivar.ts';
import { miles, nota } from '../../../shared/formato.ts';
import type { EstadoRed } from '../red/tipos.ts';
import { useAhora, useRed, type EventoVisto } from '../red/useRed.ts';
import { Contador, Feed, MiniLicitacion, Ranking } from './RedEnVivo.tsx';

setWorkerUrl(urlDelWorker);

const ESTILO = 'https://tiles.openfreemap.org/styles/dark';
/** Sin internet no hay calles: queda un fondo liso y los negocios se dibujan igual. */
const SIN_CALLES: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': '#0b0b0b' } }],
};
const DURACION_PULSO = 2400;

const AMARILLO = '#f2ff00';
const VERDE = '#08ff00';
const MAGENTA = '#ff1ab3';

function agregarCapas(m: MapaLibre) {
  const vacio = { type: 'FeatureCollection' as const, features: [] };
  m.addSource('radio', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circulo(MUT, RADIO_KM) } } });
  m.addSource('lineas', { type: 'geojson', data: vacio });
  m.addSource('negocios', { type: 'geojson', data: vacio });
  m.addSource('locales', { type: 'geojson', data: vacio });
  m.addSource('buscando', { type: 'geojson', data: vacio });
  m.addLayer({ id: 'radio', type: 'line', source: 'radio', paint: { 'line-color': AMARILLO, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [3, 3] } });
  // Locales que encontró el explorador: debajo de la red, tenues, para que la red mande.
  m.addLayer({ id: 'locales', type: 'circle', source: 'locales', paint: { 'circle-radius': 2.5, 'circle-color': '#9adfff', 'circle-opacity': 0.55 } });
  m.addLayer({ id: 'buscando', type: 'line', source: 'buscando', paint: { 'line-color': '#9adfff', 'line-width': 1.5, 'line-dasharray': [1, 1] } });
  m.addLayer({
    id: 'lineas', type: 'line', source: 'lineas', filter: ['!=', ['get', 'tipo'], 'reclamo'],
    paint: {
      'line-color': ['match', ['get', 'tipo'], 'actual', AMARILLO, '#ffffff'],
      'line-width': ['match', ['get', 'tipo'], 'actual', 3, 1],
      'line-opacity': ['match', ['get', 'tipo'], 'actual', 1, 0.25],
    },
  });
  m.addLayer({
    id: 'lineas-reclamo', type: 'line', source: 'lineas', filter: ['==', ['get', 'tipo'], 'reclamo'],
    paint: { 'line-color': MAGENTA, 'line-width': 3, 'line-dasharray': [2, 2] },
  });
  m.addLayer({
    id: 'negocios', type: 'circle', source: 'negocios',
    paint: {
      'circle-radius': ['match', ['get', 'rol'], 'proveedor', 8, 5],
      'circle-color': ['case', ['==', ['get', 'cambio'], 'baja'], MAGENTA, ['==', ['get', 'rol'], 'proveedor'], AMARILLO, VERDE],
      'circle-stroke-color': '#0b0b0b',
      'circle-stroke-width': ['match', ['get', 'rol'], 'proveedor', 2, 1],
    },
  });
}

function crear(clase: string, html = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = clase;
  el.innerHTML = html;
  return el;
}

function Lienzo({ estado, cambios, eventos, locales }: { estado: EstadoRed; cambios: CambioNota[]; eventos: EventoVisto[]; locales: Locales | null }) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLibre | null>(null);
  const etiquetas = useRef(new Map<string, Marker>());
  const vistos = useRef(new Set<number>());
  const datos = useRef(capas(estado, cambios));
  const exploracion = useRef(locales);

  const pintar = () => {
    const m = mapa.current;
    if (!m?.getSource('negocios')) return;
    (m.getSource('negocios') as GeoJSONSource).setData(datos.current.negocios);
    (m.getSource('lineas') as GeoJSONSource).setData(datos.current.lineas);
    (m.getSource('locales') as GeoJSONSource).setData(puntosDeLocales(exploracion.current?.locales ?? []));
    (m.getSource('buscando') as GeoJSONSource).setData(contornoDeCelda(exploracion.current?.avance.buscando ?? null));
  };

  useEffect(() => {
    // Créditos abajo a la izquierda: arriba están el aviso y la leyenda.
    const m = new MapaLibre({ container: caja.current!, style: ESTILO, center: MUT, zoom: 10, attributionControl: false });
    m.addControl(new AttributionControl({ compact: true }), 'bottom-left');
    // Plegados en el botón (i): el crédito de OpenStreetMap queda siempre a la vista en la leyenda.
    m.once('load', () => caja.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
    mapa.current = m;
    let conCalles = false;
    m.on('style.load', () => {
      conCalles = true;
      agregarCapas(m);
      pintar();
    });
    // Si el estilo no carga (sala sin internet), se cambia una sola vez al fondo liso.
    m.on('error', () => {
      if (conCalles) return;
      conCalles = true;
      m.setStyle(SIN_CALLES);
    });
    new Marker({ element: crear('mapa-mut', '<i></i><span>MUT</span>'), anchor: 'left' }).setLngLat(MUT).addTo(m);
    return () => {
      etiquetas.current.clear();
      mapa.current = null;
      m.remove();
    };
  }, []);

  // Cada foto nueva de la red repinta los puntos, las líneas y las etiquetas de los proveedores.
  useEffect(() => {
    datos.current = capas(estado, cambios);
    pintar();
    const m = mapa.current;
    if (!m) return;
    const proveedores = estado.negocios.filter(n => n.rol === 'proveedor');
    for (const [id, marcador] of etiquetas.current) {
      if (!proveedores.some(p => p.id === id)) {
        marcador.remove();
        etiquetas.current.delete(id);
      }
    }
    for (const p of proveedores) {
      let marcador = etiquetas.current.get(p.id);
      if (!marcador) {
        marcador = new Marker({ element: crear('mapa-proveedor'), anchor: 'left', offset: [12, 0] }).setLngLat(ubicar(p)).addTo(m);
        etiquetas.current.set(p.id, marcador);
      }
      const cambio = cambios.find(c => c.proveedorId === p.id);
      const valor = notaDe(estado, p.id);
      const el = marcador.getElement();
      el.classList.toggle('baja', !!cambio && cambio.nota < cambio.anterior);
      el.classList.toggle('sube', !!cambio && cambio.nota > cambio.anterior);
      el.replaceChildren(Object.assign(document.createElement('span'), { textContent: p.nombre }));
      if (valor !== undefined) el.append(Object.assign(document.createElement('b'), { textContent: nota(valor) }));
    }
  }, [estado, cambios]);

  // Cada celda que recorre el explorador suma sus locales y mueve el contorno de búsqueda.
  useEffect(() => {
    exploracion.current = locales;
    pintar();
  }, [locales]);

  // Cada evento nuevo late una vez en el negocio donde pasó.
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    for (const e of eventos) {
      if (vistos.current.has(e.clave)) continue;
      vistos.current.add(e.clave);
      if (Date.now() - e.recibido > DURACION_PULSO) continue;
      const pulso = pulsoDeEvento(e, estado);
      const negocio = pulso && estado.negocios.find(n => n.id === pulso.negocioId);
      if (!pulso || !negocio) continue;
      const marcador = new Marker({ element: crear(`mapa-pulso ${pulso.clase}`) }).setLngLat(ubicar(negocio)).addTo(m);
      setTimeout(() => marcador.remove(), DURACION_PULSO);
    }
  }, [eventos, estado]);

  return <div className="mapa-lienzo" ref={caja} role="img" aria-label="Mapa de Santiago con los negocios y proveedores de la red" />;
}

/** Por dónde va el explorador de locales: cuántos lleva y a qué distancia del MUT. */
function AvisoExploracion({ locales }: { locales: Locales }) {
  const { avance } = locales;
  const que = avance.terminado ? 'Todo Chile' : avance.fase === 'reparto' ? 'Repartiendo por Chile' : 'Hacia afuera';
  return (
    <p className="mapa-exploracion" aria-live="polite">
      <i className={avance.terminado ? '' : 'activo'} />
      {que} · {miles(locales.locales.length)} locales{avance.fase === 'acumulando' && !avance.terminado ? ` · ${miles(Math.round(avance.distanciaKm))} km` : ''}
    </p>
  );
}

export function Mapa() {
  const { estado, eventos, cambios, fuente } = useRed();
  const locales = useLocales();
  const ahora = useAhora();
  if (!estado) return <Cargando />;
  const cuenta = contadores(estado);

  return (
    <main className="pagina proyeccion red">
      <header className="red-cabecera">
        <div className="marca" aria-hidden>B</div>
        <h1 className="titulo-red">La red en el mapa, en vivo</h1>
        <span className="en-vivo contorno">En vivo</span>
        <AvisoFuente fuente={fuente} />
      </header>

      <div className="red-cuerpo">
        <section className="mapa-caja">
          <Lienzo estado={estado} cambios={cambios} eventos={eventos} locales={locales} />
          {locales && <AvisoExploracion locales={locales} />}
          <ul className="mapa-leyenda" aria-label="Leyenda">
            <li><i className="punto verde" /> negocio</li>
            <li><i className="punto amarillo" /> proveedor</li>
            {locales && <li><i className="punto local" /> local cercano</li>}
            <li><i className="raya amarillo" /> último pedido</li>
            <li><i className="raya magenta" /> reclamo</li>
            <li><i className="raya radio" /> {RADIO_KM} km desde el MUT</li>
            <li className="credito">mapa © OpenStreetMap</li>
          </ul>
        </section>

        <div className="columna">
          <div className="contadores">
            <Contador valor={cuenta.negocios} texto={cuenta.negocios === 1 ? 'negocio' : 'negocios'} color="verde" />
            <Contador valor={cuenta.proveedoresConNota} texto={cuenta.proveedoresConNota === 1 ? 'proveedor con nota' : 'proveedores con nota'} color="amarillo" />
            <Contador valor={cuenta.documentosSii} texto={cuenta.documentosSii === 1 ? 'documento en el SII' : 'documentos en el SII'} marca={<LogoSii />} />
          </div>
          <Ranking estado={estado} cambios={cambios} ahora={ahora} />
          <MiniLicitacion estado={estado} />
          <Feed estado={estado} eventos={eventos} ahora={ahora} />
        </div>
      </div>
    </main>
  );
}
