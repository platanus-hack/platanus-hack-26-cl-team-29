import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import type { Element } from '@xmldom/xmldom';
import { primerDiaVencido, validarCaf } from '../server/sii/caf.ts';
import { elementoPorId, parsearXml } from '../server/sii/c14n.ts';
import { aDte, armarDte, calcularTotales } from '../server/sii/dte.ts';
import { armarSobre } from '../server/sii/sobre.ts';
import { limpiarLatin1, plegarTed } from '../server/sii/texto.ts';
import type { Emisor, Receptor } from '../server/sii/tipos.ts';
import { certificadoDePrueba, generarCaf, RUT_EMPRESA, verificarFirma } from './sii-apoyo.ts';

const emisor: Emisor = {
  rut: RUT_EMPRESA, razonSocial: 'Compañía de Prueba SpA', giro: 'Venta de insumos', acteco: 465000,
  direccion: 'Calle Falsa 123', comuna: 'Santiago',
};
const receptor: Receptor = {
  rut: '11111111-1', razonSocial: 'Cliente "Ñandú" & Cía', giro: 'Comercio', direccion: 'Av. Siempre Viva 742', comuna: 'Ñuñoa',
};
const ahora = new Date('2026-11-21T15:00:00Z');

function factura33(folio = 7) {
  return armarDte(
    {
      ...aDte.factura({
        folio,
        fechaEmision: '2026-11-21',
        receptor,
        items: [
          { nombre: 'Caja de tornillos, 100 unidades', cantidad: 3, precioUnitario: 1000.5, unidad: 'UN' },
          { nombre: 'Martillo', cantidad: 1, precioUnitario: 333 },
        ],
        ordenCompra: { folio: 'OC-2026-15', fecha: '2026-11-20' },
      }),
      emisor,
    },
    generarCaf(33).caf,
    certificadoDePrueba(),
    ahora,
  );
}

const nombresHijos = (e: Element | null): string[] => {
  const nombres: string[] = [];
  for (let h = e?.firstChild; h; h = h.nextSibling) if (h.nodeType === 1) nombres.push(h.nodeName);
  return nombres;
};

test('los totales redondean cada línea y luego el IVA', () => {
  // 3 x 1000,5 = 3001,5 -> 3002; neto 3335; IVA 633,65 -> 634.
  assert.deepEqual(calcularTotales([{ nombre: 'a', cantidad: 3, precioUnitario: 1000.5 }, { nombre: 'b', cantidad: 1, precioUnitario: 333 }]), {
    lineas: [3002, 333], neto: 3335, iva: 634, total: 3969,
  });
});

test('DTE 33: orden del XSD, referencia a la OC, firma válida y líneas cortas', () => {
  const { xml, documento } = factura33();
  assert.equal(documento.montoTotal, 3969);
  const doc = parsearXml(xml);
  const dte = doc.documentElement as Element;
  const nodo = (nombre: string) => doc.getElementsByTagName(nombre).item(0);

  assert.deepEqual(nombresHijos(dte), ['Documento', 'Signature']);
  assert.deepEqual(nombresHijos(nodo('Documento')), ['Encabezado', 'Detalle', 'Detalle', 'Referencia', 'TED', 'TmstFirma']);
  assert.deepEqual(nombresHijos(nodo('Encabezado')), ['IdDoc', 'Emisor', 'Receptor', 'Totales']);
  assert.deepEqual(nombresHijos(nodo('Totales')), ['MntNeto', 'TasaIVA', 'IVA', 'MntTotal']);
  assert.deepEqual(nombresHijos(nodo('Detalle')), ['NroLinDet', 'NmbItem', 'QtyItem', 'UnmdItem', 'PrcItem', 'MontoItem']);
  assert.deepEqual(nombresHijos(nodo('Referencia')), ['NroLinRef', 'TpoDocRef', 'FolioRef', 'FchRef']);
  assert.equal(nodo('TpoDocRef')?.textContent, '801');
  assert.equal(nodo('FolioRef')?.textContent, 'OC-2026-15');
  assert.equal(nodo('RznSocRecep')?.textContent, 'Cliente "Ñandú" & Cía');

  verificarFirma(nodo('Signature') as Element, elementoPorId(doc, 'Documento', 'DTE_T33F7') as Element);
  assert.ok(xml.split('\n').every(linea => linea.length < 4090));
  assert.match(xml, /\n<TED version="1.0">/, 'el TED va en su propia línea');
});

