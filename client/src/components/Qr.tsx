import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Código QR en SVG, generado en el navegador. */
export function Qr({ texto, className }: { texto: string; className?: string }) {
  const { tam, camino } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (qr.isDark(f, c)) d += `M${c} ${f}h1v1h-1z`;
    return { tam: n, camino: d };
  }, [texto]);
  return (
    <svg className={className} viewBox={`0 0 ${tam} ${tam}`} shapeRendering="crispEdges" role="img" aria-label={`Código QR: ${texto}`}>
      <path d={camino} style={{ fill: 'var(--bando-tinta)' }} />
    </svg>
  );
}
