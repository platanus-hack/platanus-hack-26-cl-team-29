// Una fila de producto del panel del proveedor: ícono, nombre con su detalle y sus acciones a la derecha; debajo, lo
// que se abre en la misma fila (editar una oferta). La usan su lista de productos y sus compras en grupo.
import type { ReactNode } from 'react';
import { Icono, iconoDeProducto } from '../canal/iconos.tsx';

export function FilaProducto({ nombre, children, acciones, debajo }: { nombre: string; children: ReactNode; acciones: ReactNode; debajo?: ReactNode }) {
  return (
    <li className="bp-fila bp-producto">
      <span className="bp-fila-icono"><Icono nombre={iconoDeProducto(nombre)} tam={22} /></span>
      <div className="bp-fila-texto"><strong>{nombre}</strong>{children}</div>
      <div className="bp-producto-acciones">{acciones}</div>
      {debajo}
    </li>
  );
}
