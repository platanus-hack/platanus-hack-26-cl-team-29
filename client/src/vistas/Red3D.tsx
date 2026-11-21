// /red-3d: "la red crece" sobre el mapa real de Santiago, en 3D. MapLibre pone las calles con inclinación y giro;
// deck.gl, intercalado en el mismo WebGL, dibuja los locales, los negocios, las columnas de los proveedores y los arcos.
// Los datos son los de /red y /mapa (useRed, useLocales): cada `red:evento` también se anima aquí.
// /red-3d#recorrido: cámara automática y determinista para grabar. Sin hash: modo libre (arrastrar, girar, inclinar).

import { useEffect, useRef, useState } from 'react';
import { Marker, type Map as MapaLibre } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ArcLayer, ColumnLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import './red3d.css';
import { AvisoFuente, Cargando } from '../components/Cabecera.tsx';
import { AMARILLO, AZUL_LOCAL, crear, crearMapa, MAGENTA, VERDE } from '../mapa/base.ts';
import { camara, capitulo, DURACION_HISTORIA, historia, INICIO_LOCALES, relaciones, type NodoHistoria } from '../mapa/crece.ts';
import { MUT, pulsosNuevos, ubicar, type Punto } from '../mapa/geo.ts';
import { useLocales, type LocalMapa } from '../mapa/useLocales.ts';
import { notaDe, type CambioNota } from '../red/derivar.ts';
import type { EstadoRed } from '../red/tipos.ts';
import { useRed, type EventoVisto } from '../red/useRed.ts';
import { dinero, miles, nota } from '../../../shared/formato.ts';

type Color = [number, number, number, number];
const rgb = (hex: string, a = 255): Color => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(a) as Color;
const [C_VERDE, C_AMARILLO, C_MAGENTA, C_LOCAL, C_BLANCO] = [VERDE, AMARILLO, MAGENTA, AZUL_LOCAL, '#ffffff'].map(c => rgb(c));
const conAlfa = (c: Color, a: number): Color => [c[0], c[1], c[2], Math.round(255 * Math.min(1, Math.max(0, a)))];
const mezcla = (a: Color, b: Color, k: number): Color => a.map((x, i) => x + (b[i] - x) * k) as Color;

/** Si los locales no llegan (sin backend), la secuencia parte igual con la red sola. */
const ESPERA_LOCALES_MS = 2500;
/** Después de la secuencia, los locales que ilustraron la red vuelven a ser locales (azules) en este tiempo. */
const DISOLVER_MS = 2500;
const APARECER_MS = 1000;
/** Duración de cada animación del guion: venta 1,5 s, opinión 2 s, pedido 0,8 s (más lo que tarda en apagarse). */
const DURACION: Record<Animacion['tipo'], number> = { venta: 1500, reclamo: 2000, pedido: 2000, nuevo: 1200, baja: 2000, sube: 2000 };
const MUESTRA_NOTA_DESDE = 8000;

interface Animacion {
  tipo: 'venta' | 'reclamo' | 'pedido' | 'nuevo' | 'baja' | 'sube';
  desde: Punto;
  hasta?: Punto;
  inicio: number;
}

interface Nodo { id: string; punto: Punto; aparece: number; ilustrativo: boolean }
interface Arco { desde: Punto; hasta: Punto; aparece: number; ilustrativo: boolean }
interface Proveedor { id: string; nombre: string; punto: Punto; conectados: number[]; aparece: number; cambio: CambioNota | undefined }
interface Escena { nodos: Nodo[]; arcos: Arco[]; proveedores: Proveedor[] }

/** Lo que se dibuja, con tiempos relativos al inicio de la secuencia. Los compradores que llegan después aparecen al llegar. */
function armarEscena(estado: EstadoRed, cuento: NodoHistoria[], apariciones: Map<string, number>, cambios: CambioNota[]): Escena {
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
    return {
      id: p.id, nombre: p.nombre, punto: donde.get(p.id)!, conectados,
      aparece: conectados.length ? Math.min(...conectados) : INICIO_LOCALES,
      cambio: cambios.find(c => c.proveedorId === p.id),
    };
  });
  return { nodos, arcos, proveedores };
}

