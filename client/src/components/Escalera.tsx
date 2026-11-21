import type { EstadoTramos } from '../red/derivar.ts';
import { contar, dinero } from '../red/formato.ts';

interface Props {
  tramos: EstadoTramos;
  unidad: { singular: string; plural: string };
  className?: string;
}

/** Avance hacia el siguiente tramo, de 0 a 1. */
export function avanceAlSiguiente(t: EstadoTramos): number {
  if (!t.siguiente) return 1;
  const tramo = t.siguiente.desde - t.desdeActual;
  return tramo > 0 ? Math.min(1, Math.max(0, (t.totalUnidades - t.desdeActual) / tramo)) : 0;
}

/** "Faltan 12 cajas para bajar a $27.900", o el aviso de que ya está en el mejor precio. */
export function textoFaltan(t: EstadoTramos, unidad: Props['unidad']): string {
  if (!t.siguiente) return 'Precio más bajo alcanzado';
  if (t.precioActual !== undefined && t.siguiente.precioUnitario >= t.precioActual) {
    // Sin nadie, el primer tramo es el precio de comprar solo. Con gente, un proveedor ya ofrece menos que el próximo tramo.
    return t.totalUnidades === 0 ? 'Sé el primero en sumarte' : 'Los proveedores ya bajaron más que el próximo tramo';
  }
  const n = t.siguiente.faltan;
  return `${n === 1 ? 'Falta' : 'Faltan'} ${contar(n, unidad.singular, unidad.plural)} para bajar a ${dinero(t.siguiente.precioUnitario)}`;
}

/** Escalera de precios por volumen: los tramos alcanzados, el actual y el siguiente con su barra de avance. */
export function Escalera({ tramos: t, unidad, className = '' }: Props) {
  return (
    <div className={`escalera ${className}`}>
      <ol className="peldanos">
        {t.tramos.map((tramo, i) => {
          const estado = i < t.alcanzados - 1 ? 'pasado' : i === t.alcanzados - 1 ? 'actual' : i === t.alcanzados ? 'siguiente' : 'futuro';
          return (
            <li key={tramo.desde} className={`peldano ${estado}`}>
              <span className="desde">{contar(tramo.desde, unidad.singular, unidad.plural)}</span>
              <span className="precio">{dinero(tramo.precioUnitario)}</span>
            </li>
          );
        })}
      </ol>
      <div className="avance" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(avanceAlSiguiente(t) * 100)}>
        <i style={{ width: `${avanceAlSiguiente(t) * 100}%` }} />
      </div>
      <p className="faltan">{textoFaltan(t, unidad)}</p>
    </div>
  );
}
