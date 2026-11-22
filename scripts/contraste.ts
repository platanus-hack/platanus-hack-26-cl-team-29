// Auditoría de contraste (WCAG) de la pantalla abierta, en claro y en oscuro. Corre dentro del navegador: `npm run
// contraste` imprime la función lista para pegar en la consola o para pasarla a un navegador automatizado (MCP de
// Playwright o Claude in Chrome con `evaluate`). Devuelve cada texto visible que no llega a 4,5:1 (o 3:1 si es grande:
// 24 px, o 18,7 px en negrita), con su selector, colores y contraste. Sin dependencias: la usan agentes y personas.
//
// Uso: abre la vista (con ?prueba si hace falta), ejecuta `auditarContraste()` y revisa la lista; repite en cada
// estado (menú abierto, modal, hover con la clase forzada, etc.). DESIGN.md, "Color", explica qué token va dónde.

export function auditarContraste(): { modo: string; ruta: string; hallazgos: object[] }[] {
  type Rgba = [number, number, number, number];
  // Acepta rgb()/rgba() y color(srgb r g b / a), que es lo que devuelve el navegador para color-mix y alfas.
  const leer = (c: string): Rgba => {
    const srgb = c.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
      const p = srgb[1]!.split(/[ /]+/).filter(Boolean).map(Number);
      return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p[3] ?? 1];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
  };
  const mezclar = (arriba: Rgba, abajo: Rgba): Rgba => {
    const a = arriba[3];
    return [arriba[0] * a + abajo[0] * (1 - a), arriba[1] * a + abajo[1] * (1 - a), arriba[2] * a + abajo[2] * (1 - a), 1];
  };
  const luz = ([r, g, b]: Rgba) => {
    const canal = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
  };
  const contraste = (a: Rgba, b: Rgba) => { const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
  // Fondo efectivo: los fondos semitransparentes de los ancestros se componen sobre el primero opaco.
  const fondoDe = (el: Element | null): Rgba => {
    const capas: Rgba[] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = leer(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) { capas.push(c); if (c[3] >= 1) break; }
    }
    let fondo: Rgba = leer(getComputedStyle(document.body).backgroundColor);
    if (fondo[3] === 0) fondo = [255, 255, 255, 1];
    for (const c of capas.reverse()) fondo = mezclar(c, fondo);
    return fondo;
  };
  const selector = (el: Element) => {
    const partes: string[] = [];
    for (let e: Element | null = el; e && partes.length < 3; e = e.parentElement) {
      partes.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    }
    return partes.join(' > ');
  };

  const auditar = () => {
    const hallazgos: object[] = [];
    const vistos = new Set<Element>();
    const caminante = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = caminante.nextNode(); n; n = caminante.nextNode()) {
      const el = n.parentElement;
      if (!el || vistos.has(el) || !n.textContent?.trim()) continue;
      vistos.add(el);
      const cs = getComputedStyle(el);
      const caja = el.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0 || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"], button:disabled, [disabled], .maplibregl-ctrl-attrib, svg')) continue;
      const texto = mezclar(leer(cs.color), fondoDe(el));
      const fondo = fondoDe(el);
      const tam = parseFloat(cs.fontSize);
      const grande = tam >= 24 || (tam >= 18.66 && Number(cs.fontWeight) >= 700);
      const minimo = grande ? 3 : 4.5;
      const r = contraste(texto, fondo);
      if (r < minimo) {
        hallazgos.push({ texto: n.textContent.trim().slice(0, 40), selector: selector(el), contraste: Number(r.toFixed(2)), minimo, color: cs.color, fondo: `rgb(${fondo.slice(0, 3).map(Math.round).join(',')})` });
      }
    }
    return hallazgos;
  };

  const html = document.documentElement;
  const original = html.dataset.tema;
  // Sin transiciones mientras se mide: si no, al cambiar de modo se leen colores a medio camino.
  const quieto = document.createElement('style');
  quieto.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
  document.head.append(quieto);
  const resultado = (['claro', 'oscuro'] as const).map(modo => {
    html.dataset.tema = modo;
    return { modo, ruta: location.pathname + location.hash, hallazgos: auditar() };
  });
  if (original) html.dataset.tema = original; else delete html.dataset.tema;
  quieto.remove();
  return resultado;
}

// `npm run contraste`: imprime la función como texto, lista para el navegador.
if (import.meta.main) console.log(`(${auditarContraste.toString()})()`);
