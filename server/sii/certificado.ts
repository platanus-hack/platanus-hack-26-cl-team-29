// Certificado digital del firmante (.pfx). node-forge solo abre el PKCS#12: la firma la hace node:crypto.
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import forge from 'node-forge';
import { normalizarRut } from './texto.ts';

export interface Certificado {
  /** RUT de la persona titular del certificado: es el `RutEnvia` del sobre. */
  readonly rut: string;
  readonly llave: KeyObject;
  /** X.509 en DER y base64, tal como va en `<X509Certificate>`. */
  readonly certificadoBase64: string;
  /** Módulo y exponente RSA en base64, para `<RSAKeyValue>`. */
  readonly modulo: string;
  readonly exponente: string;
  readonly venceEl: Date;
}

/** OID de la Ley 19.799 para el RUT en el SubjectAltName; es el mismo en todas las CA chilenas. */
const OID_RUT_SAN = '1.3.6.1.4.1.8321.1';
const OID_CN = '2.5.4.3';
const OID_SERIAL_NUMBER = '2.5.4.5';
const OID_OU = '2.5.4.11';

export function abrirCertificado(pfx: Buffer, clave: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), clave);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo abrir el certificado (¿clave incorrecta?): ${mensaje}`);
  }
  const llaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].flatMap(b => (b.key ? [b.key as forge.pki.rsa.PrivateKey] : []));
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .flatMap(b => (b.cert ? [b.cert] : []));

  // El archivo puede traer la cadena completa: la hoja es el certificado cuya llave pública calza con la privada.
  for (const llaveForge of llaves) {
    const hoja = certificados.find(c => {
      const publica = c.publicKey as forge.pki.rsa.PublicKey;
      return publica.n?.equals(llaveForge.n) && publica.e?.equals(llaveForge.e);
    });
    if (hoja) return construir(hoja, llaveForge);
  }
  throw new Error('El .pfx no trae una llave RSA que corresponda a alguno de sus certificados.');
}

function construir(hoja: forge.pki.Certificate, llaveForge: forge.pki.rsa.PrivateKey): Certificado {
  const rut = rutDelTitular(hoja);
  if (!rut) throw new Error('No se encontró el RUT del titular en el certificado (SAN, serialNumber, OU o CN).');
  const llave = createPrivateKey(forge.pki.privateKeyToPem(llaveForge));
  const jwk = createPublicKey(llave).export({ format: 'jwk' });
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(hoja)).getBytes();
  return {
    rut,
    llave,
    certificadoBase64: Buffer.from(der, 'binary').toString('base64'),
    modulo: Buffer.from(jwk.n ?? '', 'base64url').toString('base64'),
    exponente: Buffer.from(jwk.e ?? '', 'base64url').toString('base64'),
    venceEl: hoja.validity.notAfter,
  };
}

const comoRut = (texto: string): string | null => {
  const limpio = texto.replace(/\./g, '').toUpperCase();
  if (!/^\d{7,8}-[\dK]$/.test(limpio)) return null;
  try {
    return normalizarRut(limpio);
  } catch {
    return null;
  }
};

/** Orden de búsqueda: SAN con el OID del RUT, serialNumber, OU y por último un RUT suelto dentro del CN. */
export function rutDelTitular(certificado: forge.pki.Certificate): string | null {
  const desdeSan = rutDelSan(certificado);
  if (desdeSan) return desdeSan;
  // Por OID: `getField` de forge no encuentra `serialNumber`, que no tiene nombre corto.
  const campo = (oid: string): string | null => {
    const valor = certificado.subject.attributes.findLast(a => a.type === oid)?.value;
    return typeof valor === 'string' ? valor : null;
  };
  for (const valor of [campo(OID_SERIAL_NUMBER), campo(OID_OU)]) {
    const rut = valor ? comoRut(valor) : null;
    if (rut) return rut;
  }
  const enCn = campo(OID_CN)?.match(/(?<![\dA-Z])(\d{7,8}-[\dK])(?!\w)/i)?.[1];
  return enCn ? comoRut(enCn) : null;
}

type NombreAlternativo = { type: number; value: forge.asn1.Asn1[] };

function rutDelSan(certificado: forge.pki.Certificate): string | null {
  const san = certificado.getExtension('subjectAltName') as { altNames?: NombreAlternativo[] } | undefined;
  for (const nombre of san?.altNames ?? []) {
    if (nombre.type !== 0 || !Array.isArray(nombre.value)) continue; // 0 = otherName
    try {
      if (forge.asn1.derToOid(nombre.value[0]?.value as string) !== OID_RUT_SAN) continue;
      const interno = (nombre.value[1]?.value as forge.asn1.Asn1[] | undefined)?.[0]?.value;
      const rut = typeof interno === 'string' ? comoRut(interno) : null;
      if (rut) return rut;
    } catch {
      // otherName con otra forma: se sigue con los demás campos
    }
  }
  return null;
}
