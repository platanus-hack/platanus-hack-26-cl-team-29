// /red-3d: "la red crece" sobre el mapa real de Santiago, en 3D. MapLibre pone las calles y los edificios con
// inclinación y giro; deck.gl, en un canvas encima con la misma cámara, dibuja los locales, los negocios, los
// proveedores y los arcos. Encima, pocas tarjetas efímeras (máximo tres) cuentan lo que pasa en cada punto, con el
// mismo texto e ícono que el feed de /red. Pantalla de presentación: no está en el menú.
// Los datos son los de /red y /mapa (useRed, useLocales): cada `red:evento` también se anima aquí.
// /red-3d#video: secuencia guionada con marcas ilustrativas, solo para grabar el video del pitch.
// /red-3d#recorrido: cámara automática y determinista para grabar. Sin hash: modo libre (arrastrar, girar, inclinar).

import { useEffect, useRef, useState } from 'react';
import type { Map as MapaLibre } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import './red3d.css';
import { CabeceraRed, Cargando } from '../components/Cabecera.tsx';
import { Monograma } from '../components/Iconos.tsx';
import { AMARILLO, AZUL_LOCAL, crearMapa, MAGENTA, ponerEdificios, VERDE } from '../mapa/base.ts';
import { Red3DVideo } from './Red3DVideo.tsx';
import {
  camara, capitulo, DURACION_HISTORIA, guion, historia, INICIO_LOCALES, relaciones, sumarTarjeta, VIDA_TARJETA,
  type NodoHistoria, type PasoGuion, type Tarjeta,
} from '../mapa/crece.ts';
import { pulsosNuevos, ubicar, type ClasePulso, type Punto } from '../mapa/geo.ts';
import { useLocales, type LocalMapa } from '../mapa/useLocales.ts';
import { describirEventoCorto, notaDe } from '../red/derivar.ts';
import type { EstadoRed, EventoRed } from '../red/tipos.ts';
import { useRed, type EventoVisto } from '../red/useRed.ts';
import { Contador, IconoEvento } from './RedEnVivo.tsx';
import { miles, nota } from '../../../shared/formato.ts';

type Color = [number, number, number, number];
const rgb = (hex: string): Color => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255) as Color;
const [C_VERDE, C_AMARILLO, C_MAGENTA, C_LOCAL, C_BLANCO] = [VERDE, AMARILLO, MAGENTA, AZUL_LOCAL, '#ffffff'].map(rgb);
const conAlfa = (c: Color, a: number): Color => [c[0], c[1], c[2], Math.round(255 * Math.min(1, Math.max(0, a)))];
const mezcla = (a: Color, b: Color, k: number): Color => a.map((x, i) => x + (b[i] - x) * k) as Color;

/** Si los locales no llegan (sin backend), la secuencia parte igual con la red sola. */
const ESPERA_LOCALES_MS = 2500;
/** Después de la secuencia, los locales que ilustraron la red vuelven a ser locales (azules) en este tiempo. */
const DISOLVER_MS = 2500;
const APARECER_MS = 1000;
/** Duración de cada animación del guion: venta 1,5 s, opinión 2 s, pedido 0,8 s (más lo que tarda en apagarse). */
const DURACION: Record<ClasePulso, number> = { venta: 1500, reclamo: 2000, pedido: 1400, nuevo: 1000, baja: 2400, sube: 2400 };
/** Etiquetas fijas: solo los proveedores con más compradores, para no tapar el mapa. */
const PROVEEDORES_CON_ETIQUETA = 3;

interface Animacion { tipo: ClasePulso; desde: Punto; hasta?: Punto; inicio: number }
interface Nodo { id: string; punto: Punto; aparece: number; ilustrativo: boolean }
interface Arco { desde: Punto; hasta: Punto; aparece: number; ilustrativo: boolean }
interface Proveedor { id: string; nombre: string; punto: Punto; conectados: number[]; aparece: number }
interface Escena { nodos: Nodo[]; arcos: Arco[]; proveedores: Proveedor[] }

