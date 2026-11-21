// Órdenes de ejemplo: solo se muestran mientras no hay ninguna real guardada (sin red, sin archivo OCDS y sin ticket).
// Tienen la forma de la API, pasan por el mismo normalizador y son siempre iguales para el mismo día. Proveedores, RUT y
// organismos son ficticios y lo dicen en el nombre. Nunca se guardan.
import { createHash } from 'node:crypto';
import { digitoVerificador } from '../../shared/rut.ts';
import type { ItemApi, OrdenApi } from './api.ts';
import { normalizarOrden, type OrdenMP } from './normalizar.ts';
import { sumarDias } from './sincronizar.ts';

const rutDeEjemplo = (cuerpo: string) => `${cuerpo.slice(0, 2)}.${cuerpo.slice(2, 5)}.${cuerpo.slice(5)}-${digitoVerificador(cuerpo)}`;

const PROVEEDORES = [
  { Codigo: '900001', Nombre: 'Distribuidora Ejemplo Sur SpA', RutSucursal: rutDeEjemplo('77000001'), Comuna: 'San Bernardo', Region: 'Región Metropolitana de Santiago' },
  { Codigo: '900002', Nombre: 'Abarrotes de Ejemplo Ltda.', RutSucursal: rutDeEjemplo('77000002'), Comuna: 'Quilicura', Region: 'Región Metropolitana de Santiago' },
  { Codigo: '900003', Nombre: 'Frutas y Verduras Ejemplo SpA', RutSucursal: rutDeEjemplo('77000003'), Comuna: 'Pedro Aguirre Cerda', Region: 'Región Metropolitana de Santiago' },
  { Codigo: '900004', Nombre: 'Comercial Ejemplo Biobío SpA', RutSucursal: rutDeEjemplo('77000004'), Comuna: 'Concepción', Region: 'Región del Biobío' },
];

const COMPRADORES = [
  { NombreOrganismo: 'Liceo de Ejemplo N° 1', ComunaUnidad: 'Santiago', RegionUnidad: 'Región Metropolitana de Santiago' },
  { NombreOrganismo: 'Hospital de Ejemplo', ComunaUnidad: 'Ñuñoa', RegionUnidad: 'Región Metropolitana de Santiago' },
  { NombreOrganismo: 'Municipalidad de Ejemplo', ComunaUnidad: 'Maipú', RegionUnidad: 'Región Metropolitana de Santiago' },
  { NombreOrganismo: 'Jardín Infantil de Ejemplo', ComunaUnidad: 'Talcahuano', RegionUnidad: 'Región del Biobío' },
];

const ALIMENTOS = 'Alimentos, bebidas y tabaco';
const ASEO = 'Equipos de limpieza y suministros';
/** [producto, categoría, rubro, código ONU, unidad, precio neto de base] */
const PRODUCTOS: [string, string, string, number, string, number][] = [
  ['Arroz grado 2, bolsa 1 kg', 'Arroz', ALIMENTOS, 50221101, 'Unidad', 1090],
  ['Aceite vegetal maravilla 1 L', 'Aceites vegetales comestibles', ALIMENTOS, 50151513, 'Unidad', 1890],
  ['Harina sin polvos de hornear, saco 25 kg', 'Harina de trigo', ALIMENTOS, 50221201, 'Saco', 17400],
  ['Azúcar granulada 1 kg', 'Azúcar', ALIMENTOS, 50161509, 'Unidad', 1050],
  ['Leche entera larga vida 1 L', 'Leche', ALIMENTOS, 50131701, 'Unidad', 990],
  ['Pechuga de pollo deshuesada', 'Pollo', ALIMENTOS, 50112004, 'Kilogramo', 5290],
  ['Papa lavada, saco 25 kg', 'Papas', ALIMENTOS, 50407100, 'Saco', 11900],
  ['Tomate larga vida', 'Tomates', ALIMENTOS, 50407170, 'Kilogramo', 1290],
  ['Huevo blanco, bandeja 30 unidades', 'Huevos', ALIMENTOS, 50131600, 'Bandeja', 5990],
  ['Pan hallulla', 'Pan', ALIMENTOS, 50181901, 'Kilogramo', 1890],
  ['Detergente líquido 5 L', 'Detergentes', ASEO, 47131807, 'Unidad', 6490],
  ['Toalla de papel, rollo 250 m', 'Toallas de papel', ASEO, 14111703, 'Rollo', 4590],
];

/** Número fijo entre 0 y 1 para una semilla: los datos de un día son siempre los mismos. */
const azar = (semilla: string) => createHash('sha256').update(semilla).digest().readUInt32BE(0) / 2 ** 32;

function ordenDeEjemplo(dia: string, n: number): OrdenApi {
  const semilla = `${dia}#${n}`;
  const proveedor = PROVEEDORES[Math.floor(azar(`${semilla}p`) * PROVEEDORES.length)]!;
  const comprador = COMPRADORES[Math.floor(azar(`${semilla}c`) * COMPRADORES.length)]!;
  const desde = Math.floor(azar(`${semilla}i`) * PRODUCTOS.length);
  const items = [0, 1, 2].map((k): ItemApi => {
    const [producto, categoria, rubro, codigo, unidad, base] = PRODUCTOS[(desde + k * 5) % PRODUCTOS.length]!;
    return {
      Correlativo: k + 1, CodigoProducto: codigo, Categoria: `${rubro} / ${categoria}`, EspecificacionProveedor: producto,
      Cantidad: 10 + Math.floor(azar(`${semilla}${k}q`) * 90), Unidad: unidad, Moneda: 'CLP',
      PrecioNeto: Math.round(base * (0.92 + azar(`${semilla}${k}$`) * 0.16)), // ±8 % alrededor del precio de base
    };
  });
  const hora = `${dia}T${String(9 + n).padStart(2, '0')}:15:00`;
  return {
    Codigo: `EJEMPLO-${dia.replaceAll('-', '')}-${n + 1}`,
    Nombre: `Compra de alimentos e insumos de aseo (ejemplo ${n + 1})`,
    CodigoEstado: 6,
    TipoMoneda: 'CLP',
    Fechas: { FechaCreacion: hora, FechaEnvio: hora },
    Comprador: comprador,
    Proveedor: proveedor,
    Items: { Cantidad: items.length, Listado: items },
  };
}

/** Cinco órdenes por día en los `dias` anteriores a `hoy` (`AAAA-MM-DD`). */
export function ordenesDeEjemplo(hoy: string, dias = 3, porDia = 5): OrdenMP[] {
  return Array.from({ length: dias }, (_, d) => sumarDias(hoy, -1 - d))
    .flatMap(dia => Array.from({ length: porDia }, (_, n) => normalizarOrden(ordenDeEjemplo(dia, n), dia)!));
}
