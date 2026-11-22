// Pestañas Abiertas / Cerradas (o las que sean) con su cuenta, para el comprador y el proveedor.
export function Pestanas<P extends string>({ etiqueta, pestanas, activa, onCambio }: {
  etiqueta: string; pestanas: readonly (readonly [id: P, titulo: string, cuenta: number])[]; activa: P; onCambio: (p: P) => void;
}) {
  return (
    <div className="bm-pestanas" role="tablist" aria-label={etiqueta}>
      {pestanas.map(([id, titulo, n]) => (
        <button key={id} type="button" role="tab" aria-selected={activa === id} className={activa === id ? 'activa' : ''} onClick={() => onCambio(id)}>
          {titulo} <span>{n}</span>
        </button>
      ))}
    </div>
  );
}
