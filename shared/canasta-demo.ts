// La canasta por defecto de la compra conjunta (docs/decisiones/20261121-1130-contrato-red.md). La usan la red
// (cuando no hay DEMO_PRODUCTOS) y las implementaciones falsas del front, para que todas muestren lo mismo.
import type { Tramo } from './precios.ts';

export interface ProductoDeCanasta {
  id: string;
  nombre: string;
  unidad: string;
  unidadPlural: string;
  precioSolo: number;
  tramos: Tramo[];
}

const tramos = (...pares: [number, number][]): Tramo[] => pares.map(([desde, precioUnitario]) => ({ desde, precioUnitario }));

export const CANASTA_DEMO: readonly ProductoDeCanasta[] = [
  { id: 'rollos', nombre: 'Caja de rollos térmicos 80 mm (50 un.)', unidad: 'caja', unidadPlural: 'cajas', precioSolo: 32_000, tramos: tramos([1, 32_000], [10, 29_900], [25, 27_900], [50, 25_900], [100, 24_500]) },
  { id: 'etiquetas', nombre: 'Rollo de etiquetas adhesivas 50x30 (1.000 un.)', unidad: 'rollo', unidadPlural: 'rollos', precioSolo: 6_900, tramos: tramos([1, 6_900], [10, 6_400], [25, 5_900], [50, 5_500]) },
  { id: 'bolsas', nombre: 'Paquete de bolsas camiseta (1.000 un.)', unidad: 'paquete', unidadPlural: 'paquetes', precioSolo: 14_900, tramos: tramos([1, 14_900], [10, 13_900], [25, 12_900], [50, 11_900]) },
  { id: 'guantes', nombre: 'Caja de guantes de nitrilo (100 un.)', unidad: 'caja', unidadPlural: 'cajas', precioSolo: 8_900, tramos: tramos([1, 8_900], [10, 8_200], [25, 7_600], [50, 7_100]) },
];

/** Lo mínimo que ofrece el proveedor de la sala por los rollos (DEMO_PRECIO_PISO). */
export const PISO_ROLLOS_DEMO = 23_900;

/** Piso por defecto de un producto: 80 % del primer tramo, redondeado a $10. */
export const pisoPorDefecto = (t: readonly Tramo[], precioSolo: number): number => Math.round((0.8 * (t[0]?.precioUnitario ?? precioSolo)) / 10) * 10;
