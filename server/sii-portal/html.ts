// Lectura del HTML del portal del SII (HTML 4 escrito a mano): etiquetas sin cerrar, atributos con y sin comillas
// (`value = 1`), `value=` dentro de manejadores JavaScript y entidades HTML en los textos. Se lee por etiquetas, no por
// expresiones sobre el cuerpo completo, y se clasifica sobre el texto visible ya decodificado.

export interface Etiqueta {
  nombre: string;
  cierre: boolean;
  atributos: Record<string, string>;
}

export type Pieza = { tipo: 'etiqueta'; etiqueta: Etiqueta } | { tipo: 'texto'; texto: string } | { tipo: 'script'; texto: string };

const ENTIDADES: Readonly<Record<string, string>> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', deg: '°', ordm: 'º', ordf: 'ª', iquest: '¿', iexcl: '¡',
};

export function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] === '#') {
      const codigo = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : todo;
    }
    return ENTIDADES[e] ?? todo;
  });
}

/** Espacios compactados. */
export const compactar = (texto: string): string => texto.replace(/\s+/g, ' ').trim();

/** Mayúsculas sin tildes ni espacios repetidos: para comparar etiquetas y mensajes del SII. */
export const normalizar = (texto: string): string =>
  compactar(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const ATRIBUTO = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function leerAtributos(texto: string): Record<string, string> {
  const atributos: Record<string, string> = {};
  for (const m of texto.matchAll(ATRIBUTO)) {
    const nombre = (m[1] ?? '').toLowerCase();
    if (!nombre || nombre in atributos) continue;
    atributos[nombre] = decodificar(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return atributos;
}

/** Piezas del documento en orden. El contenido de `<script>` queda aparte: ahí viven los `alert()` del SII. */
export function tokenizar(html: string): Pieza[] {
  const piezas: Pieza[] = [];
  const re = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let desde = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > desde) piezas.push({ tipo: 'texto', texto: decodificar(html.slice(desde, m.index)) });
    desde = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const nombre = (m[2] ?? '').toLowerCase();
    const cierre = m[1] === '/';
    piezas.push({ tipo: 'etiqueta', etiqueta: { nombre, cierre, atributos: cierre ? {} : leerAtributos(m[3] ?? '') } });
    if (nombre === 'script' && !cierre) {
      const fin = html.toLowerCase().indexOf('</script', desde);
      const hasta = fin < 0 ? html.length : fin;
      piezas.push({ tipo: 'script', texto: html.slice(desde, hasta) });
      desde = hasta;
      re.lastIndex = hasta;
    }
  }
  if (desde < html.length) piezas.push({ tipo: 'texto', texto: decodificar(html.slice(desde)) });
  return piezas;
}

/** Texto visible (sin scripts ni estilos), compactado. */
export function textoVisible(html: string): string {
  const partes: string[] = [];
  let enEstilo = false;
  for (const p of tokenizar(html)) {
    if (p.tipo === 'etiqueta' && p.etiqueta.nombre === 'style') enEstilo = !p.etiqueta.cierre;
    else if (p.tipo === 'texto' && !enEstilo) partes.push(p.texto);
  }
  return compactar(partes.join(' '));
}

export function titulo(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? compactar(decodificar(m[1] ?? '')) : null;
}

/** Mensajes de `alert('...')` no comentados, en orden. */
export function alertas(html: string): string[] {
  const mensajes: string[] = [];
  for (const p of tokenizar(html)) {
    if (p.tipo !== 'script') continue;
    for (const linea of p.texto.split('\n')) {
      if (/^\s*\/\//.test(linea)) continue;
      for (const m of linea.matchAll(/alert\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) {
        mensajes.push(compactar(decodificar((m[2] ?? '').replace(/\\n/g, ' ').replace(/\\(.)/g, '$1'))));
      }
    }
  }
  return mensajes;
}

export interface Formulario {
  nombre: string | null;
  /** `action` tal cual. */
  accion: string | null;
  /** Campos que el navegador enviaría, en orden, sin repetir nombres. Los botones se incluyen, como hace la referencia. */
  campos: [string, string][];
  botones: { nombre: string; valor: string; alHacerClic: string | null }[];
}

const EXCLUIDOS = new Set(['reset', 'image', 'file']);

function agregar(campos: [string, string][], nombre: string, valor: string) {
  const i = campos.findIndex(([n]) => n === nombre);
  if (i >= 0) campos[i] = [nombre, valor];
  else campos.push([nombre, valor]);
}

/** Formularios de la página en orden. Un `<form>` nuevo cierra el anterior (el SII no los anida). */
export function leerFormularios(html: string): Formulario[] {
  const formularios: Formulario[] = [];
  let actual: Formulario | null = null;
  for (const p of tokenizar(html)) {
    if (p.tipo !== 'etiqueta') continue;
    const e = p.etiqueta;
    if (e.nombre === 'form') {
      if (actual) formularios.push(actual);
      actual = e.cierre ? null : { nombre: e.atributos.name ?? null, accion: e.atributos.action ?? null, campos: [], botones: [] };
      continue;
    }
    if (!actual || e.nombre !== 'input' || e.cierre || e.atributos.name === undefined) continue;
    const tipo = (e.atributos.type ?? 'text').toLowerCase();
    const valor = e.atributos.value ?? '';
    if (tipo === 'button' || tipo === 'submit') actual.botones.push({ nombre: e.atributos.name, valor, alHacerClic: e.atributos.onclick ?? null });
    if (EXCLUIDOS.has(tipo) || e.atributos.disabled !== undefined) continue;
    if ((tipo === 'checkbox' || tipo === 'radio') && e.atributos.checked === undefined) continue;
    agregar(actual.campos, e.atributos.name, valor);
  }
  if (actual) formularios.push(actual);
  return formularios;
}

/** El primer formulario cuyo `action` termina en `/<destino>`. */
export const formularioHacia = (formularios: Formulario[], destino: string): Formulario | null =>
  formularios.find(f => (f.accion ?? '').split('?')[0]!.endsWith(`/${destino}`) || f.accion === destino) ?? null;

export const valorDe = (f: Formulario, nombre: string): string | null =>
  f.campos.find(([n]) => n.toUpperCase() === nombre.toUpperCase())?.[1] ?? null;

/** Opciones de un `<select name=...>`: valor y texto. `null` si la página no trae ese selector. */
export function opcionesDe(html: string, nombre: string): { valor: string; texto: string }[] | null {
  const piezas = tokenizar(html);
  let dentro = false;
  let encontrado = false;
  const opciones: { valor: string; texto: string }[] = [];
  let actual: { valor: string; texto: string } | null = null;
  for (const p of piezas) {
    if (p.tipo === 'etiqueta' && p.etiqueta.nombre === 'select') {
      if (!p.etiqueta.cierre && (p.etiqueta.atributos.name ?? '').toUpperCase() === nombre.toUpperCase()) {
        dentro = true;
        encontrado = true;
      } else if (p.etiqueta.cierre && dentro) {
        dentro = false;
      }
      continue;
    }
    if (!dentro) continue;
    if (p.tipo === 'etiqueta' && p.etiqueta.nombre === 'option' && !p.etiqueta.cierre) {
      if (actual) opciones.push(actual);
      actual = { valor: p.etiqueta.atributos.value ?? '', texto: '' };
    } else if (p.tipo === 'texto' && actual) {
      actual.texto = compactar(`${actual.texto} ${p.texto}`);
    }
  }
  if (actual) opciones.push(actual);
  return encontrado ? opciones : null;
}

/** Valor del primer `<input name=...>` de la página, esté o no dentro de un formulario. */
export function valorDeCampo(html: string, nombre: string): string | null {
  for (const p of tokenizar(html)) {
    if (p.tipo === 'etiqueta' && p.etiqueta.nombre === 'input' && (p.etiqueta.atributos.name ?? '').toUpperCase() === nombre.toUpperCase()) {
      return p.etiqueta.atributos.value ?? '';
    }
  }
  return null;
}

/**
 * Filas de una tabla "etiqueta, valor" (ficha de la empresa): texto de cada celda, separando por `<tr>` porque el
 * HTML 4 del SII no siempre cierra las filas. Un `<input>` dentro de una celda cuenta como su valor.
 */
export function filasDeTabla(html: string): string[][] {
  const filas: string[][] = [];
  for (const tramo of html.split(/<tr(?:\s[^>]*)?>/i).slice(1)) {
    // La fila termina en su `</tr>` si lo trae; si no (HTML 4 sin cierres), en la siguiente `<tr>`.
    const fin = tramo.search(/<\/tr>/i);
    const segmento = fin < 0 ? tramo : tramo.slice(0, fin);
    const celdas: string[] = [];
    for (const m of segmento.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)(?=<td[\s>]|<\/td>|<\/tr>|$)/gi)) {
      const contenido = m[1] ?? '';
      const texto = textoVisible(contenido);
      const entrada = /<input[^>]*>/i.exec(contenido)?.[0];
      const valor = entrada ? (leerAtributos(entrada.slice(6, -1)).value ?? '') : '';
      celdas.push(compactar(texto || valor));
    }
    if (celdas.length > 0) filas.push(celdas);
  }
  return filas;
}
