// "Ruta de reparto" del panel del proveedor: después de vender, los negocios que esperan su pedido en el orden más
// corto para salir de la bodega y volver, en un mapa y en una hoja de ruta. Cada parada lleva su guía de despacho
// (52); las que faltan se emiten en el SII desde aquí, con un paso de confirmación. Se actualiza sola: vuelve a
// pedir la ruta cada vez que cambian los pedidos por entregar o sus guías.

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { kilometros } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { POR_ENTREGAR, type ParadaReparto, type RutaReparto as Ruta } from '../../../shared/ruta.ts';
import type { CanalApi } from './api.ts';
import { Icono, LogoSii } from './iconos.tsx';
import { mensajeDeError, unidadPara } from './logica.ts';
import { Confirmar, EstadoSii, useConfirmacion } from './piezas.tsx';
import type { ConfigRed, YoProveedor } from './tipos.ts';

const MapaRuta = lazy(() => import('./MapaRuta.tsx'));

const minutos = (n: number) => (n < 60 ? `${n} min` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')} h`);

interface Props {
  api: CanalApi;
  token: string;
  yo: YoProveedor;
  config: ConfigRed | null;
  alCambiar: () => void;
}

export function RutaReparto({ api, token, yo, config, alCambiar }: Props) {
  const porEntregar = yo.ordenes.filter(o => POR_ENTREGAR.includes(o.estado));
  const conGuia = new Set(yo.documentos.filter(d => d.tipo === 52).map(d => d.ordenId));
  const sinGuia = porEntregar.filter(o => !conGuia.has(o.id)).length;
  // Cambia cuando entra o sale un pedido por entregar o cuando una guía cambia de estado: ahí se vuelve a pedir la ruta.
  const clave = porEntregar.map(o => o.id).join(',') + '|' + yo.documentos.filter(d => d.tipo === 52).map(d => `${d.id}:${d.estadoSii}`).join(',');
  const [ruta, setRuta] = useState<Ruta | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!porEntregar.length) return setRuta(null);
    let activo = true;
    api.rutaReparto(token)
      .then(r => { if (activo) { setRuta(r); setError(''); } })
      .catch((e: unknown) => { if (activo) setError(mensajeDeError(e, 'No pudimos calcular la ruta.')); });
    return () => { activo = false; };
    // `clave` resume lo que cambia la ruta.
  }, [api, token, clave, porEntregar.length]);

  const emitir = useCallback(async () => {
    await api.emitirGuias(token);
    alCambiar();
  }, [api, token, alCambiar]);
  const c = useConfirmacion<'guias'>(emitir);

  if (!porEntregar.length) return null;

  return (
    <section className="cn-seccion">
      <h2 className="cn-titulo cn-con-icono"><Icono nombre="camion" tam={24} /><span>Ruta de reparto</span></h2>
      <div className="tarjeta cn-ruta">
        {error && <p className="error">{error}</p>}
        {!ruta ? <p className="mono tenue">Calculando la ruta más corta...</p> : (
          <>
            <dl className="cn-cifras cn-cifras-3">
              <div><dt>Paradas</dt><dd>{ruta.paradas.length}</dd></div>
              <div><dt>Recorrido</dt><dd>{kilometros(ruta.distanciaKm)}</dd></div>
              <div><dt>Manejando</dt><dd>{minutos(ruta.duracionMin)}</dd></div>
            </dl>
            <Suspense fallback={<div className="cn-ruta-mapa" />}><MapaRuta ruta={ruta} /></Suspense>
            <p className="mono tenue cn-texto">
              {ruta.porCalles ? 'Por calles, saliendo de tu bodega y volviendo a ella.' : 'Distancia aproximada en línea recta, saliendo de tu bodega y volviendo a ella.'}
              {ruta.paradas.some(p => p.aproximado) && ' Los negocios sin dirección ubicada aparecen en su comuna.'}
            </p>

            {sinGuia > 0 && c.estado.fase === 'nada' && (
              <button type="button" className="boton cn-ancho cn-boton-sii" onClick={() => c.pedir('guias')}>
                <LogoSii /> Emitir {contar(sinGuia, 'guía de despacho', 'guías de despacho')}
              </button>
            )}
            {c.estado.fase !== 'nada' && (
              <Confirmar sii titulo={`¿Emites ${contar(sinGuia, 'guía de despacho', 'guías de despacho')} en el SII?`} si="Sí, emitir" {...c.panel}>
                <p>Una guía por pedido, con lo que llevas a cada negocio. Acompaña la mercadería en el reparto.</p>
              </Confirmar>
            )}
            {ruta.googleMaps && (
              <a className="boton secundario cn-ancho" href={ruta.googleMaps.url} target="_blank" rel="noopener noreferrer">
                Abrir en Google Maps
              </a>
            )}
            {ruta.googleMaps && ruta.googleMaps.paradas < ruta.paradas.length && (
              <p className="mono tenue cn-texto">Google Maps abre las primeras {ruta.googleMaps.paradas} paradas.</p>
            )}

            <h3 className="etiqueta cn-sub">Hoja de ruta</h3>
            <ol className="cn-hoja">
              {ruta.paradas.map(p => <Parada key={p.negocioId} parada={p} config={config} />)}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function Parada({ parada: p, config }: { parada: ParadaReparto; config: ConfigRed | null }) {
  const lleva = p.items.map(i => {
    const u = unidadPara(i.producto, config);
    return `${i.producto}, ${contar(i.cantidad, u.singular, u.plural)}`;
  }).join('; ');
  return (
    <li>
      <span className="cn-hoja-numero" aria-label={`Parada ${p.orden}`}>{p.orden}</span>
      <div className="cn-hoja-detalle">
        <strong className="nombre">{p.nombre}</strong>
        <span className="mono tenue">{p.direccion ? `${p.direccion}, ${p.comuna}` : p.comuna}</span>
        <span className="cn-hoja-lleva">{lleva}</span>
        {p.guias.length ? p.guias.map(g => (
          <span key={g.folio} className="cn-hoja-guia">
            <LogoSii tam={16} /> Guía folio {g.folio} <EstadoSii estado={g.estadoSii} />
            {g.pdfUrl && <a href={g.pdfUrl} target="_blank" rel="noopener noreferrer">PDF</a>}
          </span>
        )) : <span className="mono tenue">Sin guía de despacho todavía</span>}
      </div>
    </li>
  );
}