/** Lo que se dibuja, con tiempos relativos al inicio de la secuencia. Los compradores que llegan después aparecen al llegar. */
function armarEscena(estado: EstadoRed, cuento: NodoHistoria[], apariciones: Map<string, number>): Escena {
  const donde = new Map(estado.negocios.map(n => [n.id, ubicar(n)]));
  const nodos: Nodo[] = cuento.map(n => ({ id: n.id, punto: n.punto, aparece: n.aparece, ilustrativo: n.ilustrativo }));
  for (const n of estado.negocios) {
    if (n.rol === 'comprador' && !cuento.some(c => c.id === n.id)) nodos.push({ id: n.id, punto: donde.get(n.id)!, aparece: apariciones.get(n.id) ?? 0, ilustrativo: false });
  }
  const cuandoAparece = new Map(nodos.map(n => [n.id, n.aparece]));
  const pares: Array<[string, string, boolean]> = [
    ...cuento.flatMap(n => n.proveedores.map(p => [n.id, p, n.ilustrativo] as [string, string, boolean])),
    ...relaciones(estado).filter(([c, p]) => !cuento.some(n => n.id === c && n.proveedores.includes(p))).map(([c, p]) => [c, p, false] as [string, string, boolean]),
  ];
  const puntoDe = (id: string) => nodos.find(n => n.id === id)?.punto ?? donde.get(id);
  const arcos = pares.flatMap(([c, p, ilustrativo]) => {
    const [desde, hasta] = [puntoDe(c), donde.get(p)];
    return desde && hasta ? [{ desde, hasta, aparece: cuandoAparece.get(c) ?? 0, ilustrativo }] : [];
  });
  const proveedores = estado.negocios.filter(n => n.rol === 'proveedor').map(p => {
    const conectados = pares.filter(([, x]) => x === p.id).map(([c]) => cuandoAparece.get(c) ?? 0);
    return { id: p.id, nombre: p.nombre, punto: donde.get(p.id)!, conectados, aparece: conectados.length ? Math.min(...conectados) : INICIO_LOCALES };
  });
  return { nodos, arcos, proveedores };
}

const entre = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
/** Rebote al aparecer: crece de golpe, se pasa un poco y vuelve. */
function rebote(edad: number): number {
  if (edad < 0) return 0;
  const k = Math.min(1, edad / APARECER_MS);
  return Math.min(1, k * 6) + 0.6 * Math.sin(Math.PI * k) * (1 - k);
}
/** Cuánto queda de un nodo o arco ilustrativo después de la secuencia (1 = entero, 0 = disuelto). */
const queda = (ilustrativo: boolean, t: number) => (ilustrativo ? 1 - entre(t, DURACION_HISTORIA, DURACION_HISTORIA + DISOLVER_MS) : 1);
const mismo = (a: Punto, b: Punto) => a[0] === b[0] && a[1] === b[1];
/** Si la nota de un proveedor se está moviendo ahora: 'baja', 'sube' o nada. */
const notaMoviendose = (p: Punto, animaciones: Animacion[]) => animaciones.find(a => (a.tipo === 'baja' || a.tipo === 'sube') && mismo(a.desde, p))?.tipo;

