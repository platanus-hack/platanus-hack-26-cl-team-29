// /mapa: la red sobre un mapa real de Santiago, 30 km alrededor del MUT.
// Los datos son los mismos de /red (useRed): cada `red:evento` mueve el mapa y el panel a la vez.

import { useEffect, useRef, useState } from 'react';
import { Marker, type GeoJSONSource, type Map as MapaLibre } from 'maplibre-gl';
import './mapa.css';
import { CabeceraRed, Cargando } from '../components/Cabecera.tsx';
import { crear, crearMapa, paleta, pintar, useMapaConTema } from '../mapa/base.ts';
import { capas, circulo, MUT, pulsosNuevos, RADIO_KM, ubicar } from '../mapa/geo.ts';
import { FichaMercadoPublico, radioProveedorMp, useProveedoresMapa, type ProveedorMapa } from '../mapa/ProveedoresMapa.tsx';
import { contornoDeCelda, puntosDeLocales, useLocales, type Locales } from '../mapa/useLocales.ts';
import { notaDe, type CambioNota } from '../red/derivar.ts';
import { miles, nota } from '../../../shared/formato.ts';
import type { EstadoRed } from '../red/tipos.ts';
import { useAhora, useRed, type EventoVisto } from '../red/useRed.ts';
import { Contadores, Feed, MiniLicitacion, Ranking } from './RedEnVivo.tsx';

const DURACION_PULSO = 2400;

function agregarCapas(m: MapaLibre) {
  const vacio = { type: 'FeatureCollection' as const, features: [] };
  m.addSource('radio', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circulo(MUT, RADIO_KM) } } });
  m.addSource('lineas', { type: 'geojson', data: vacio });
  m.addSource('negocios', { type: 'geojson', data: vacio });
  m.addSource('locales', { type: 'geojson', data: vacio });
  m.addSource('buscando', { type: 'geojson', data: vacio });
  m.addSource('mercado-publico', { type: 'geojson', data: vacio });
  m.addLayer({ id: 'radio', type: 'line', source: 'radio', paint: { 'line-width': 1.5, 'line-opacity': 0.8, 'line-dasharray': [3, 3] } });
  // Locales que encontró el explorador: debajo de la red, tenues, para que la red mande.
  m.addLayer({ id: 'locales', type: 'circle', source: 'locales', paint: { 'circle-radius': 2, 'circle-opacity': 0.3 } });
  m.addLayer({ id: 'buscando', type: 'line', source: 'buscando', paint: { 'line-width': 1.5, 'line-dasharray': [1, 1] } });
  // Proveedores de Mercado Público que no están en Bando: oliva atenuado con contorno, bajo la red.
  m.addLayer({
    id: 'mercado-publico', type: 'circle', source: 'mercado-publico',
    paint: { 'circle-radius': ['get', 'radio'], 'circle-opacity': 0.2, 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.8 },
  });
  m.addLayer({
    id: 'lineas', type: 'line', source: 'lineas', filter: ['!=', ['get', 'tipo'], 'reclamo'],
    paint: { 'line-width': ['match', ['get', 'tipo'], 'actual', 3, 1], 'line-opacity': ['match', ['get', 'tipo'], 'actual', 1, 0.35] },
  });
  m.addLayer({ id: 'lineas-reclamo', type: 'line', source: 'lineas', filter: ['==', ['get', 'tipo'], 'reclamo'], paint: { 'line-width': 3, 'line-dasharray': [2, 2] } });
  m.addLayer({
    id: 'negocios', type: 'circle', source: 'negocios',
    paint: { 'circle-radius': ['match', ['get', 'rol'], 'proveedor', 8, 5], 'circle-stroke-width': ['match', ['get', 'rol'], 'proveedor', 2, 1] },
  });
  colorearCapas(m);
}

/** Colores de la red con la paleta del modo actual: negocios en miel, proveedores y red en oliva, reclamos en rojo. */
function colorearCapas(m: MapaLibre) {
  if (!m.getLayer('negocios')) return;
  const c = paleta(m.getContainer());
  const colores: Record<string, Record<string, unknown>> = {
    radio: { 'line-color': c.miel600 },
    locales: { 'circle-color': c.rotulo },
    buscando: { 'line-color': c.rotulo },
    'mercado-publico': { 'circle-color': c.oliva, 'circle-stroke-color': c.oliva },
    lineas: { 'line-color': ['match', ['get', 'tipo'], 'actual', c.miel, c.oliva] },
    'lineas-reclamo': { 'line-color': c.error },
    negocios: {
      'circle-color': ['case', ['==', ['get', 'cambio'], 'baja'], c.error, ['==', ['get', 'rol'], 'proveedor'], c.oliva, c.miel],
      'circle-stroke-color': c.fondo,
    },
  };
  for (const [capa, pintura] of Object.entries(colores)) pintar(m, capa, pintura);
}

