// /marca: la guía viva del sistema de diseño de Bando (DESIGN.md). Muestra los tokens leídos del CSS real (no copia
// ningún valor: si tokens.css cambia, la guía cambia), las primitivas en todos sus estados y el modo proyección.
// Sirve para revisar una vista contra la marca y para que un agente la capture y compare.

import { useEffect, useState, type ReactNode } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { BotonTema } from '../marca/BotonTema.tsx';
import { Logo } from '../marca/Logo.tsx';
import { Barra, Boton, Cifra, Estado, EstadoVacio, Etiqueta, ProgresoGrupo, Tarjeta, type TonoEstado, type VarianteBoton } from '../marca/componentes.tsx';
import { ABEJA, ICONO_FLUJO, ILUSTRACION } from '../marca/recursos.ts';
import { useTema } from '../marca/tema.ts';
import './guia-marca.css';

const COLORES: [token: string, nombre: string, uso: string][] = [
  ['--bando-miel', 'Miel', 'Progreso del grupo, destacado. Nunca texto sobre blanco.'],
  ['--bando-miel-texto', 'Miel texto', 'Texto miel sobre blanco o crema.'],
  ['--bando-oliva', 'Oliva', 'La red. Rellenos secundarios.'],
  ['--bando-oliva-texto', 'Oliva texto', 'Todo ahorro en texto.'],
  ['--bando-crema', 'Crema', 'Celdas y tarjetas cálidas.'],
  ['--bando-carbon', 'Carbón', 'Trazo de ilustración, fondo oscuro de marca.'],
  ['--bando-sii', 'Azul SII', 'Solo lo que queda registrado en el SII.'],
];

const NEUTROS: [token: string, nombre: string][] = [
  ['--color-background', 'Lienzo'], ['--color-muted', 'Lateral'], ['--color-secondary', 'Apoyo'], ['--color-border', 'Borde'],
  ['--color-foreground', 'Texto'], ['--color-muted-foreground', 'Texto 2'], ['--color-faint-fg', 'Texto 3'], ['--color-primary', 'Primario'],
  ['--color-success', 'Éxito'], ['--color-warning', 'Aviso'], ['--color-destructive', 'Error'], ['--color-info', 'Info'],
];

const TIPOS: [clase: string, nombre: string, medida: string, ejemplo: string][] = [
  ['display', 'Display', '72 / 76 · 700', 'Compran juntos.'],
  ['heroe', 'Número héroe', '60 / 60 · 600', dinero(184300)],
  ['titulo', 'Título', '36 / 40 · 700', 'Te sumaste.'],
  ['subtitulo', 'Subtítulo', '24 / 32 · 700', 'Rollos térmicos 80 mm'],
  ['cuerpo', 'Cuerpo', '16 / 24 · 400', `Faltan 13 cajas para ${dinero(27000)}.`],
  ['chico', 'Cuerpo chico', '14 / 20 · 400', 'Cierra hoy a las 18:00.'],
];

const ESPACIOS = [1, 2, 3, 4, 6, 8, 12, 16];
const DURACIONES = ['--duracion-rapida', '--duracion-base', '--duracion-lenta', '--duracion-celebracion'];
const VARIANTES: [VarianteBoton, string][] = [['primario', 'Confirmar pedido'], ['secundario', 'Ver detalle'], ['miel', 'Sumarme'], ['sii', 'Emitir factura'], ['texto', 'Cancelar']];
const TONOS: [TonoEstado, string][] = [['neutro', 'Borrador'], ['aviso', 'Por confirmar'], ['info', 'En camino'], ['exito', 'Recibido'], ['error', 'Reclamo'], ['sii', 'Aceptado por el SII']];