function capasDeck(escena: Escena, locales: LocalMapa[], animaciones: Animacion[], t: number, ahora: number, alElegir: (id: string) => void): Layer[] {
  const edad = (a: Animacion) => (ahora - a.inicio) / DURACION[a.tipo];
  const viajan = (tipo: ClasePulso) => animaciones.filter(a => a.tipo === tipo && a.hasta);
  return [
    new ScatterplotLayer<LocalMapa>({
      id: 'locales', data: locales, getPosition: l => [l.lng, l.lat], getFillColor: C_LOCAL,
      radiusUnits: 'pixels', getRadius: 1.3, opacity: 0.12 + 0.3 * entre(t, INICIO_LOCALES - 1000, INICIO_LOCALES + 1500),
    }),
    // La red de fondo: arcos finos y tenues. Solo el que tiene un evento se enciende (capas de abajo).
    new ArcLayer<Arco>({
      id: 'arcos', data: escena.arcos, getSourcePosition: a => a.desde, getTargetPosition: a => a.hasta,
      getSourceColor: a => conAlfa(C_VERDE, 0.18 * entre(t, a.aparece, a.aparece + APARECER_MS) * queda(a.ilustrativo, t)),
      getTargetColor: a => conAlfa(C_AMARILLO, 0.28 * entre(t, a.aparece, a.aparece + APARECER_MS) * queda(a.ilustrativo, t)),
      getWidth: 1, getHeight: 0.3, updateTriggers: { getSourceColor: t, getTargetColor: t },
    }),
    new ArcLayer<Animacion>({
      id: 'pedidos', data: viajan('pedido'), getSourcePosition: a => a.desde, getTargetPosition: a => a.hasta!,
      getSourceColor: a => conAlfa(C_AMARILLO, 1 - entre(edad(a), 0.55, 1)), getTargetColor: a => conAlfa(C_AMARILLO, 1 - entre(edad(a), 0.55, 1)),
      getWidth: 3, getHeight: 0.3, updateTriggers: { getSourceColor: ahora, getTargetColor: ahora },
    }),
    // La opinión viaja del negocio al proveedor como una fila de puntos magenta.
    new ScatterplotLayer<{ p: Punto; a: number }>({
      id: 'opiniones',
      data: viajan('reclamo').flatMap(a => [0, 0.07, 0.14, 0.21, 0.28].map(atraso => {
        const k = entre(edad(a), atraso, atraso + 0.6);
        return { p: [a.desde[0] + (a.hasta![0] - a.desde[0]) * k, a.desde[1] + (a.hasta![1] - a.desde[1]) * k] as Punto, a: k > 0 && k < 1 ? 1 : 0 };
      })),
      getPosition: d => d.p, getFillColor: d => conAlfa(C_MAGENTA, d.a), radiusUnits: 'pixels', getRadius: 3,
    }),
    new ScatterplotLayer<Proveedor>({
      id: 'proveedores', data: escena.proveedores, getPosition: p => p.punto,
      getRadius: p => entre(t, p.aparece, p.aparece + APARECER_MS) * (6 + 1.2 * Math.sqrt(p.conectados.filter(x => x <= t).length)),
      getFillColor: p => {
        const moviendo = notaMoviendose(p.punto, animaciones);
        return moviendo === 'baja' ? C_MAGENTA : moviendo === 'sube' ? C_VERDE : C_AMARILLO;
      },
      radiusUnits: 'pixels', stroked: true, getLineColor: [11, 11, 11, 255], lineWidthUnits: 'pixels', getLineWidth: 2,
      pickable: true, onClick: ({ object }) => { if (object) alElegir(object.id); },
      updateTriggers: { getRadius: t, getFillColor: ahora },
    }),
    new ScatterplotLayer<Nodo>({
      id: 'negocios', data: escena.nodos, getPosition: n => n.punto,
      getFillColor: n => mezcla(C_LOCAL, C_VERDE, queda(n.ilustrativo, t)),
      getRadius: n => (n.ilustrativo ? 1.5 + 2.5 * queda(true, t) : 4) * rebote(t - n.aparece),
      radiusUnits: 'pixels', stroked: true, getLineColor: [11, 11, 11, 255], lineWidthUnits: 'pixels', getLineWidth: 1,
      updateTriggers: { getFillColor: t, getRadius: t },
    }),
    new ScatterplotLayer<Animacion>({
      id: 'pulsos', data: animaciones.filter(a => a.tipo !== 'pedido'), getPosition: a => a.desde,
      stroked: true, filled: false, radiusUnits: 'pixels', lineWidthUnits: 'pixels', getLineWidth: 2,
      getRadius: a => 6 + 30 * Math.sqrt(Math.min(1, edad(a))),
      getLineColor: a => conAlfa(a.tipo === 'venta' ? C_BLANCO : a.tipo === 'reclamo' || a.tipo === 'baja' ? C_MAGENTA : C_VERDE, 1 - Math.min(1, edad(a))),
      updateTriggers: { getRadius: ahora, getLineColor: ahora },
    }),
  ];
}

