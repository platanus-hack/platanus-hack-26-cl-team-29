// GET que se vuelve a pedir con cada `red:evento` (la clave del último evento de useRed): así la vista nunca depende
// de recargar. Lo usan /proveedores y la capa de proveedores de los mapas.

import { useEffect, useState } from 'react';

export function useJson<T>(url: string | null, evento: number | undefined) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) return;
    let activo = true;
    const t = setTimeout(() => {
      fetch(url, { headers: { accept: 'application/json' } })
        .then(async r => {
          if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw new Error(r.status === 404 ? 'No encontramos ese proveedor.' : 'No pudimos cargar los proveedores.');
          return r.json() as Promise<T>;
        })
        .then(d => { if (activo) { setDatos(d); setError(''); } })
        .catch((e: Error) => activo && setError(e.message));
    }, 150);
    return () => { activo = false; clearTimeout(t); };
  }, [url, evento]);
  return { datos, error };
}
