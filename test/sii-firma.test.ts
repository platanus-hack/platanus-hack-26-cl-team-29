import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Element } from '@xmldom/xmldom';
import { canonicalizar, parsearXml } from '../server/sii/c14n.ts';
import { firmarSemilla } from '../server/sii/firma.ts';
import { certificadoDePrueba, RUT_FIRMANTE, verificarFirma } from './sii-apoyo.ts';

test('C14N escapa solo & < > y CR en el texto, ordena atributos y hereda el xmlns del padre', () => {
  const doc = parsearXml(
    `<DTE xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1.0">` +
      `<Documento b="2" ID="X" a="1"><A>PLC'S "uno" &amp; &lt;dos&gt; &#xD;</A><B xmlns="http://www.sii.cl/SiiDte"/></Documento></DTE>`,
  );
  const documento = doc.getElementsByTagName('Documento').item(0) as Element;
  assert.equal(
    canonicalizar(documento),
    `<Documento xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ID="X" a="1" b="2">` +
      `<A>PLC'S "uno" &amp; &lt;dos&gt; &#xD;</A><B></B></Documento>`,
  );
});

test('la semilla firmada verifica con la llave del certificado y su SignedInfo canónico', () => {
  const certificado = certificadoDePrueba();
  const xml = firmarSemilla('012345678901', certificado);
  const doc = parsearXml(xml);
  const raiz = doc.documentElement as Element;
  const firma = raiz.getElementsByTagName('Signature').item(0) as Element;
  assert.equal(firma.parentNode, raiz);
  assert.equal(firma.getElementsByTagName('Reference').item(0)?.getAttribute('URI'), '');

  // Reference URI="" con enveloped-signature: el documento entero sin la firma.
  raiz.removeChild(firma);
  assert.equal(canonicalizar(raiz), '<getToken><item><Semilla>012345678901</Semilla></item></getToken>');
  verificarFirma(firma, raiz);
  for (const nombre of ['SignatureValue', 'Modulus', 'X509Certificate']) {
    const lineas = (firma.getElementsByTagName(nombre).item(0)?.textContent ?? '').split('\n');
    assert.ok(lineas.length > 1 && lineas.every(l => l.length <= 64), `${nombre} en líneas de 64`);
  }
  assert.equal(certificado.rut, RUT_FIRMANTE);
});

test('una semilla con otra forma no se firma', () => {
  assert.throws(() => firmarSemilla('<x/>', certificadoDePrueba()), /Semilla/);
});
