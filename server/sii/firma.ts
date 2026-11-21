// XMLDSig que exige el SII: enveloped, C14N 2001, RSA-SHA1 y digest SHA-1, con `KeyValue` y `X509Certificate`.
import { createHash, sign } from 'node:crypto';
import type { Certificado } from './certificado.ts';
import { canonicalizar, elementoPorId, parsearXml } from './c14n.ts';
import { envolver64 } from './texto.ts';

const XMLDSIG = 'http://www.w3.org/2000/09/xmldsig#';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/**
 * `SignedInfo` en sus dos formas. Lo que se firma es su forma canónica (elementos vacíos expandidos y con los
 * espacios de nombres en alcance); lo que se escribe puede ir abreviado, porque el SII lo canonicaliza al verificar.
 */
function signedInfo(uri: string, digest: string, canonico: boolean, xsi: boolean): string {
  const vacio = (nombre: string, algoritmo: string): string =>
    canonico ? `<${nombre} Algorithm="${algoritmo}"></${nombre}>` : `<${nombre} Algorithm="${algoritmo}"/>`;
  return (
    `<SignedInfo xmlns="${XMLDSIG}"${xsi ? ` xmlns:xsi="${XSI}"` : ''}>` +
    vacio('CanonicalizationMethod', C14N) +
    vacio('SignatureMethod', `${XMLDSIG}rsa-sha1`) +
    `<Reference URI="${uri}"><Transforms>${vacio('Transform', `${XMLDSIG}enveloped-signature`)}</Transforms>` +
    `${vacio('DigestMethod', `${XMLDSIG}sha1`)}<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`
  );
}

const keyInfo = (c: Certificado): string =>
  `<KeyInfo><KeyValue><RSAKeyValue><Modulus>${envolver64(c.modulo)}</Modulus>` +
  `<Exponent>${c.exponente}</Exponent></RSAKeyValue></KeyValue>` +
  `<X509Data><X509Certificate>${envolver64(c.certificadoBase64)}</X509Certificate></X509Data></KeyInfo>`;

const firmarTexto = (texto: string, c: Certificado): string =>
  sign('sha1', Buffer.from(texto, 'utf8'), c.llave).toString('base64');

/**
 * Documento de `GetTokenFromSeed`: `<getToken><item><Semilla>` con la firma enveloped y `Reference URI=""`.
 * Byte a byte igual al que el SII acepta hoy. La semilla vive unos 2 minutos: se firma apenas llega.
 */
export function firmarSemilla(semilla: string, certificado: Certificado): string {
  if (!/^\d{1,20}$/.test(semilla)) throw new Error(`Semilla del SII con formato inesperado: "${semilla}"`);
  const contenido = `<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;
  const digest = createHash('sha1').update(contenido, 'utf8').digest('base64');
  const valor = firmarTexto(signedInfo('', digest, true, false), certificado);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item><Semilla>${semilla}</Semilla></item>` +
    `<Signature xmlns="${XMLDSIG}">${signedInfo('', digest, false, false)}` +
    `<SignatureValue>${envolver64(valor)}</SignatureValue>${keyInfo(certificado)}</Signature></getToken>`
  );
}

export interface DestinoFirma {
  /** Elemento firmado: `Documento` o `SetDTE`. */
  readonly etiqueta: string;
  readonly id: string;
  /** Padre del elemento: la firma queda como su último hijo (`DTE` o `EnvioDTE`). */
  readonly padre: string;
  /** El sobre escribe `xmlns:xsi` en su `SignedInfo`; el DTE lo hereda de la raíz. */
  readonly xsiEnSignedInfo: boolean;
}

/**
 * Firma el elemento con ese `ID` e inserta la `<Signature>` justo antes del cierre del padre, que debe ser el
 * último cierre del XML. El digest sale de la forma canónica del elemento dentro de este mismo documento, así que
 * el `xmlns` del `<DTE>` (o del `<EnvioDTE>`) entra en él. Lo firmado es UTF-8 aunque el archivo viaje en Latin-1.
 */
export function firmarElemento(xml: string, destino: DestinoFirma, certificado: Certificado): string {
  const elemento = elementoPorId(parsearXml(xml), destino.etiqueta, destino.id);
  if (!elemento) throw new Error(`No existe <${destino.etiqueta} ID="${destino.id}"> para firmar.`);
  const digest = createHash('sha1').update(canonicalizar(elemento), 'utf8').digest('base64');
  // En ambos casos `xmlns:xsi` está en alcance (lo declara la raíz), así que entra en la forma canónica.
  const valor = firmarTexto(signedInfo(`#${destino.id}`, digest, true, true), certificado);
  const firma =
    `<Signature xmlns="${XMLDSIG}">${signedInfo(`#${destino.id}`, digest, false, destino.xsiEnSignedInfo)}` +
    `<SignatureValue>${envolver64(valor)}</SignatureValue>${keyInfo(certificado)}</Signature>`;

  const cierre = `</${destino.padre}>`;
  const posicion = xml.lastIndexOf(cierre);
  if (posicion < 0 || xml.slice(posicion + cierre.length).trim() !== '') {
    throw new Error(`</${destino.padre}> debe cerrar el XML para insertar la firma.`);
  }
  return `${xml.slice(0, posicion)}${firma}${xml.slice(posicion)}`;
}
