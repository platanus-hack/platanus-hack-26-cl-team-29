// Tablero de la canasta para las pantallas que se proyectan: una fila por producto con su precio de hoy,
// el de comprar solo, el avance al siguiente tramo y el proveedor que va ganando.

import { useEffect, useRef, useState } from 'react';
import { avanceAlSiguiente } from './Escalera.tsx';
import { Icono, iconoProducto, Monograma } from './Iconos.tsx';
import { firmasDeCanasta, productoQueCambio, type ProductoSala } from '../red/derivar.ts';
import { dinero } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import '../vistas/canasta.css';

/** Avance de un producto en dos partes: las unidades ("32 cajas") y lo que falta ("faltan 18 para $25.900"). */
export function textoAvance(p: ProductoSala): { unidades: string; resto: string } {
  const t = p.tramos;
  const unidades = contar(t.totalUnidades, p.unidad.singular, p.unidad.plural);
  if (t.totalUnidades === 0) return { unidades: '', resto: 'Sé el primero en pedir' };
  if (!t.siguiente) return { unidades, resto: 'mejor precio alcanzado' };
  if (t.precioActual !== undefined && t.siguiente.precioUnitario >= t.precioActual) return { unidades, resto: 'ya bajó por oferta' };
  return { unidades, resto: `faltan ${t.siguiente.faltan} para ${dinero(t.siguiente.precioUnitario)}` };
}

/**
 * El producto que se movió último (unidades, precio u oferta ganadora). Parte en el primero.
 * `quietoMs`: tiempo mínimo antes de cambiar a otro producto, para que una columna en foco no salte a cada rato.
 */
export function useProductoDestacado(productos: ProductoSala[], quietoMs = 0): string | undefined {
  const firmas = firmasDeCanasta(productos);
  const clave = JSON.stringify(firmas);
  const previas = useRef(firmas);
  const desde = useRef(0);
  const [destacado, setDestacado] = useState<string | undefined>(undefined);
  useEffect(() => {
    const cambio = productoQueCambio(previas.current, firmas);
    previas.current = firmas;
    if (!cambio || Date.now() - desde.current < quietoMs) return;
    desde.current = Date.now();
    setDestacado(cambio);
    // `clave` resume `firmas`: el efecto corre solo cuando algo cambió de verdad.
  }, [clave]);
  return destacado && productos.some(p => p.id === destacado) ? destacado : productos[0]?.id;
}

function FilaProducto({ p, destacado, destello, logoEnSala }: { p: ProductoSala; destacado: boolean; destello: boolean; logoEnSala?: string }) {
  const precio = p.tramos.precioActual;
  const avance = textoAvance(p);
  return (
    <li className={`prod ${destacado ? 'destacado' : ''}`}>
      <span className="prod-icono"><Icono nombre={iconoProducto(p.nombre)} /></span>
      <span className="prod-info">
        <span className="prod-nombre">{p.corto}</span>
        <span className="avance prod-avance"><i style={{ width: `${avanceAlSiguiente(p.tramos) * 100}%` }} /></span>
        <span className="prod-faltan">
          {avance.unidades && <span className="prod-unidades">{avance.unidades} · </span>}{avance.resto}
        </span>
      </span>
      <span className="prod-precio">
        <strong key={precio} className={destello ? 'por-oferta' : ''}>{precio !== undefined ? dinero(precio) : '-'}</strong>
        <span className="prod-por">por {p.unidad.singular}</span>
      </span>
      <span className="prod-solo">
        {p.precioSolo !== undefined && <span className="tachado">{dinero(p.precioSolo)}</span>}
        <span className={p.porcentaje > 0 ? 'verde' : 'tenue'}>{p.porcentaje > 0 ? `-${p.porcentaje}%` : 'precio solo'}</span>
      </span>
      <span className={`prod-lider ${p.lider ? '' : 'vacio'}`} key={p.lider?.clave ?? 'sin'}>
        {p.lider ? (
          <>
            <Monograma nombre={p.lider.proveedor} logoUrl={p.lider.enEscenario ? logoEnSala : undefined} />
            <span className="prod-lider-texto">
              <span className="nombre">{p.lider.proveedor}</span>
              <span className="prod-lider-pie">va ganando{p.proveedores > 1 ? ` · ${contar(p.proveedores, 'proveedor')}` : ''}</span>
            </span>
            <span className="prod-lider-corto">gana</span>
          </>
        ) : (
          <span className="prod-lider-pie">{p.proveedores ? 'gana el volumen' : 'esperando ofertas'}</span>
        )}
      </span>
    </li>
  );
}

/** `destellos`: productos cuyo precio acaba de bajar por una oferta (se anima en su fila). */
export function TableroCanasta({ productos, destacado, destellos = [], logoEnSala, className = '' }: {
  productos: ProductoSala[]; destacado?: string; destellos?: string[]; logoEnSala?: string; className?: string;
}) {
  return (
    <ul className={`tablero-canasta ${className}`}>
      {productos.map(p => (
        <FilaProducto key={p.id} p={p} destacado={p.id === destacado && productos.length > 1} destello={destellos.includes(p.id)} logoEnSala={logoEnSala} />
      ))}
    </ul>
  );
}