interface Datos {
  estado: EstadoRed;
  locales: LocalMapa[];
  cuento: NodoHistoria[];
  pasos: PasoGuion[];
  /** performance.now() en que partió la secuencia; null mientras espera el mapa y los datos. */
  inicio: number | null;
  apariciones: Map<string, number>;
  escena: Escena;
  animaciones: Animacion[];
  /** Notas que la secuencia movió (solo mientras dura): la etiqueta del proveedor muestra la nueva. */
  notasGuion: Map<string, number>;
}

function Lienzo({ estado, eventos, locales, recorrido, alElegir, alAvanzar }: {
  estado: EstadoRed; eventos: EventoVisto[]; locales: LocalMapa[] | null; recorrido: boolean;
  alElegir: (id: string) => void; alAvanzar: (t: number, vistos: number) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const sobre = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLibre | null>(null);
  const [listo, setListo] = useState(false);
  const [esperaVencida, setEsperaVencida] = useState(false);
  const [t, setT] = useState(0);
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const vistos = useRef(new Set<number>());
  const claves = useRef(0);
  const datos = useRef<Datos>({ estado, locales: [], cuento: [], pasos: [], inicio: null, apariciones: new Map(), escena: { nodos: [], arcos: [], proveedores: [] }, animaciones: [], notasGuion: new Map() });
  const elegir = useRef(alElegir);
  const avanzar = useRef(alAvanzar);
  elegir.current = alElegir;
  avanzar.current = alAvanzar;

  const rearmar = () => {
    const d = datos.current;
    if (d.inicio === null) return;
    const ahora = performance.now() - d.inicio;
    for (const n of d.estado.negocios) if (!d.apariciones.has(n.id)) d.apariciones.set(n.id, ahora);
    d.escena = armarEscena(d.estado, d.cuento, d.apariciones);
  };

  /** Anima un evento donde pasó y le pone su tarjeta. `punto`: donde late; `proveedor`: hacia o desde dónde viaja. */
  const animar = (evento: EventoRed, clase: ClasePulso, punto: Punto, proveedor: Punto | undefined, conTarjeta: boolean) => {
    const inicio = performance.now();
    const d = datos.current;
    if (clase === 'pedido') {
      if (proveedor) d.animaciones.push({ tipo: 'pedido', desde: proveedor, hasta: punto, inicio });
    } else {
      d.animaciones.push({ tipo: clase, desde: punto, hasta: proveedor, inicio });
    }
    if (conTarjeta) setTarjetas(ts => sumarTarjeta(ts, { clave: String(claves.current++), evento, clase, punto, inicio }));
  };

  const pasoDelGuion = (paso: PasoGuion) => {
    const d = datos.current;
    const nodo = d.cuento[paso.nodo];
    const prov = d.estado.negocios.find(n => n.id === paso.proveedorId);
    const proveedor = prov && ubicar(prov);
    // La nota cambia en el proveedor: ahí late y ahí sale la tarjeta.
    const enProveedor = (paso.clase === 'baja' || paso.clase === 'sube') && prov && proveedor;
    if (enProveedor && typeof paso.evento.datos.nota === 'number') d.notasGuion.set(prov.id, paso.evento.datos.nota);
    if (nodo) animar(paso.evento, paso.clase, enProveedor ? proveedor : nodo.punto, enProveedor ? undefined : proveedor, true);
  };

  useEffect(() => {
    // Recorrido: parte a nivel de calle, junto a los edificios. Libre: Santiago inclinado, listo para explorar.
    const m = crearMapa(caja.current!, { ...camara(recorrido ? 0 : 8000), interactive: !recorrido, maxPitch: 80 }, ponerEdificios);
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    m.addControl(overlay);
    mapa.current = m;
    m.once('load', () => setListo(true));
    const espera = setTimeout(() => setEsperaVencida(true), ESPERA_LOCALES_MS);

    let cuadro = 0;
    let ultimoAviso = 0;
    const cuadroSiguiente = () => {
      const d = datos.current;
      const ahora = performance.now();
      const tt = d.inicio === null ? 0 : ahora - d.inicio;
      if (recorrido && d.inicio !== null) m.jumpTo(camara(tt, d.cuento[0]?.punto));
      while (d.inicio !== null && d.pasos.length && d.pasos[0].t <= tt) pasoDelGuion(d.pasos.shift()!);
      if (tt >= DURACION_HISTORIA) d.notasGuion.clear();
      d.animaciones = d.animaciones.filter(a => ahora - a.inicio < DURACION[a.tipo]);
      overlay.setProps({ layers: capasDeck(d.escena, d.locales, d.animaciones, tt, ahora, id => elegir.current(id)) });
      // Tarjetas y etiquetas siguen a su punto del mapa en cada cuadro.
      for (const el of Array.from(sobre.current?.children ?? []) as HTMLElement[]) {
        const p = m.project([Number(el.dataset.lng), Number(el.dataset.lat)]);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
      if (ahora - ultimoAviso > 200) {
        ultimoAviso = ahora;
        setT(tt);
        setTarjetas(ts => (ts.some(x => ahora - x.inicio >= VIDA_TARJETA) ? ts.filter(x => ahora - x.inicio < VIDA_TARJETA) : ts));
        avanzar.current(tt, d.escena.nodos.filter(n => n.aparece <= tt && (!n.ilustrativo || tt < DURACION_HISTORIA)).length);
      }
      cuadro = requestAnimationFrame(cuadroSiguiente);
    };
    cuadro = requestAnimationFrame(cuadroSiguiente);

    return () => {
      cancelAnimationFrame(cuadro);
      clearTimeout(espera);
      mapa.current = null;
      m.remove();
    };
  }, [recorrido]);

  // La secuencia parte cuando el mapa cargó y llegaron los locales (o se cansó de esperarlos). Queda fija desde ahí.
  useEffect(() => {
    const d = datos.current;
    if (d.inicio !== null || !listo || !(locales || esperaVencida)) return;
    d.cuento = historia(estado, locales ?? []);
    d.pasos = guion(d.cuento, estado);
    d.inicio = performance.now();
    rearmar();
  }, [listo, locales, esperaVencida, estado]);

  useEffect(() => {
    datos.current.estado = estado;
    rearmar();
  }, [estado]);

  useEffect(() => {
    datos.current.locales = locales ?? [];
  }, [locales]);

  // Cada evento nuevo de la red se anima una vez donde pasó, con su tarjeta ("se sumó" solo al entrar, no al cambiar el carrito).
  useEffect(() => {
    if (!mapa.current) return;
    for (const { evento: e, clase, negocio } of pulsosNuevos(eventos, vistos.current, estado, DURACION.reclamo)) {
      const orden = (e.datos.orden ?? {}) as { proveedorId?: unknown };
      const prov = typeof orden.proveedorId === 'string' ? estado.negocios.find(n => n.id === orden.proveedorId) : undefined;
      animar(e, clase, ubicar(negocio), prov && ubicar(prov), clase !== 'nuevo' || e.datos.accion === 'entra');
    }
  }, [eventos, estado]);

  const { escena, notasGuion, animaciones } = datos.current;
  const conectadosA = (p: Proveedor) => p.conectados.filter(x => x <= t).length;
  const etiquetados = escena.proveedores
    .filter(p => t >= p.aparece + APARECER_MS)
    .sort((a, b) => conectadosA(b) - conectadosA(a))
    .slice(0, PROVEEDORES_CON_ETIQUETA);
  const enPunto = (p: Punto) => ({ 'data-lng': p[0], 'data-lat': p[1] });

  return (
    <div className="r3d-lienzo">
      <div className="r3d-mapa" ref={caja} role="img" aria-label="Mapa 3D de Santiago con los negocios, los proveedores y sus compras" />
      <div className="r3d-sobre" ref={sobre}>
        {etiquetados.map(p => {
          const valor = notasGuion.get(p.id) ?? notaDe(estado, p.id);
          return (
            <div key={p.id} className="r3d-ancla" {...enPunto(p.punto)}>
              <button type="button" className={`r3d-proveedor ${notaMoviendose(p.punto, animaciones) ?? ''}`} onClick={() => elegir.current(p.id)}>
                <Monograma nombre={p.nombre} /><span>{p.nombre}</span>{valor !== undefined && <b>{nota(valor)}</b>}
              </button>
            </div>
          );
        })}
        {tarjetas.map(x => (
          <div key={x.clave} className="r3d-ancla" {...enPunto(x.punto)}>
            <div className={`r3d-evento ${x.clase}`}>
              <span className="feed-icono"><IconoEvento e={x.evento} estado={estado} /></span>
              <span>{describirEventoCorto(x.evento, estado)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ficha de un proveedor al hacer clic: su nota y cuántos compradores tiene, por comuna. Sin nombres de compradores. */
function FichaProveedor({ estado, id, alCerrar }: { estado: EstadoRed; id: string; alCerrar: () => void }) {
  const proveedor = estado.negocios.find(n => n.id === id);
  if (!proveedor) return null;
  const compradores = relaciones(estado).filter(([, p]) => p === id).map(([c]) => estado.negocios.find(n => n.id === c)!);
  const cuenta = new Map<string, number>();
  for (const c of compradores) cuenta.set(c.comuna, (cuenta.get(c.comuna) ?? 0) + 1);
  const porComuna = [...cuenta].sort((a, b) => b[1] - a[1]);
  const valor = notaDe(estado, id);
  return (
    <aside className="r3d-ficha tarjeta" aria-label={`Proveedor ${proveedor.nombre}`}>
      <button type="button" className="r3d-cerrar" onClick={alCerrar} aria-label="Cerrar">×</button>
      <h2><Monograma nombre={proveedor.nombre} logoUrl={proveedor.logoUrl} />{proveedor.nombre}</h2>
      <p className="r3d-nota"><b>{valor === undefined ? 'sin nota' : nota(valor)}</b> nota de la red</p>
      <p>{miles(compradores.length)} {compradores.length === 1 ? 'comprador' : 'compradores'} en la red</p>
      {porComuna.length > 0 && (
        <ul>{porComuna.slice(0, 5).map(([comuna, n]) => <li key={comuna}><span>{comuna}</span><b>{miles(n)}</b></li>)}</ul>
      )}
    </aside>
  );
}

/** #video: secuencia guionada para el video del pitch, sin la BD (ver Red3DVideo). */
export function Red3D() {
  return location.hash === '#video' ? <Red3DVideo /> : <Red3DRed />;
}

function Red3DRed() {
  const { estado, eventos, fuente } = useRed();
  const locales = useLocales();
  const [recorrido] = useState(() => location.hash === '#recorrido');
  const [elegido, setElegido] = useState<string | null>(null);
  const [avance, setAvance] = useState({ t: 0, vistos: 0 });
  if (!estado) return <Cargando />;

  const totalLocales = locales?.locales.length ?? 0;
  const enVivo = estado.negocios.filter(n => n.rol === 'comprador').length;
  const cap = capitulo(avance.t, avance.vistos, totalLocales) ?? { cifra: enVivo, texto: enVivo === 1 ? 'negocio en la red, en vivo' : 'negocios en la red, en vivo' };

  return (
    <main className="r3d">
      <Lienzo
        estado={estado} eventos={eventos} locales={locales?.locales ?? null} recorrido={recorrido}
        alElegir={setElegido} alAvanzar={(t, vistos) => setAvance(a => (a.vistos === vistos && Math.abs(a.t - t) < 150 ? a : { t, vistos }))}
      />
      <div className="r3d-arriba">
        <CabeceraRed titulo="La red crece" fuente={fuente} />
        {!recorrido && <p className="r3d-ayuda">Arrastra para mover · Ctrl + arrastrar para girar · clic en un proveedor</p>}
      </div>
      <div className="r3d-cifra" aria-live="polite"><Contador valor={cap.cifra} texto={cap.texto} color="verde" /></div>
      <ul className="r3d-leyenda" aria-label="Leyenda">
        <li><i className="punto verde" /> negocio</li>
        <li><i className="punto amarillo" /> proveedor</li>
        <li><i className="punto local" /> local real (OpenStreetMap)</li>
      </ul>
      {elegido && <FichaProveedor estado={estado} id={elegido} alCerrar={() => setElegido(null)} />}
    </main>
  );
}