const entre = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
/** Rebote al aparecer: crece de golpe, se pasa un poco y vuelve. */
function rebote(edad: number): number {
  if (edad < 0) return 0;
  const k = Math.min(1, edad / APARECER_MS);
  return Math.min(1, k * 6) + 0.8 * Math.sin(Math.PI * k) * (1 - k);
}
/** Cuánto queda de un nodo o arco ilustrativo después de la secuencia (1 = entero, 0 = disuelto). */
const queda = (ilustrativo: boolean, t: number) => (ilustrativo ? 1 - entre(t, DURACION_HISTORIA, DURACION_HISTORIA + DISOLVER_MS) : 1);

function capasDeck(escena: Escena, locales: LocalMapa[], animaciones: Animacion[], t: number, ahora: number, alElegir: (id: string) => void): Layer[] {
  const vivas = (tipo: Animacion['tipo']) => animaciones.filter(a => a.tipo === tipo);
  const edad = (a: Animacion) => (ahora - a.inicio) / DURACION[a.tipo];
  return [
    new ScatterplotLayer<LocalMapa>({
      id: 'locales', data: locales, getPosition: l => [l.lng, l.lat], getFillColor: C_LOCAL,
      radiusUnits: 'pixels', getRadius: 1.6, opacity: 0.22 + 0.4 * entre(t, INICIO_LOCALES - 1000, INICIO_LOCALES + 1500),
    }),
    new ArcLayer<Arco>({
      id: 'arcos', data: escena.arcos, getSourcePosition: a => a.desde, getTargetPosition: a => a.hasta,
      getSourceColor: a => conAlfa(C_VERDE, 0.55 * entre(t, a.aparece, a.aparece + APARECER_MS) * queda(a.ilustrativo, t)),
      getTargetColor: a => conAlfa(C_AMARILLO, 0.7 * entre(t, a.aparece, a.aparece + APARECER_MS) * queda(a.ilustrativo, t)),
      getWidth: 1.4, getHeight: 0.35, updateTriggers: { getSourceColor: t, getTargetColor: t },
    }),
    new ArcLayer<Animacion>({
      id: 'pedidos', data: vivas('pedido'), getSourcePosition: a => a.desde, getTargetPosition: a => a.hasta!,
      getSourceColor: a => conAlfa(C_AMARILLO, 1 - entre(edad(a), 0.4, 1)), getTargetColor: a => conAlfa(C_AMARILLO, 1 - entre(edad(a), 0.4, 1)),
      getWidth: 4, getHeight: 0.6, updateTriggers: { getSourceColor: ahora, getTargetColor: ahora },
    }),
    new ArcLayer<Animacion>({
      id: 'opiniones', data: vivas('reclamo').filter(a => a.hasta), getSourcePosition: a => a.desde, getTargetPosition: a => a.hasta!,
      getSourceColor: a => conAlfa(C_MAGENTA, 1 - entre(edad(a), 0.6, 1)), getTargetColor: a => conAlfa(C_MAGENTA, 1 - entre(edad(a), 0.6, 1)),
      getWidth: 2, getHeight: 0.35, updateTriggers: { getSourceColor: ahora, getTargetColor: ahora },
    }),
    // La opinión viaja del negocio al proveedor como una fila de puntos.
    new ScatterplotLayer<{ p: Punto; a: number }>({
      id: 'opiniones-viajan',
      data: vivas('reclamo').filter(a => a.hasta).flatMap(a => [0, 0.08, 0.16, 0.24].map(atraso => {
        const k = entre(edad(a), atraso, atraso + 0.6);
        return { p: [a.desde[0] + (a.hasta![0] - a.desde[0]) * k, a.desde[1] + (a.hasta![1] - a.desde[1]) * k] as Punto, a: k > 0 && k < 1 ? 1 : 0 };
      })),
      getPosition: d => d.p, getFillColor: d => conAlfa(C_MAGENTA, d.a), radiusUnits: 'pixels', getRadius: 3.5,
    }),
    new ColumnLayer<Proveedor>({
      id: 'proveedores', data: escena.proveedores, getPosition: p => p.punto, diskResolution: 4, radius: 260, angle: 45, extruded: true,
      getElevation: p => {
        const n = p.conectados.filter(x => x <= t).length;
        return entre(t, p.aparece, p.aparece + APARECER_MS) * (500 + 900 * Math.sqrt(n));
      },
      getFillColor: p => {
        const visible = entre(t, p.aparece, p.aparece + APARECER_MS);
        const c = !p.cambio ? C_AMARILLO : p.cambio.nota < p.cambio.anterior ? C_MAGENTA : C_VERDE;
        return conAlfa(c, 0.92 * visible);
      },
      material: { ambient: 0.6, diffuse: 0.5, shininess: 16 },
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 90],
      onClick: ({ object }) => { if (object) alElegir(object.id); },
      updateTriggers: { getElevation: t, getFillColor: [t, escena.proveedores.map(p => p.cambio?.en ?? 0).join()] },
    }),
    new ScatterplotLayer<Nodo>({
      id: 'negocios', data: escena.nodos, getPosition: n => n.punto,
      getFillColor: n => mezcla(C_LOCAL, C_VERDE, queda(n.ilustrativo, t)),
      getRadius: n => (n.ilustrativo ? 2 + 3.5 * queda(true, t) : 5.5) * rebote(t - n.aparece),
      radiusUnits: 'pixels', stroked: true, getLineColor: [11, 11, 11, 255], lineWidthUnits: 'pixels', getLineWidth: 1,
      updateTriggers: { getFillColor: t, getRadius: t },
    }),
    new ScatterplotLayer<Animacion>({
      id: 'pulsos', data: animaciones.filter(a => a.tipo !== 'pedido'), getPosition: a => a.desde,
      stroked: true, filled: false, radiusUnits: 'pixels', lineWidthUnits: 'pixels', getLineWidth: 3,
      getRadius: a => 6 + 42 * Math.sqrt(Math.min(1, edad(a))),
      getLineColor: a => conAlfa(a.tipo === 'venta' ? C_BLANCO : a.tipo === 'reclamo' || a.tipo === 'baja' ? C_MAGENTA : C_VERDE, 1 - Math.min(1, edad(a))),
      updateTriggers: { getRadius: ahora, getLineColor: ahora },
    }),
  ];
}