/** Un punto por proveedor de Mercado Público, con su radio según los organismos que le compran. */
const puntosMp = (mp: ProveedorMapa[]): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: mp.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.punto }, properties: { clave: p.clave, radio: radioProveedorMp(p.organismos) } })),
});

function Lienzo({ estado, cambios, eventos, locales, mp, alElegirMp }: {
  estado: EstadoRed; cambios: CambioNota[]; eventos: EventoVisto[]; locales: Locales | null; mp: ProveedorMapa[]; alElegirMp: (clave: string) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLibre | null>(null);
  const etiquetas = useRef(new Map<string, Marker>());
  const vistos = useRef(new Set<number>());
  const datos = useRef(capas(estado, cambios));
  const exploracion = useRef(locales);
  const mercadoPublico = useRef(mp);
  const elegirMp = useRef(alElegirMp);
  elegirMp.current = alElegirMp;

  const pintar = () => {
    const m = mapa.current;
    if (!m?.getSource('negocios')) return;
    (m.getSource('negocios') as GeoJSONSource).setData(datos.current.negocios);
    (m.getSource('lineas') as GeoJSONSource).setData(datos.current.lineas);
    (m.getSource('locales') as GeoJSONSource).setData(puntosDeLocales(exploracion.current?.locales ?? []));
    (m.getSource('buscando') as GeoJSONSource).setData(contornoDeCelda(exploracion.current?.avance.buscando ?? null));
    (m.getSource('mercado-publico') as GeoJSONSource).setData(puntosMp(mercadoPublico.current));
  };

  useMapaConTema(mapa, () => mapa.current && colorearCapas(mapa.current));

  useEffect(() => {
    const m = crearMapa(caja.current!, { center: MUT, zoom: 10 }, () => {
      agregarCapas(m);
      pintar();
    });
    mapa.current = m;
    m.on('click', 'mercado-publico', e => {
      const clave = e.features?.[0]?.properties?.clave;
      if (typeof clave === 'string') elegirMp.current(clave);
    });
    m.on('mouseenter', 'mercado-publico', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'mercado-publico', () => { m.getCanvas().style.cursor = ''; });
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

  // Proveedores de Mercado Público: se repintan cuando llega la lista nueva (cada `red:evento`).
  useEffect(() => {
    mercadoPublico.current = mp;
    pintar();
  }, [mp]);

  // Cada evento nuevo late una vez en el negocio donde pasó.
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    for (const { clase, negocio } of pulsosNuevos(eventos, vistos.current, estado, DURACION_PULSO)) {
      const marcador = new Marker({ element: crear(`mapa-pulso ${clase}`) }).setLngLat(ubicar(negocio)).addTo(m);
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
  const mp = useProveedoresMapa(eventos[0]?.clave);
  const [elegido, setElegido] = useState<string | null>(null);
  if (!estado) return <Cargando />;
  const proveedorMp = mp.find(p => p.clave === elegido);

  return (
    <main className="bando-ui pagina proyeccion red mapa-vista">
      <CabeceraRed titulo="La red en el mapa" fuente={fuente} />

      <div className="red-cuerpo">
        <section className="mapa-zona">
          <div className="mapa-caja">
            <Lienzo estado={estado} cambios={cambios} eventos={eventos} locales={locales} mp={mp} alElegirMp={setElegido} />
            {proveedorMp && <FichaMercadoPublico proveedor={proveedorMp} alCerrar={() => setElegido(null)} />}
          </div>
          {/* Leyenda y avance bajo el mapa: así no tapan etiquetas ni se tapan entre ellas en ningún tamaño. */}
          <div className="mapa-pie">
            {locales && <AvisoExploracion locales={locales} />}
            <ul className="mapa-leyenda" aria-label="Leyenda">
              <li><i className="punto negocio" /> negocio</li>
              <li><i className="punto proveedor" /> proveedor en Bando</li>
              {mp.length > 0 && <li><i className="punto mp" /> proveedor de Mercado Público</li>}
              {locales && <li><i className="punto local" /> local cercano</li>}
              <li><i className="raya pedido" /> último pedido</li>
              <li><i className="raya reclamo" /> reclamo</li>
              <li><i className="raya radio" /> {RADIO_KM} km desde el MUT</li>
              <li className="credito">mapa © OpenStreetMap</li>
            </ul>
          </div>
        </section>

        {/* El panel de /red aún usa la interfaz anterior: el puente le da los colores de la marca (DESIGN.md). */}
        <div className="columna puente-legado">
          <Contadores estado={estado} />
          <Ranking estado={estado} cambios={cambios} ahora={ahora} />
          <MiniLicitacion estado={estado} />
          <Feed estado={estado} eventos={eventos} ahora={ahora} />
        </div>
      </div>
    </main>
  );
}
