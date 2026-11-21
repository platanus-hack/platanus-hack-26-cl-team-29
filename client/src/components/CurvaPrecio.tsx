import type { PuntoCurva } from '../red/derivar.ts';
import { dinero } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { useTamano } from './medidas.ts';

const MARGEN = { arriba: 28, abajo: 30, izq: 4, der: 12 };

/**
 * Curva escalonada del precio ganador: baja cada vez que un proveedor mejora su oferta.
 * Ocupa todo el alto y ancho de su caja, para que la pantalla proyectada no haga scroll.
 */
export function CurvaPrecio({ puntos, precioSolo }: { puntos: PuntoCurva[]; precioSolo?: number }) {
  const [ref, { ancho, alto }] = useTamano<HTMLDivElement>();
  return (
    <div className="curva-caja" ref={ref}>
      {puntos.length >= 2 && ancho > 0 && alto > 60 && <Trazo puntos={puntos} precioSolo={precioSolo} ancho={ancho} alto={alto} />}
    </div>
  );
}

function Trazo({ puntos, precioSolo, ancho, alto }: { puntos: PuntoCurva[]; precioSolo?: number; ancho: number; alto: number }) {
  const precios = puntos.map(p => p.precio);
  const max = Math.max(...precios, precioSolo ?? 0);
  const min = Math.min(...precios);
  const rango = Math.max(1, max - min);
  const xMin = puntos[0].compradores;
  const xMax = Math.max(xMin + 1, puntos.at(-1)!.compradores);
  const x = (c: number) => MARGEN.izq + ((c - xMin) / (xMax - xMin)) * (ancho - MARGEN.izq - MARGEN.der);
  const y = (p: number) => MARGEN.arriba + ((max - p) / rango) * (alto - MARGEN.arriba - MARGEN.abajo);

  let d = `M${x(puntos[0].compradores)} ${y(puntos[0].precio)}`;
  for (let i = 1; i < puntos.length; i++) d += ` H${x(puntos[i].compradores)} V${y(puntos[i].precio)}`;
  const bajadas = puntos.slice(1, -1);
  const ultimo = puntos.at(-1)!;
  const medio = puntos[Math.floor(puntos.length / 2)];
  const base = alto - 8;

  return (
    <svg className="curva" width={ancho} height={alto} role="img" aria-label={`El precio bajó de ${dinero(puntos[0].precio)} a ${dinero(ultimo.precio)}`}>
      {precioSolo !== undefined && (
        <>
          <line x1={MARGEN.izq} x2={ancho - MARGEN.der} y1={y(precioSolo)} y2={y(precioSolo)} stroke="#555" strokeDasharray="4 6" />
          <text x={MARGEN.izq} y={y(precioSolo) - 8}>{dinero(precioSolo)} precio que paga cada uno solo</text>
        </>
      )}
      <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth={3} strokeLinejoin="round" />
      {bajadas.map((p, i) => (
        <circle key={i} cx={x(p.compradores)} cy={y(p.precio)} r={5} fill="var(--color-magenta)" />
      ))}
      <circle cx={x(ultimo.compradores)} cy={y(ultimo.precio)} r={7} fill="var(--color-primary)" />
      <text x={MARGEN.izq} y={base}>{contar(puntos[0].compradores, 'negocio')}</text>
      {x(medio.compradores) - x(puntos[0].compradores) > 90 && x(ultimo.compradores) - x(medio.compradores) > 70 && (
        <text x={x(medio.compradores)} y={base} textAnchor="middle">{medio.compradores}</text>
      )}
      <text className="ahora" x={ancho - MARGEN.der} y={base} textAnchor="end">{ultimo.compradores} ahora</text>
    </svg>
  );
}
