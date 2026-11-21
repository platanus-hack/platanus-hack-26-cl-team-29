// /red-3d#video: la red crece con proveedores conocidos, guionada y determinista, para grabar el video del pitch.
// No usa la BD ni useRed: negocios del catálogo de locales y marcas ilustrativas (ver mapa/video.ts).
// Mismo estilo que /red-3d#recorrido: mapa 3D, puntos verdes, estelas que se apagan, tarjetas efímeras y la cifra.

import { useEffect, useRef, useState } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import './red3d.css';
import { Icono, LogoSii, Monograma } from '../components/Iconos.tsx';
import { AMARILLO, AZUL_LOCAL, crearMapa, MAGENTA, ponerEdificios, VERDE } from '../mapa/base.ts';
import { MUT, type Punto } from '../mapa/geo.ts';
import {
  camaraVideo, capituloVideo, dejaEstela, guionVideo, negociosEn, negociosVideo, PROVEEDORES,
  type ClaseVideo, type LocalVideo, type NegocioVideo, type PasoVideo,
} from '../mapa/video.ts';
import { MAX_TARJETAS, VIDA_TARJETA } from '../mapa/crece.ts';
import { Contador } from './RedEnVivo.tsx';
import { nota } from '../../../shared/formato.ts';

type Color = [number, number, number, number];
const rgb = (hex: string): Color => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255) as Color;
const [C_VERDE, C_AMARILLO, C_MAGENTA, C_LOCAL, C_BLANCO] = [VERDE, AMARILLO, MAGENTA, AZUL_LOCAL, '#ffffff'].map(rgb);
const conAlfa = (c: Color, a: number): Color => [c[0], c[1], c[2], Math.round(255 * Math.min(1, Math.max(0, a)))];
const entre = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));

const VIDA_ESTELA = 1600;
const DURACION: Record<ClaseVideo, number> = { pedido: 1500, venta: 1500, reclamo: 2000, nuevo: 1100 };
/** Las etiquetas aparecen cuando el proveedor tiene su primer comprador y la cámara ya despegó del suelo. */
const ETIQUETAS_DESDE = 4500;

interface Tarjeta { clave: number; paso: PasoVideo; punto: Punto; inicio: number }
interface Animacion { clase: ClaseVideo; desde: Punto; hasta: Punto; inicio: number }

function capas(negocios: NegocioVideo[], fondo: LocalVideo[], animaciones: Animacion[], t: number) {
  const n = negociosEn(t, negocios.length);
  const visibles = negocios.slice(0, n);
  const estelas = visibles.filter((x, i) => t - x.aparece < VIDA_ESTELA && dejaEstela(i));
  const edad = (a: Animacion) => entre(t, a.inicio, a.inicio + DURACION[a.clase]);
  const cuantos = PROVEEDORES.map(() => 0);
  for (const x of visibles) cuantos[x.proveedor]++;
  const conectados = PROVEEDORES.map((p, i) => ({ p, c: cuantos[i] })).filter(x => x.c > 0);
  return [
    new ScatterplotLayer<LocalVideo>({
      id: 'locales', data: fondo, getPosition: l => [l[0], l[1]], getFillColor: C_LOCAL,
      radiusUnits: 'pixels', getRadius: 1.1, opacity: 0.08 + 0.17 * entre(t, 9000, 18_000),
    }),
    new ArcLayer<NegocioVideo>({
      id: 'estelas', data: estelas, getSourcePosition: x => PROVEEDORES[x.proveedor].punto, getTargetPosition: x => x.punto,
      getSourceColor: x => conAlfa(C_AMARILLO, 0.7 * (1 - (t - x.aparece) / VIDA_ESTELA)),
      getTargetColor: x => conAlfa(C_VERDE, 0.7 * (1 - (t - x.aparece) / VIDA_ESTELA)),
      getWidth: 1.5, getHeight: 0.35, updateTriggers: { getSourceColor: t, getTargetColor: t },
    }),
    new ArcLayer<Animacion>({
      id: 'pedidos', data: animaciones.filter(a => a.clase === 'pedido'), getSourcePosition: a => a.desde, getTargetPosition: a => a.hasta,
      getSourceColor: a => conAlfa(C_AMARILLO, 1 - entre(edad(a), 0.55, 1)), getTargetColor: a => conAlfa(C_AMARILLO, 1 - entre(edad(a), 0.55, 1)),
      getWidth: 3.5, getHeight: 0.35, updateTriggers: { getSourceColor: t, getTargetColor: t },
    }),
    new ScatterplotLayer<{ p: Punto; a: number }>({
      id: 'opiniones',
      data: animaciones.filter(a => a.clase === 'reclamo').flatMap(a => [0, 0.07, 0.14, 0.21, 0.28].map(atraso => {
        const k = entre(edad(a), atraso, atraso + 0.6);
        return { p: [a.desde[0] + (a.hasta[0] - a.desde[0]) * k, a.desde[1] + (a.hasta[1] - a.desde[1]) * k] as Punto, a: k > 0 && k < 1 ? 1 : 0 };
      })),
      getPosition: d => d.p, getFillColor: d => conAlfa(C_MAGENTA, d.a), radiusUnits: 'pixels', getRadius: 3.5,
    }),
    new ScatterplotLayer<NegocioVideo>({
      id: 'negocios', data: visibles, getPosition: x => x.punto, getFillColor: C_VERDE,
      // Al llegar se infla un instante; después queda chico, para que 2.000 no tapen el mapa.
      getRadius: x => (n < 60 ? 4 : 2.5) * (1 + 1.2 * (1 - entre(t, x.aparece, x.aparece + 700))),
      radiusUnits: 'pixels', opacity: 0.9, updateTriggers: { getRadius: t },
    }),
    // Brillo de cada proveedor: crece con sus compradores.
    new ScatterplotLayer<{ p: (typeof PROVEEDORES)[number]; c: number }>({
      id: 'brillo', data: conectados, getPosition: x => x.p.punto, radiusUnits: 'pixels',
      getRadius: x => 9 + 1.6 * Math.sqrt(x.c), getFillColor: x => conAlfa(C_AMARILLO, 0.08 + 0.1 * Math.min(1, x.c / 150)),
      updateTriggers: { getRadius: t, getFillColor: t },
    }),
    new ScatterplotLayer<{ p: (typeof PROVEEDORES)[number]; c: number }>({
      id: 'proveedores', data: conectados, getPosition: x => x.p.punto, radiusUnits: 'pixels',
      getRadius: x => 4.5 + 0.4 * Math.sqrt(x.c), getFillColor: C_AMARILLO,
      stroked: true, getLineColor: [11, 11, 11, 255], lineWidthUnits: 'pixels', getLineWidth: 2,
      updateTriggers: { getRadius: t },
    }),
    new ScatterplotLayer<Animacion>({
      id: 'pulsos', data: animaciones.filter(a => a.clase !== 'pedido'), getPosition: a => a.desde,
      stroked: true, filled: false, radiusUnits: 'pixels', lineWidthUnits: 'pixels', getLineWidth: 2,
      getRadius: a => 6 + 30 * Math.sqrt(edad(a)),
      getLineColor: a => conAlfa(a.clase === 'venta' ? C_BLANCO : a.clase === 'reclamo' ? C_MAGENTA : C_VERDE, 1 - edad(a)),
      updateTriggers: { getRadius: t, getLineColor: t },
    }),
  ];
}