test('el FRMT del TED verifica con la llave del CAF sobre los bytes Latin-1 del DD', () => {
  const { caf } = generarCaf(33);
  const { xml } = armarDte({ ...aDte.factura({ folio: 9, fechaEmision: '2026-11-21', receptor, items: [{ nombre: 'Ñandú de peluche', cantidad: 1, precioUnitario: 10 }] }), emisor }, caf, certificadoDePrueba(), ahora);
  const dd = /<DD>[\s\S]*<\/DD>/.exec(xml)?.[0] ?? '';
  const frmt = /<FRMT algoritmo="SHA1withRSA">([^<]+)<\/FRMT>/.exec(xml)?.[1] ?? '';
  assert.ok(verify('sha1', Buffer.from(dd, 'latin1'), createPublicKey(caf.llave), Buffer.from(frmt, 'base64')));
  assert.match(dd, /<RSR>Cliente &quot;Nandu&quot; &amp; Cia<\/RSR>/);
  assert.match(dd, /<IT1>Nandu de peluche<\/IT1>/);
  assert.ok(dd.includes(caf.xml) && caf.xml.includes('<RS>COMPAÑIA DE PRUEBA</RS>'), 'CAF incrustado sin cambios');
});

test('el sobre ordena SubTotDTE 33, 61, 52 y la firma del SetDTE y de cada DTE verifican dentro de él', () => {
  const certificado = certificadoDePrueba();
  const nota = armarDte(
    { ...aDte.notaCredito({ folio: 3, fechaEmision: '2026-11-21', receptor, items: [{ nombre: 'Martillo', cantidad: 1, precioUnitario: 333 }], factura: { folio: 7, fecha: '2026-11-21' } }), emisor },
    generarCaf(61).caf, certificado, ahora,
  );
  const guia = armarDte(
    { ...aDte.guia({ folio: 5, fechaEmision: '2026-11-21', receptor, items: [{ nombre: 'Martillo', cantidad: 2, precioUnitario: 333 }], motivoTraslado: 1 }), emisor },
    generarCaf(52).caf, certificado, ahora,
  );
  const xml = armarSobre({
    rutEmisor: RUT_EMPRESA, fchResol: '2026-01-01', certificado, ahora,
    documentos: [{ tipo: 52, xml: guia.xml }, { tipo: 61, xml: nota.xml }, { tipo: 33, xml: factura33().xml }],
  });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>\n'));
  const doc = parsearXml(xml);
  const raiz = doc.documentElement as Element;
  assert.deepEqual(nombresHijos(raiz), ['SetDTE', 'Signature']);
  assert.deepEqual([...xml.matchAll(/<TpoDTE>(\d+)<\/TpoDTE>/g)].map(m => m[1]), ['33', '61', '52']);
  assert.match(xml, /<RutEnvia>11111111-1<\/RutEnvia><RutReceptor>60803000-K<\/RutReceptor>/);
  assert.match(xml, /<CodRef>3<\/CodRef><RazonRef>Falta parcial de mercaderia<\/RazonRef>/);
  assert.match(xml, /<FchEmis>2026-11-21<\/FchEmis><IndTraslado>1<\/IndTraslado>/);

  const setDte = raiz.getElementsByTagName('SetDTE').item(0) as Element;
  verificarFirma(raiz.lastChild as Element, setDte);
  const dtes = setDte.getElementsByTagName('DTE');
  for (let i = 0; i < dtes.length; i++) {
    const dte = dtes.item(i) as Element;
    verificarFirma(dte.lastChild as Element, dte.getElementsByTagName('Documento').item(0) as Element);
  }
});

test('el texto se limpia a Latin-1 sin perder tildes ni el apóstrofe, y el TED se pliega a ASCII de 40', () => {
  assert.equal(limpiarLatin1('Ñandú \u201CPLC\u2019S\u201D \u2014 ok \u{1F600}\u0007'), 'Ñandú "PLC\'S" - ok');
  assert.equal(plegarTed('Ñuñoa Comercialización y Distribución Limitada'), 'Nunoa Comercializacion y Distribucion Li');
});

test('el CAF se rechaza si no es del tipo, del folio o está vencido', () => {
  const { caf } = generarCaf(33, { desde: 10, hasta: 20, fa: '2026-05-31' });
  assert.throws(() => validarCaf(caf, 61, RUT_EMPRESA, 10, '2026-06-01'), /tipo/);
  assert.throws(() => validarCaf(caf, 33, RUT_EMPRESA, 21, '2026-06-01'), /fuera del rango/);
  assert.equal(primerDiaVencido(caf), '2026-11-30');
  assert.doesNotThrow(() => validarCaf(caf, 33, RUT_EMPRESA, 10, '2026-11-29'));
  assert.throws(() => validarCaf(caf, 33, RUT_EMPRESA, 10, '2026-11-30'), /venció/);
});
