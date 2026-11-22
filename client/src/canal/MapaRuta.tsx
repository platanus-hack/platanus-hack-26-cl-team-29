// Mapa de la ruta de reparto (MapLibre, el mismo arranque de /mapa): la línea de la ruta, la bodega y una parada
// numerada por negocio en el orden de visita. Se carga aparte (lazy) para no sumar MapLibre al resto del panel.

import { useEffect, useRef } from 'react';
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MapaLibre } from 'maplibre-gl';
import { crear, crearMapa, paleta, pintar, useMapaConTema } from '../mapa/base.ts';
import type { RutaReparto } from '../../../shared/ruta.ts';

const lineaDe = (ruta: RutaReparto): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ruta.geometria },
});

function encuadrar(m: MapaLibre, ruta: RutaReparto) {
  m.resize();
  const caja = new LngLatBounds(ruta.bodega.punto, ruta.bodega.punto);
  for (const p of ruta.paradas) caja.extend(p.punto);
  for (const p of ruta.geometria) caja.extend(p);
  m.fitBounds(caja, { padding: 36, maxZoom: 15, duration: 0 });
}

/** La ruta en miel con borde miel oscuro, leídos de los tokens: cambian solos con el modo claro u oscuro. */
function pintarRuta(m: MapaLibre) {
  if (!m.getLayer('ruta')) return;
  const p = paleta(m.getContainer());
  pintar(m, 'ruta-borde', { 'line-color': p.miel600 });
  pintar(m, 'ruta', { 'line-color': p.miel });
}

export default function MapaRuta({ ruta }: { ruta: RutaReparto }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLibre | null>(null);
  const cargado = useRef(false);
  const actual = useRef(ruta);
  actual.current = ruta;

  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const m = crearMapa(el, { center: ruta.bodega.punto, zoom: 11, dragRotate: false, pitchWithRotate: false }, mm => {
      // Cada estilo nuevo borra las capas: se vuelven a poner con la ruta vigente.
      mm.addSource('ruta', { type: 'geojson', data: lineaDe(actual.current) });
      mm.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': 7 } });
      mm.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': 4 } });
      pintarRuta(mm);
    });
    m.scrollZoom.disable();
    m.once('load', () => { cargado.current = true; encuadrar(m, actual.current); });
    mapa.current = m;
    return () => { m.remove(); mapa.current = null; };
    // El mapa se crea una vez; la ruta se actualiza en el efecto de abajo.
  }, []);
  useMapaConTema(mapa, () => { if (mapa.current) pintarRuta(mapa.current); });

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    (m.getSource('ruta') as GeoJSONSource | undefined)?.setData(lineaDe(ruta));
    const marcadores = [
      new Marker({ element: crear('bp-ruta-bodega', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10 12 4l9 6v10H3z"/><path d="M8 20v-6h8v6"/></svg>') }).setLngLat(ruta.bodega.punto),
      ...ruta.paradas.map(p => {
        const el = crear('bp-ruta-parada', String(p.orden));
        el.title = p.nombre;
        return new Marker({ element: el }).setLngLat(p.punto);
      }),
    ];
    marcadores.forEach(x => x.addTo(m));
    // `loaded()` vuelve a ser falso mientras bajan teselas: se encuadra apenas el mapa cargó una vez.
    if (cargado.current) encuadrar(m, ruta);
    return () => marcadores.forEach(x => x.remove());
  }, [ruta]);

  return <div ref={contenedor} className="bp-ruta-mapa" role="img" aria-label={`Mapa de la ruta con ${ruta.paradas.length} paradas`} />;
}