/** Nota que muestra la etiqueta: si cambió hace poco, baja (o sube) de la anterior a la nueva en 2 s. */
function notaVisible(p: Proveedor, estado: EstadoRed): string {
  const valor = notaDe(estado, p.id);
  if (!p.cambio) return valor === undefined ? '' : nota(valor);
  const k = entre(Date.now(), p.cambio.en, p.cambio.en + DURACION.baja);
  return nota(p.cambio.anterior + (p.cambio.nota - p.cambio.anterior) * k);
}

interface Datos {
  estado: EstadoRed | null;
  cambios: CambioNota[];
  locales: LocalMapa[];
  cuento: NodoHistoria[];
  /** performance.now() en que partió la secuencia; null mientras espera el mapa y los datos. */
  inicio: number | null;
  apariciones: Map<string, number>;
  escena: Escena;
  animaciones: Animacion[];
}

function Lienzo({ estado, cambios, eventos, locales, recorrido, alElegir, alAvanzar }: {
  estado: EstadoRed; cambios: CambioNota[]; eventos: EventoVisto[]; locales: LocalMapa[] | null; recorrido: boolean;
  alElegir: (id: string) => void; alAvanzar: (t: number, vistos: number) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLibre | null>(null);
  const [listo, setListo] = useState(false);
  const [esperaVencida, setEsperaVencida] = useState(false);
  const etiquetas = useRef(new Map<string, Marker>());
  const vistos = useRef(new Set<number>());
  const datos = useRef<Datos>({ estado, cambios, locales: [], cuento: [], inicio: null, apariciones: new Map(), escena: { nodos: [], arcos: [], proveedores: [] }, animaciones: [] });
  const elegir = useRef(alElegir);
  const avanzar = useRef(alAvanzar);
  elegir.current = alElegir;
  avanzar.current = alAvanzar;

  const rearmar = () => {
    const d = datos.current;
    if (!d.estado || d.inicio === null) return;
    const t = performance.now() - d.inicio;
    for (const n of d.estado.negocios) if (!d.apariciones.has(n.id)) d.apariciones.set(n.id, t);
    d.escena = armarEscena(d.estado, d.cuento, d.apariciones, d.cambios);
    ponerEtiquetas();
  };

  const ponerEtiquetas = () => {
    const m = mapa.current;
    if (!m) return;
    const { proveedores } = datos.current.escena;
    for (const [id, marcador] of etiquetas.current) {
      if (proveedores.some(p => p.id === id)) continue;
      marcador.remove();
      etiquetas.current.delete(id);
    }
    for (const p of proveedores) {
      if (etiquetas.current.has(p.id)) continue;
      const el = crear('r3d-proveedor oculto', '<span></span><b></b>');
      el.querySelector('span')!.textContent = p.nombre;
      el.addEventListener('click', () => elegir.current(p.id));
      etiquetas.current.set(p.id, new Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat(p.punto).addTo(m));
    }
  };

  /** Cada cuadro: visibilidad, color y nota de las etiquetas de los proveedores. */
  const pintarEtiquetas = (t: number) => {
    const d = datos.current;
    if (!d.estado) return;
    for (const p of d.escena.proveedores) {
      const el = etiquetas.current.get(p.id)?.getElement();
      if (!el) continue;
      el.classList.toggle('oculto', t < p.aparece);
      el.classList.toggle('baja', !!p.cambio && p.cambio.nota < p.cambio.anterior);
      el.classList.toggle('sube', !!p.cambio && p.cambio.nota > p.cambio.anterior);
      const texto = t >= MUESTRA_NOTA_DESDE ? notaVisible(p, d.estado) : '';
      const b = el.querySelector('b')!;
      if (b.textContent !== texto) b.textContent = texto;
    }
  };

  useEffect(() => {
    // Recorrido: parte de cerca, sobre el MUT. Libre: Santiago inclinado, listo para explorar.
    const inicial = camara(recorrido ? 0 : 8000, MUT);
    const m = crearMapa(caja.current!, { ...inicial, interactive: !recorrido, maxPitch: 75 }, () => {});
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    m.addControl(overlay);
    mapa.current = m;
    m.once('load', () => setListo(true));
    new Marker({ element: crear('r3d-mut', '<i></i><span>MUT</span>'), anchor: 'left' }).setLngLat(MUT).addTo(m);
    const espera = setTimeout(() => setEsperaVencida(true), ESPERA_LOCALES_MS);

    let cuadro = 0;
    let ultimoAviso = 0;
    const animar = () => {
      const d = datos.current;
      const ahora = performance.now();
      const t = d.inicio === null ? 0 : ahora - d.inicio;
      if (recorrido && d.inicio !== null) m.jumpTo(camara(t, d.cuento[0]?.punto ?? MUT));
      d.animaciones = d.animaciones.filter(a => ahora - a.inicio < DURACION[a.tipo]);
      overlay.setProps({ layers: capasDeck(d.escena, d.locales, d.animaciones, t, ahora, id => elegir.current(id)) });
      pintarEtiquetas(t);
      if (ahora - ultimoAviso > 200) {
        ultimoAviso = ahora;
        avanzar.current(t, d.escena.nodos.filter(n => n.aparece <= t && (!n.ilustrativo || t < DURACION_HISTORIA)).length);
      }
      cuadro = requestAnimationFrame(animar);
    };
    cuadro = requestAnimationFrame(animar);

    return () => {
      cancelAnimationFrame(cuadro);
      clearTimeout(espera);
      etiquetas.current.clear();
      mapa.current = null;
      m.remove();
    };
  }, [recorrido]);

  // La secuencia parte cuando el mapa cargó y llegaron los locales (o se cansó de esperarlos). Queda fija desde ahí.
  useEffect(() => {
    const d = datos.current;
    if (d.inicio !== null || !listo || !(locales || esperaVencida)) return;
    d.estado = estado;
    d.cuento = historia(estado, locales ?? []);
    d.inicio = performance.now();
    rearmar();
  }, [listo, locales, esperaVencida, estado]);

  useEffect(() => {
    datos.current.estado = estado;
    datos.current.cambios = cambios;
    rearmar();
  }, [estado, cambios]);

  useEffect(() => {
    datos.current.locales = locales ?? [];
  }, [locales]);

  // Cada evento nuevo se anima una vez donde pasó, con el guion: venta, opinión, pedido o negocio nuevo.
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    for (const { evento: e, clase, negocio } of pulsosNuevos(eventos, vistos.current, estado, DURACION.reclamo)) {
      const desde = ubicar(negocio);
      const inicio = performance.now();
      const orden = (e.datos.orden ?? {}) as { proveedorId?: unknown };
      const proveedor = typeof orden.proveedorId === 'string' ? estado.negocios.find(n => n.id === orden.proveedorId) : undefined;
      if (clase === 'pedido') {
        if (proveedor) datos.current.animaciones.push({ tipo: 'pedido', desde: ubicar(proveedor), hasta: desde, inicio });
        continue;
      }
      datos.current.animaciones.push({ tipo: clase, desde, hasta: proveedor ? ubicar(proveedor) : undefined, inicio });
      const monto = (e.datos.documento as { monto?: unknown } | undefined)?.monto;
      if (clase === 'venta' && typeof monto === 'number') {
        const precio = new Marker({ element: crear('r3d-precio'), anchor: 'bottom', offset: [0, -10] }).setLngLat(desde).addTo(m);
        precio.getElement().textContent = dinero(monto);
        setTimeout(() => precio.remove(), DURACION.venta);
      }
    }
  }, [eventos, estado]);

  return <div className="r3d-lienzo" ref={caja} role="img" aria-label="Mapa 3D de Santiago con los negocios, los proveedores y sus compras" />;
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
    <aside className="r3d-ficha" aria-label={`Proveedor ${proveedor.nombre}`}>
      <button type="button" className="r3d-cerrar" onClick={alCerrar} aria-label="Cerrar">×</button>
      <h2>{proveedor.nombre}</h2>
      <p className="r3d-nota"><b>{valor === undefined ? 'sin nota' : nota(valor)}</b> nota de la red</p>
      <p>{miles(compradores.length)} {compradores.length === 1 ? 'comprador' : 'compradores'} en la red</p>
      {porComuna.length > 0 && (
        <ul>{porComuna.slice(0, 5).map(([comuna, n]) => <li key={comuna}><span>{comuna}</span><b>{miles(n)}</b></li>)}</ul>
      )}
    </aside>
  );
}