function IconoPaso({ paso }: { paso: PasoVideo }) {
  if (paso.clase === 'venta') return <LogoSii />;
  if (paso.clase === 'nuevo') return <Icono nombre="tienda" />;
  if (paso.clase === 'reclamo') return <Icono nombre="nota" />;
  const p = PROVEEDORES[paso.proveedor];
  return <Monograma nombre={p.nombre} logoUrl={p.logo} />;
}

export function Red3DVideo() {
  const caja = useRef<HTMLDivElement>(null);
  const sobre = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [negocios, setNegocios] = useState<NegocioVideo[]>([]);

  useEffect(() => {
    let activo = true;
    let datos: { negocios: NegocioVideo[]; fondo: LocalVideo[] } | null = null;
    let cargado = false;
    let inicio: number | null = null;
    const pasos = guionVideo();
    let animaciones: Animacion[] = [];
    let clave = 0;

    const m = crearMapa(caja.current!, { ...camaraVideo(0), interactive: false, maxPitch: 80 }, ponerEdificios);
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    m.addControl(overlay);
    // Parte cuando el mapa terminó de cargar sus teselas (si no, los primeros cuadros se traban).
    m.once('idle', () => setTimeout(() => { cargado = true; }, 600));
    fetch('/video-locales.json').then(r => r.json()).then((locales: LocalVideo[]) => {
      if (!activo) return;
      datos = { negocios: negociosVideo(locales), fondo: locales };
      setNegocios(datos.negocios);
    });

    const ejecutar = (paso: PasoVideo, ahora: number) => {
      const negocio = datos!.negocios[paso.negocio].punto;
      const proveedor = paso.proveedor >= 0 ? PROVEEDORES[paso.proveedor].punto : negocio;
      const desde = paso.clase === 'pedido' ? proveedor : negocio;
      const hasta = paso.clase === 'pedido' ? negocio : proveedor;
      animaciones.push({ clase: paso.clase, desde, hasta, inicio: ahora });
      // La opinión se ancla en el proveedor (ahí cambia su nota); lo demás, en el negocio.
      const punto = paso.clase === 'reclamo' ? proveedor : negocio;
      setTarjetas(ts => [...ts.filter(x => ahora - x.inicio < VIDA_TARJETA), { clave: clave++, paso, punto, inicio: ahora }].slice(-MAX_TARJETAS));
    };

    let cuadro = 0;
    let ultimoAviso = 0;
    const cuadroSiguiente = () => {
      const ahora = performance.now();
      if (inicio === null && cargado && datos) {
        inicio = ahora;
        document.body.dataset.inicio = '1'; // el grabador recorta la espera de carga desde aquí
      }
      const tt = inicio === null ? 0 : ahora - inicio;
      if (datos) {
        m.jumpTo(camaraVideo(tt, datos.negocios[0]?.punto ?? MUT));
        while (inicio !== null && pasos.length && pasos[0].t <= tt) ejecutar(pasos.shift()!, tt);
        animaciones = animaciones.filter(a => tt - a.inicio < DURACION[a.clase]);
        overlay.setProps({ layers: capas(datos.negocios, datos.fondo, animaciones, tt) });
      }
      const alto = caja.current?.clientHeight ?? 1080;
      const ancho = caja.current?.clientWidth ?? 1920;
      const etiquetas: DOMRect[] = [];
      for (const el of Array.from(sobre.current?.children ?? []) as HTMLElement[]) {
        const p = m.project([Number(el.dataset.lng), Number(el.dataset.lat)]);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        if (el.dataset.tarjeta) continue;
        // Cerca del horizonte, fuera de la toma o detrás de la cifra, la etiqueta se esconde.
        const dentro = p.x > 20 && p.x < ancho - 20 && p.y > alto * 0.2 && p.y < alto - 40 && !(p.x < 620 && p.y > alto - 230);
        el.style.visibility = dentro ? 'visible' : 'hidden';
        const caja = el.firstElementChild?.getBoundingClientRect();
        if (dentro && caja) etiquetas.push(caja);
      }
      // Una tarjeta que cae encima de una etiqueta sube hasta quedar libre.
      for (const el of Array.from(sobre.current?.querySelectorAll<HTMLElement>('[data-tarjeta] > .r3d-evento') ?? [])) {
        el.style.marginBottom = '0px';
        for (let sube = 0; sube < 12; sube++) {
          const r = el.getBoundingClientRect();
          if (!etiquetas.some(e => r.left < e.right && r.right > e.left && r.top < e.bottom + 4 && r.bottom > e.top - 4)) break;
          el.style.marginBottom = `${(sube + 1) * 16}px`;
        }
      }
      if (ahora - ultimoAviso > 120) {
        ultimoAviso = ahora;
        setT(tt);
        setTarjetas(ts => (ts.some(x => tt - x.inicio >= VIDA_TARJETA) ? ts.filter(x => tt - x.inicio < VIDA_TARJETA) : ts));
      }
      cuadro = requestAnimationFrame(cuadroSiguiente);
    };
    cuadro = requestAnimationFrame(cuadroSiguiente);
    return () => {
      activo = false;
      cancelAnimationFrame(cuadro);
      m.remove();
    };
  }, []);

  const n = negociosEn(t, negocios.length || 1);
  const cuantos = PROVEEDORES.map(() => 0);
  for (const x of negocios.slice(0, n)) cuantos[x.proveedor]++;
  const enPunto = (p: Punto) => ({ 'data-lng': p[0], 'data-lat': p[1] });

  return (
    <main className="r3d r3d-video">
      <div className="r3d-lienzo">
        <div className="r3d-mapa" ref={caja} role="img" aria-label="Mapa 3D de Santiago: la red de compras crece" />
        <div className="r3d-sobre" ref={sobre}>
          {t >= ETIQUETAS_DESDE && PROVEEDORES.map((p, i) => cuantos[i] > 0 && (
            <div key={p.id} className="r3d-ancla" {...enPunto(p.punto)}>
              <div className={`r3d-marca ${p.izquierda ? 'izquierda' : ''}`}>
                {p.logo ? <span className="r3d-logo"><img src={p.logo} alt={p.nombre} /></span> : <><Monograma nombre={p.nombre} /><span>{p.nombre}</span></>}
                <b>{nota(p.nota)}</b>
              </div>
            </div>
          ))}
          {tarjetas.map(x => (
            <div key={x.clave} className="r3d-ancla" data-tarjeta="1" {...enPunto(x.punto)}>
              <div className={`r3d-evento ${x.paso.clase}`}>
                <span className="feed-icono"><IconoPaso paso={x.paso} /></span>
                <span>{x.paso.texto}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="r3d-arriba">
        <header className="red-cabecera">
          <div className="marca" aria-hidden>B</div>
          <h1 className="titulo-red">La red crece</h1>
        </header>
      </div>
      <div className="r3d-cifra" aria-live="polite"><Contador valor={n} texto={capituloVideo(n)} color="verde" /></div>
      <ul className="r3d-leyenda" aria-label="Leyenda">
        <li><i className="punto verde" /> negocio</li>
        <li><i className="punto amarillo" /> proveedor</li>
        <li><i className="punto local" /> local real (OpenStreetMap)</li>
      </ul>
      <p className="r3d-aviso">Simulación ilustrativa</p>
    </main>
  );
}
