// Material desechable para los tests del SII: llaves, certificado y CAF generados al vuelo. Nada real.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify, X509Certificate } from 'node:crypto';
import type { Element } from '@xmldom/xmldom';
import forge from 'node-forge';
import { leerCaf, type Caf } from '../server/sii/caf.ts';
import { canonicalizar } from '../server/sii/c14n.ts';
import { abrirCertificado, type Certificado } from '../server/sii/certificado.ts';
import { escaparXml } from '../server/sii/texto.ts';

/** RUT de ejemplo sin dueño real. */
export const RUT_FIRMANTE = '11111111-1';
export const RUT_EMPRESA = '22222222-2';
export const CLAVE_PFX = 'clave-de-prueba';

export function generarPfx(rut = RUT_FIRMANTE, vence = new Date(Date.now() + 365 * 86_400_000)): Buffer {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const llave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(llave.n, llave.e);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Math.min(Date.now(), vence.getTime()) - 86_400_000);
  cert.validity.notAfter = vence;
  const sujeto = [{ name: 'commonName', value: 'Firmante de Prueba' }, { name: 'serialNumber', value: rut }];
  cert.setSubject(sujeto);
  cert.setIssuer(sujeto);
  cert.sign(llave, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(llave, [cert], CLAVE_PFX, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

let certificado: Certificado | null = null;
export const certificadoDePrueba = (): Certificado =>
  (certificado ??= abrirCertificado(generarPfx(), CLAVE_PFX));

/** CAF con el formato del SII (llave de 512 bits, como los reales), indentado y en ISO-8859-1. */
export function generarCaf(tipo: number, opciones: { desde?: number; hasta?: number; fa?: string } = {}): { caf: Caf; bytes: Buffer } {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 512 });
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const m = Buffer.from(jwk.n ?? '', 'base64url').toString('base64');
  const fa = opciones.fa ?? new Date().toISOString().slice(0, 10);
  const xml =
    `<?xml version="1.0" encoding="ISO-8859-1"?>\n<AUTORIZACION>\n<CAF version="1.0">\n<DA>\n` +
    `<RE>${RUT_EMPRESA}</RE>\n<RS>COMPAÑIA DE PRUEBA</RS>\n<TD>${tipo}</TD>\n` +
    `<RNG><D>${opciones.desde ?? 1}</D><H>${opciones.hasta ?? 100}</H></RNG>\n<FA>${fa}</FA>\n` +
    `<RSAPK><M>${m}</M><E>AQAB</E></RSAPK>\n<IDK>100</IDK>\n</DA>\n` +
    `<FRMA algoritmo="SHA1withRSA">ZmlybWEtZGUtcHJ1ZWJh</FRMA>\n</CAF>\n` +
    `<RSASK>${privateKey.export({ type: 'pkcs1', format: 'pem' })}</RSASK>\n</AUTORIZACION>\n`;
  const bytes = Buffer.from(xml, 'latin1');
  return { caf: leerCaf(bytes), bytes };
}

/** Respuesta SOAP del SII: el XML de negocio va escapado dentro del elemento de retorno. */
export const respuestaSoap = (interior: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soapenv:Body><ns1:respuesta><return>${escaparXml(`<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">${interior}</SII:RESPUESTA>`)}` +
  `</return></ns1:respuesta></soapenv:Body></soapenv:Envelope>`;

export const respuestaSemilla = respuestaSoap('<SII:RESP_BODY><SEMILLA>012345678901</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR>');
export const respuestaToken = (token: string): string =>
  respuestaSoap(`<SII:RESP_BODY><TOKEN>${token}</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO><GLOSA>Token Creado</GLOSA></SII:RESP_HDR>`);

/** Verifica una firma como lo haría el SII: digest del elemento referido y RSA-SHA1 sobre el SignedInfo canónico. */
export function verificarFirma(firma: Element, referido: Element): void {
  const digest = createHash('sha1').update(canonicalizar(referido), 'utf8').digest('base64');
  assert.equal(firma.getElementsByTagName('DigestValue').item(0)?.textContent, digest, 'digest');
  const certificado = new X509Certificate(
    Buffer.from(firma.getElementsByTagName('X509Certificate').item(0)?.textContent ?? '', 'base64'),
  );
  const signedInfo = canonicalizar(firma.getElementsByTagName('SignedInfo').item(0) as Element);
  const valor = Buffer.from(firma.getElementsByTagName('SignatureValue').item(0)?.textContent ?? '', 'base64');
  assert.ok(verify('sha1', Buffer.from(signedInfo, 'utf8'), certificado.publicKey, valor), 'firma RSA');
}