export function Red3D() {
  const { estado, eventos, cambios, fuente } = useRed();
  const locales = useLocales();
  const [recorrido] = useState(() => location.hash === '#recorrido');
  const [elegido, setElegido] = useState<string | null>(null);
  const [avance, setAvance] = useState({ t: 0, vistos: 0 });
  if (!estado) return <Cargando />;

  const totalLocales = locales?.locales.length ?? 0;
  const enVivo = estado.negocios.filter(n => n.rol === 'comprador').length;
  const cap = capitulo(avance.t, avance.vistos, totalLocales) ?? { cifra: enVivo, texto: enVivo === 1 ? 'negocio en la red, en vivo' : 'negocios en la red, en vivo' };
  const ilustrando = avance.t < DURACION_HISTORIA;

  return (
    <main className="r3d">
      <Lienzo
        estado={estado} cambios={cambios} eventos={eventos} locales={locales?.locales ?? null} recorrido={recorrido}
        alElegir={setElegido} alAvanzar={(t, vistos) => setAvance(a => (a.vistos === vistos && Math.abs(a.t - t) < 150 ? a : { t, vistos }))}
      />
      <header className="r3d-arriba">
        <span className="r3d-marca">Bando</span>
        <span className="r3d-titulo">La red crece</span>
        {ilustrando ? <span className="etiqueta r3d-modo">con locales reales de OpenStreetMap</span> : <span className="en-vivo contorno">En vivo</span>}
        <AvisoFuente fuente={fuente} />
      </header>
      <p className="r3d-cifra" aria-live="polite"><b>{miles(cap.cifra)}</b><small>{cap.texto}</small></p>
      <ul className="r3d-leyenda" aria-label="Leyenda">
        <li><i className="punto verde" /> negocio</li>
        <li><i className="cubo" /> proveedor</li>
        <li><i className="punto local" /> local de Chile</li>
        <li><i className="raya" /> compra</li>
        <li className="credito">mapa © OpenStreetMap</li>
      </ul>
      {!recorrido && <p className="r3d-ayuda">Arrastra para mover · Ctrl + arrastrar para girar · clic en un proveedor</p>}
      {elegido && <FichaProveedor estado={estado} id={elegido} alCerrar={() => setElegido(null)} />}
    </main>
  );
}
