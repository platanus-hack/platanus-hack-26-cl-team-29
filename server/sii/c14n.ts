// Canonical XML 1.0 (REC-xml-c14n-20010315), sin comentarios, de un elemento y sus descendientes.
//
// Es lo que entra al digest de la firma. El SII lo recalcula al recibir, así que cualquier diferencia rechaza el
// envío completo. Reglas que importan:
// - Texto: solo se escapan `&`, `<`, `>` y CR. `'` y `"` quedan literales.
// - El elemento firmado lleva todos los espacios de nombres en alcance, también los heredados: el
//   `xmlns="http://www.sii.cl/SiiDte"` del `<DTE>` entra en el digest del `<Documento>`.
// - Un descendiente repite una declaración solo si cambia respecto de la ya escrita.
// - Atributos: primero las declaraciones (por prefijo), luego el resto por URI de espacio y nombre local.
import { DOMParser, type Attr, type Document, type Element, type Node } from '@xmldom/xmldom';

const ELEMENTO = 1;
const TEXTO = 3;
const CDATA = 4;
const INSTRUCCION = 7;

type Espacios = ReadonlyMap<string, string>;

/** Parsea un XML ya decodificado. Un XML mal formado lanza con el mensaje del analizador. */
export function parsearXml(xml: string): Document {
  const problemas: string[] = [];
  const documento = new DOMParser({
    onError: (nivel, mensaje) => {
      if (nivel !== 'warning') problemas.push(mensaje);
    },
  }).parseFromString(xml, 'application/xml');
  if (problemas.length > 0 || !documento.documentElement) {
    throw new Error(`XML mal formado: ${problemas.join('; ') || 'documento vacío'}`);
  }
  return documento;
}

/** Elemento con ese nombre y ese atributo `ID`. */
export function elementoPorId(documento: Document, nombre: string, id: string): Element | null {
  const candidatos = documento.getElementsByTagName(nombre);
  for (let i = 0; i < candidatos.length; i++) {
    const e = candidatos.item(i);
    if (e?.getAttribute('ID') === id) return e;
  }
  return null;
}

export function canonicalizar(elemento: Element): string {
  const padre = elemento.parentNode;
  const heredados = padre?.nodeType === ELEMENTO ? espaciosEnAlcance(padre as Element) : new Map<string, string>();
  return serializarElemento(elemento, heredados, new Map());
}

/** Texto de un nodo en C14N: solo cuatro caracteres se escapan. */
export const escaparTextoCanonico = (texto: string): string =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');

const escaparAtributo = (valor: string): string =>
  valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

const esDeclaracion = (a: Attr): boolean => a.name === 'xmlns' || a.name.startsWith('xmlns:');
const prefijoDe = (a: Attr): string => (a.name === 'xmlns' ? '' : a.name.slice(6));
const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function atributosDe(elemento: Element): Attr[] {
  const lista: Attr[] = [];
  for (let i = 0; i < elemento.attributes.length; i++) {
    const a = elemento.attributes.item(i);
    if (a) lista.push(a);
  }
  return lista;
}

function espaciosEnAlcance(elemento: Element): Map<string, string> {
  const cadena: Element[] = [];
  for (let n: Node | null = elemento; n?.nodeType === ELEMENTO; n = n.parentNode) cadena.unshift(n as Element);
  const alcance = new Map<string, string>();
  for (const e of cadena) for (const a of atributosDe(e)) if (esDeclaracion(a)) alcance.set(prefijoDe(a), a.value);
  return alcance;
}

function serializarElemento(elemento: Element, alcancePadre: Espacios, escritasPadre: Espacios): string {
  const atributos = atributosDe(elemento);
  const alcance = new Map(alcancePadre);
  for (const a of atributos) if (esDeclaracion(a)) alcance.set(prefijoDe(a), a.value);

  // Sin nada escrito antes, el espacio por defecto vacío equivale a no declarar nada.
  const declaraciones = [...alcance].filter(([prefijo, uri]) => (escritasPadre.get(prefijo) ?? '') !== uri);
  const escritas = new Map([...escritasPadre, ...declaraciones]);
  declaraciones.sort(([a], [b]) => comparar(a, b));

  const normales = atributos
    .filter(a => !esDeclaracion(a))
    .map(a => ({ clave: `${a.namespaceURI ?? ''}\u0000${a.localName ?? a.name}`, nombre: a.name, valor: a.value }))
    .sort((a, b) => comparar(a.clave, b.clave));

  let salida = `<${elemento.tagName}`;
  for (const [prefijo, uri] of declaraciones) {
    salida += ` ${prefijo === '' ? 'xmlns' : `xmlns:${prefijo}`}="${escaparAtributo(uri)}"`;
  }
  for (const a of normales) salida += ` ${a.nombre}="${escaparAtributo(a.valor)}"`;
  salida += '>';
  for (let hijo = elemento.firstChild; hijo; hijo = hijo.nextSibling) salida += serializarNodo(hijo, alcance, escritas);
  return `${salida}</${elemento.tagName}>`;
}

function serializarNodo(nodo: Node, alcance: Espacios, escritas: Espacios): string {
  switch (nodo.nodeType) {
    case ELEMENTO:
      return serializarElemento(nodo as Element, alcance, escritas);
    case TEXTO:
    case CDATA:
      return escaparTextoCanonico(nodo.nodeValue ?? '');
    case INSTRUCCION:
      return `<?${nodo.nodeName}${nodo.nodeValue ? ` ${nodo.nodeValue}` : ''}?>`;
    default:
      return '';
  }
}
