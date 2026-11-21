// CAF (Código de Autorización de Folios): el rango de folios que el SII autorizó y la llave con que se timbra.
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import type { Element } from '@xmldom/xmldom';
import { parsearXml } from './c14n.ts';
import { normalizarRut } from './texto.ts';

export interface Caf {
  readonly tipo: number;
  readonly folioDesde: number;
  readonly folioHasta: number;
  readonly rutEmisor: string;
  /** `FA`, `AAAA-MM-DD`. */
  readonly fechaAutorizacion: string;
  /** `<CAF>` tal como va dentro del TED: sin espacios entre etiquetas y sin ningún otro cambio. */
  readonly xml: string;
  /** Llave privada del rango (`RSASK`). */
  readonly llave: KeyObject;
}

/** Tipos cuyo CAF vence a los 6 meses de su autorización; el SII rechaza lo timbrado con uno vencido. */
const TIPOS_QUE_VENCEN = [33, 46, 56, 61];

/**
 * Lee un CAF. El archivo es ISO-8859-1 y se decodifica byte a byte: la `RS` va firmada por el SII y un solo
 * carácter mal decodificado invalida el timbre. Comprueba que la llave privada corresponda al módulo publicado.
 */
export function leerCaf(bytes: Buffer): Caf {
  const texto = bytes.toString('latin1');
  const raiz = parsearXml(texto).documentElement;
  const primero = (padre: Element | null | undefined, nombre: string): Element | null =>
    (padre?.getElementsByTagName(nombre).item(0) as Element | null) ?? null;
  const valor = (padre: Element | null | undefined, nombre: string): string =>
    (primero(padre, nombre)?.textContent ?? '').trim();

  const da = primero(raiz, 'DA');
  const rango = primero(da, 'RNG');
  const xmlCaf = /<CAF(?=[\s>])[\s\S]*?<\/CAF>/.exec(texto)?.[0];
  const llavePem = valor(raiz, 'RSASK');
  if (raiz?.tagName !== 'AUTORIZACION' || !da || !rango || !xmlCaf || !llavePem) {
    throw new Error('CAF inválido: falta AUTORIZACION, DA, RNG, CAF o RSASK.');
  }
  const caf = {
    tipo: Number(valor(da, 'TD')),
    folioDesde: Number(valor(rango, 'D')),
    folioHasta: Number(valor(rango, 'H')),
    rutEmisor: normalizarRut(valor(da, 'RE')),
    fechaAutorizacion: valor(da, 'FA'),
    xml: xmlCaf.replace(/>\s+</g, '><'),
    llave: createPrivateKey(llavePem),
  };
  if (![caf.tipo, caf.folioDesde, caf.folioHasta].every(Number.isSafeInteger) || caf.folioDesde > caf.folioHasta) {
    throw new Error('CAF inválido: tipo o rango de folios ilegible.');
  }
  const publicado = Buffer.from(valor(primero(da, 'RSAPK'), 'M').replace(/\s+/g, ''), 'base64');
  const propio = Buffer.from(createPublicKey(caf.llave).export({ format: 'jwk' }).n ?? '', 'base64url');
  if (!sinCeros(publicado).equals(sinCeros(propio))) {
    throw new Error('CAF inválido: la llave privada no corresponde a la llave pública del CAF.');
  }
  return caf;
}

const sinCeros = (b: Buffer): Buffer => b.subarray(b.findIndex(x => x !== 0));

/** Primer día en que el CAF ya no sirve (`FA` + 6 meses de calendario), o null si el tipo no vence. */
export function primerDiaVencido(caf: Pick<Caf, 'tipo' | 'fechaAutorizacion'>): string | null {
  if (!TIPOS_QUE_VENCEN.includes(caf.tipo)) return null;
  const [anio, mes, dia] = caf.fechaAutorizacion.split('-').map(Number) as [number, number, number];
  const ultimoDelMes = new Date(Date.UTC(anio, mes + 6, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes + 5, Math.min(dia, ultimoDelMes))).toISOString().slice(0, 10);
}

/** Lo que el SII comprueba al recibir: tipo, emisor, folio dentro del rango y CAF vigente. */
export function validarCaf(caf: Caf, tipo: number, rutEmisor: string, folio: number, hoy: string): void {
  if (caf.tipo !== tipo) throw new Error(`El CAF es del tipo ${caf.tipo} y el documento del tipo ${tipo}.`);
  if (caf.rutEmisor !== normalizarRut(rutEmisor)) {
    throw new Error(`El CAF es del emisor ${caf.rutEmisor}, no de ${rutEmisor}.`);
  }
  if (folio < caf.folioDesde || folio > caf.folioHasta) {
    throw new Error(`El folio ${folio} está fuera del rango del CAF (${caf.folioDesde} a ${caf.folioHasta}).`);
  }
  const vence = primerDiaVencido(caf);
  if (vence !== null && hoy >= vence) throw new Error(`El CAF del tipo ${tipo} venció el ${vence}.`);
}