const VOZ: [si: string, no: string][] = [
  [`Faltan 13 cajas para ${dinero(27000)}.`, 'Aún no se ha alcanzado el umbral de volumen para acceder al siguiente tramo.'],
  ['Te sumaste. Ya van 45 de 50.', 'Su solicitud de participación ha sido procesada exitosamente.'],
  ['El proveedor ya recibió el pago.', 'La transacción fue liquidada al beneficiario.'],
  ['Lo que no llegó no se paga.', 'Los ítems no recepcionados serán descontados conforme a la política vigente.'],
];

/** Valor de un token tal como lo resolvió el navegador en el tema actual. */
function useToken(token: string, ancla: HTMLElement | null): string {
  const [tema] = useTema();
  const [valor, setValor] = useState('');
  useEffect(() => { if (ancla) setValor(getComputedStyle(ancla).getPropertyValue(token).trim()); }, [token, ancla, tema]);
  return valor;
}

/** Contraste WCAG entre dos colores hexadecimales (los tokens de color se escriben en hex). */
function contraste(a: string, b: string): number | null {
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const [r, g, bl] = [0, 2, 4].map(i => parseInt(m[1]!.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const x = lum(a), y = lum(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function Muestra({ token, nombre, uso, ancla }: { token: string; nombre: string; uso?: string; ancla: HTMLElement | null }) {
  const valor = useToken(token, ancla);
  const fondo = useToken('--color-background', ancla);
  const c = contraste(valor, fondo);
  return (
    <li className="gm-muestra">
      <span className="gm-color" style={{ background: `var(${token})` }} />
      <div>
        <strong>{nombre}</strong>
        <code>{token}</code>
        <span className="gm-valor">{valor}{c !== null && <> · {c.toFixed(1).replace('.', ',')}:1 sobre el lienzo</>}</span>
        {uso && <span className="gm-uso">{uso}</span>}
      </div>
    </li>
  );
}

function Seccion({ id, titulo, bajada, children }: { id: string; titulo: string; bajada?: string; children: ReactNode }) {
  return (
    <section id={id} className="gm-seccion" aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`}>{titulo}</h2>
      {bajada && <p className="gm-bajada">{bajada}</p>}
      {children}
    </section>
  );
}

export function GuiaMarca() {
  const [ancla, setAncla] = useState<HTMLElement | null>(null);
  return (
    <div className="bando-ui gm-pagina" ref={setAncla}>
      <header className="gm-cabecera">
        <Logo />
        <nav className="gm-indice" aria-label="Secciones de la guía">
          {[['reglas', 'Reglas'], ['color', 'Color'], ['tipografia', 'Tipografía'], ['espacio', 'Espacio'], ['primitivas', 'Primitivas'], ['proyeccion', 'Proyección'], ['ilustracion', 'Ilustración'], ['voz', 'Voz']]
            .map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}
        </nav>
        <BotonTema className="bm-boton-icono" />
      </header>

      <main className="gm-contenido">
        <div className="gm-portada">
          <Etiqueta>Sistema de diseño</Etiqueta>
          <h1>Bando, en un solo lugar.</h1>
          <p className="gm-bajada">Tokens, primitivas y reglas que toda vista usa. Los valores se leen del CSS real: si cambia la marca, esta página cambia sola. El detalle está en DESIGN.md y en el <a href="/marca/manual-de-marca.html">manual de marca</a>.</p>
        </div>

        <Seccion id="reglas" titulo="Reglas" bajada="Lo mínimo que toda pantalla cumple. npm run marca revisa las que se pueden leer en el código.">
          <div className="gm-reglas">
            <Tarjeta>
              <Etiqueta>Siempre</Etiqueta>
              <ul>
                <li>Colores, espacios, radios y sombras desde tokens.css.</li>
                <li>Botones, tarjetas, estados y vacíos con las primitivas de marca.</li>
                <li>Un número grande y una acción principal por pantalla.</li>
                <li>Montos con dinero(): {dinero(1234567)}.</li>
                <li>Logo del SII en cada acción del SII.</li>
              </ul>
            </Tarjeta>
            <Tarjeta>
              <Etiqueta>Nunca</Etiqueta>
              <ul>
                <li>Un color escrito a mano en una vista.</li>
                <li>Miel como color de texto sobre blanco.</li>
                <li>Más de un botón miel por pantalla.</li>
                <li>Texto de menos de 12 px, emojis o sombras en tarjetas.</li>
                <li>El nombre de otro comprador.</li>
                <li>Un fondo o baldosa detrás de un ícono o un logo: sobre azul, el logo del SII va en blanco.</li>
              </ul>
            </Tarjeta>
          </div>
        </Seccion>

        <Seccion id="color" titulo="Color" bajada="60 % blanco, 25 % neutros, 10 % miel, 5 % oliva. Si la pantalla se ve amarilla, sobra miel.">
          <ul className="gm-muestras">{COLORES.map(([t, n, u]) => <Muestra key={t} token={t} nombre={n} uso={u} ancla={ancla} />)}</ul>
          <h3>Neutros y estados (cambian con el tema)</h3>
          <ul className="gm-muestras chicas">{NEUTROS.map(([t, n]) => <Muestra key={t} token={t} nombre={n} ancla={ancla} />)}</ul>
        </Seccion>

        <Seccion id="tipografia" titulo="Tipografía" bajada="Una sola familia, Inter. Titulares apretados; textos chicos con aire. Nada bajo 12 px.">
          <ul className="gm-tipos">
            {TIPOS.map(([c, n, m, e]) => (
              <li key={c}><span className="gm-tipo-meta"><strong>{n}</strong>{m}</span><span className={`gm-tipo ${c}`}>{e}</span></li>
            ))}
            <li><span className="gm-tipo-meta"><strong>Etiqueta</strong>12 / 16 · 600 · mayúsculas</span><Etiqueta>Cierra en</Etiqueta></li>
          </ul>
        </Seccion>

        <Seccion id="espacio" titulo="Espacio, capas y movimiento" bajada="Múltiplos de 4. Las tarjetas se separan con borde, no con sombra; solo lo que flota la lleva.">
          <ul className="gm-espacios">
            {ESPACIOS.map(n => (
              <li key={n}><code>--espacio-{n}</code><span className="gm-regla" style={{ width: `var(--espacio-${n})` }} /><span>{n * 4} px</span></li>
            ))}
          </ul>
          <div className="gm-elevacion">
            <Tarjeta><Etiqueta>Tarjeta</Etiqueta><p>Sin sombra. Borde de 0,8 px.</p></Tarjeta>
            <div className="bm-tarjeta bm-tarjeta-relleno gm-flotante"><Etiqueta>Flotante</Etiqueta><p>--sombra-flotante: menú, barra fija.</p></div>
          </div>
          <ul className="gm-duraciones">
            {DURACIONES.map(d => <DuracionMuestra key={d} token={d} ancla={ancla} />)}
          </ul>
        </Seccion>

        <Seccion id="primitivas" titulo="Primitivas" bajada="client/src/marca/componentes.tsx. Una vista arma su pantalla con estas piezas.">
          <h3>Boton</h3>
          <div className="gm-fila">
            {VARIANTES.map(([v, t]) => <Boton key={v} variante={v}>{t}</Boton>)}
            <Boton disabled>Sin conexión</Boton>
          </div>
          <h3>Estado</h3>
          <div className="gm-fila">{TONOS.map(([t, x]) => <Estado key={t} tono={t}>{x}</Estado>)}</div>
          <h3>Cifra</h3>
          <div className="gm-fila gm-cifras">
            <Cifra tamano="heroe" valor={dinero(184300)} etiqueta="El grupo ahorra" tono="ahorro" />
            <Cifra tamano="grande" valor={dinero(29900)} etiqueta="Precio de hoy" detalle={`antes ${dinero(32000)}`} />
            <Cifra valor={contar(37, 'caja', 'cajas')} etiqueta="Van" />
          </div>
          <h3>Tarjeta y progreso del grupo</h3>
          <div className="gm-reglas">
            <Tarjeta>
              <Etiqueta>Compra en grupo</Etiqueta>
              <p className="gm-producto">Rollos térmicos 80 mm</p>
              <ProgresoGrupo valor={37} meta={50} etiqueta="37 de 50 cajas" resumen={`11 locales · ${contar(37, 'caja', 'cajas')} de 50`} siguiente={`Faltan 13 para ${dinero(27000)}`} />
            </Tarjeta>
            <Tarjeta calida>
              <Etiqueta>Tarjeta cálida</Etiqueta>
              <p className="gm-producto">Un destacado por pantalla</p>
              <Barra valor={45} meta={50} etiqueta="45 de 50 cajas" />
            </Tarjeta>
          </div>
          <h3>Chips para elegir</h3>
          <div className="bm-chips">
            <button type="button" className="bm-chip elegido" aria-pressed="true">Almacén</button>
            <button type="button" className="bm-chip" aria-pressed="false">Panadería</button>
            <button type="button" className="bm-chip" aria-pressed="false">Restaurante</button>
          </div>
          <h3>EstadoVacio</h3>
          <Tarjeta>
            <EstadoVacio ilustracion={ILUSTRACION.cajas} titulo="Todavía no tienes pedidos"
              texto="Cuando un negocio te pida o cierres una compra en grupo, aparecen aquí." accion={<Boton variante="secundario">Ver compras abiertas</Boton>} />
          </Tarjeta>
        </Seccion>

        <Seccion id="proyeccion" titulo="Modo proyección" bajada=".bando-proyeccion: /red, /licitacion y /mapa. Siempre oscuro, medidas en unidades de pantalla, la miel para el número héroe.">
          <div className="bando-proyeccion gm-proyeccion" aria-label="Ejemplo de pantalla proyectada">
            <span className="gm-proy-etiqueta">Compra en grupo en vivo</span>
            <span className="gm-proy-titulo">Rollos térmicos 80 mm</span>
            <span className="gm-proy-heroe">{dinero(27900)}</span>
            <Barra valor={37} meta={50} etiqueta="37 de 50 cajas" />
            <span className="gm-proy-cuerpo">11 locales · {contar(37, 'caja', 'cajas')} · <span className="bm-ahorro">faltan 13 para {dinero(27000)}</span></span>
            <Estado tono="sii">32 facturas aceptadas por el SII</Estado>
          </div>
        </Seccion>

        <Seccion id="ilustracion" titulo="Íconos de flujo y abejas" bajada="Una ilustración por pantalla, sobre blanco o crema. Nunca en tablas ni formularios.">
          <ul className="gm-flujos">
            {Object.entries(ICONO_FLUJO).map(([clave, src]) => <li key={clave}><img className="ilustracion" src={src} alt="" /><code>{clave}</code></li>)}
          </ul>
          <ul className="gm-flujos abejas">
            {Object.entries(ABEJA).map(([clave, src]) => <li key={clave}><img className="ilustracion" src={src} alt="" /><code>{clave}</code></li>)}
          </ul>
        </Seccion>

        <Seccion id="voz" titulo="Voz" bajada="Corto, claro y cercano, en español neutro. Primero el número y después la explicación.">
          <ul className="gm-voz">
            {VOZ.map(([si, no]) => (
              <li key={si}><span className="gm-si"><Estado tono="exito">Sí</Estado>{si}</span><span className="gm-no"><Estado tono="error">No</Estado>{no}</span></li>
            ))}
          </ul>
        </Seccion>
      </main>
    </div>
  );
}

function DuracionMuestra({ token, ancla }: { token: string; ancla: HTMLElement | null }) {
  const valor = useToken(token, ancla);
  return <li><code>{token}</code><span>{valor}</span></li>;
}
