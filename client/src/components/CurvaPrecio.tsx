import type { PuntoCurva } from '../red/derivar.ts';
import { dinero } from '../red/formato.ts';

const ANCHO = 560;
const ALTO = 220;
const MARGEN = { arriba: 28, abajo: 28, izq: 4, der: 12 };

/** Curva escalonada del precio ganador: baja cada vez que un proveedor mejora su oferta. */
export function CurvaPrecio({ puntos, precioSolo }: { puntos: PuntoCurva[]; precioSolo?: number }) {
  if (puntos.length < 2) return null;
  const precios = puntos.map(p => p.precio);
  const max = Math.max(...precios, precioSolo ?? 0);
  const min = Math.min(...precios);
  const rango = Math.max(1, max - min);
  const xMin = puntos[0].compradores;
  const xMax = Math.max(xMin + 1, puntos.at(-1)!.compradores);
  const x = (c: number) => MARGEN.izq + ((c - xMin) / (xMax - xMin)) * (ANCHO - MARGEN.izq - MARGEN.der);
  const y = (p: number) => MARGEN.arriba + ((max - p) / rango) * (ALTO - MARGEN.arriba - MARGEN.abajo);

  let d = `M${x(puntos[0].compradores)} ${y(puntos[0].precio)}`;
  for (let i = 1; i < puntos.length; i++) d += ` H${x(puntos[i].compradores)} V${y(puntos[i].precio)}`;
  const bajadas = puntos.slice(1, -1);
  const ultimo = puntos.at(-1)!;
  const medio = puntos[Math.floor(puntos.length / 2)];

  return (
    <svg className="curva" viewBox={`0 0 ${ANCHO} ${ALTO + 16}`} role="img" aria-label={`El precio bajó de ${dinero(puntos[0].precio)} a ${dinero(ultimo.precio)}`}>
      {precioSolo !== undefined && (
        <>
          <line x1={MARGEN.izq} x2={ANCHO - MARGEN.der} y1={y(precioSolo)} y2={y(precioSolo)} stroke="#555" strokeDasharray="4 6" />
          <text x={MARGEN.izq} y={y(precioSolo) - 8}>{dinero(precioSolo)} precio que paga cada uno solo</text>
        </>
      )}
      <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth={3} strokeLinejoin="round" style={{ transition: 'd 0.6s' }} />
      {bajadas.map((p, i) => (
        <circle key={i} cx={x(p.compradores)} cy={y(p.precio)} r={5} fill="var(--color-magenta)" />
      ))}
      <circle cx={x(ultimo.compradores)} cy={y(ultimo.precio)} r={7} fill="var(--color-primary)" />
      <text x={MARGEN.izq} y={ALTO + 12}>{puntos[0].compradores} negocios</text>
      {medio !== ultimo && medio.compradores !== puntos[0].compradores && (
        <text x={x(medio.compradores)} y={ALTO + 12} textAnchor="middle">{medio.compradores}</text>
      )}
      <text className="ahora" x={ANCHO - MARGEN.der} y={ALTO + 12} textAnchor="end">{ultimo.compradores} ahora</text>
    </svg>
  );
}
