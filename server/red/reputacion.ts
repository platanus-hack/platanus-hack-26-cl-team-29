import type { EventoReputacion } from './tipos.ts';

// Nota del proveedor, de 1 a 5 con un decimal, calculada solo desde sus eventos:
//
//   nota = 4.6
//        + 0.05 por cada entrega_conforme
//        - 0.8  por cada reclamo
//        + 0.5  por cada nota_credito_mismo_dia (recupera parte del reclamo, no todo)
//
// y se acota a [1, 5]. Un reclamo pesa más que muchas entregas buenas; corregirlo el
// mismo día devuelve buena parte de la confianza, pero queda una marca.

export const NOTA_BASE = 4.6;
const PESOS: Record<EventoReputacion['tipo'], number> = {
  entrega_conforme: 0.05,
  reclamo: -0.8,
  nota_credito_mismo_dia: 0.5,
};

export function calcularNota(eventos: EventoReputacion[], proveedorId: string): number {
  const suma = eventos
    .filter(e => e.proveedorId === proveedorId)
    .reduce((nota, e) => nota + PESOS[e.tipo], NOTA_BASE);
  const acotada = Math.min(5, Math.max(1, suma));
  return Math.round(acotada * 10 + 1e-9) / 10;
}
