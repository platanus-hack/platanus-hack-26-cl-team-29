// "Ruta de reparto" del panel del proveedor: después de vender, los negocios que esperan su pedido en el orden más
// corto para salir de la bodega y volver, en un mapa y en una hoja de ruta. Cada parada lleva su guía de despacho
// (52); las que faltan se emiten en el SII desde aquí, con un paso de confirmación. Se actualiza sola: vuelve a
// pedir la ruta cada vez que cambian los pedidos por entregar o sus guías.

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { kilometros } from '../../../shared/formato.ts';
import { contar } from '../../../shared/texto.ts';
import { POR_ENTREGAR, type ParadaReparto, type RutaReparto as Ruta } from '../../../shared/ruta.ts';
import type { CanalApi } from './api.ts';
import { LogoSii } from '../marca/LogoSii.tsx';
import { ILUSTRACION } from '../marca/recursos.ts';
import { Boton, BotonEnlace, Estado, EstadoVacio, type TonoEstado } from '../marca/componentes.tsx';
import { textoEstadoSii } from '../red/formato.ts';
import { mensajeDeError, unidadPara } from './logica.ts';
import { Confirmar, useConfirmacion } from './piezas.tsx';
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

  if (!porEntregar.length) {
    return (
      <div className="bp-pagina">
        <Cabecera />
        <EstadoVacio ilustracion={ILUSTRACION.camion} titulo="No tienes pedidos por entregar" texto="Cuando confirmes pedidos, aquí aparece la ruta más corta para repartirlos." />
      </div>
    );
  }

  const enCurso = c.estado.fase !== 'nada';
  return (
    <div className="bp-pagina">
      <Cabecera />
      {error && <p className="bm-error">{error}</p>}
      {!ruta ? <p className="bp-nada">Calculando la ruta más corta...</p> : (
        <div className="bp-columnas">
          <section className="bm-tarjeta bp-ruta">
            <dl className="bp-ruta-cifras">
              <div><dt>Paradas</dt><dd>{ruta.paradas.length}</dd></div>
              <div><dt>Recorrido</dt><dd>{kilometros(ruta.distanciaKm)}</dd></div>
              <div><dt>Manejando</dt><dd>{minutos(ruta.duracionMin)}</dd></div>
            </dl>
            <Suspense fallback={<div className="bp-ruta-mapa" />}><MapaRuta ruta={ruta} /></Suspense>
            <p className="bp-tenue">
              {ruta.porCalles ? 'Por calles, saliendo de tu bodega y volviendo a ella.' : 'Distancia aproximada en línea recta, saliendo de tu bodega y volviendo a ella.'}
              {ruta.paradas.some(p => p.aproximado) && ' Los negocios sin dirección ubicada aparecen en su comuna.'}
            </p>
            <div className="bp-ruta-acciones">
              {sinGuia > 0 && !enCurso && (
                <Boton variante="sii" onClick={() => c.pedir('guias')}>Emitir {contar(sinGuia, 'guía de despacho', 'guías de despacho')}</Boton>
              )}
              {ruta.googleMaps && (
                <BotonEnlace variante="secundario" href={ruta.googleMaps.url} target="_blank" rel="noopener noreferrer">Abrir en Google Maps</BotonEnlace>
              )}
            </div>
            {enCurso && (
              <Confirmar sii titulo={`¿Emites ${contar(sinGuia, 'guía de despacho', 'guías de despacho')} en el SII?`} si="Sí, emitir" {...c.panel}>
                <p>Una guía por pedido, con lo que llevas a cada negocio. Acompaña la mercadería en el reparto.</p>
              </Confirmar>
            )}
            {ruta.googleMaps && ruta.googleMaps.paradas < ruta.paradas.length && (
              <p className="bp-tenue">Google Maps abre las primeras {ruta.googleMaps.paradas} paradas.</p>
            )}
          </section>

          <section className="bm-tarjeta bp-bloque">
            <header className="bp-bloque-cabecera"><h2>Hoja de ruta</h2><span>{contar(ruta.paradas.length, 'parada')}</span></header>
            <ol className="bp-filas">
              {ruta.paradas.map(p => <Parada key={p.negocioId} parada={p} config={config} />)}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

function Cabecera() {
  return (
    <header className="bm-cabecera">
      <div>
        <h1 className="bm-titulo">Reparto</h1>
        <p className="bm-bajada">La ruta más corta para entregar tus pedidos, con la guía de despacho de cada parada.</p>
      </div>
    </header>
  );
}

const TONO_SII: Record<string, TonoEstado> = { aceptado: 'exito', enviando: 'info', recibido: 'info', reparo: 'aviso', rechazado: 'error', fallido: 'error' };

function Parada({ parada: p, config }: { parada: ParadaReparto; config: ConfigRed | null }) {
  const lleva = p.items.map(i => {
    const u = unidadPara(i.producto, config);
    return `${i.producto}, ${contar(i.cantidad, u.singular, u.plural)}`;
  }).join('; ');
  return (
    <li className="bp-fila bp-parada">
      <span className="bp-parada-numero" aria-label={`Parada ${p.orden}`}>{p.orden}</span>
      <div className="bp-fila-texto">
        <strong>{p.nombre}</strong>
        <span>{p.direccion ? `${p.direccion}, ${p.comuna}` : p.comuna}</span>
        <span>{lleva}</span>
        {p.guias.length ? p.guias.map(g => (
          <span key={g.folio} className="bp-parada-guia">
            <LogoSii tam={14} /> Guía folio {g.folio}
            {textoEstadoSii(g.estadoSii) && <Estado tono={TONO_SII[g.estadoSii] ?? 'neutro'}>{textoEstadoSii(g.estadoSii)}</Estado>}
            {g.pdfUrl && <a href={g.pdfUrl} target="_blank" rel="noopener noreferrer">PDF</a>}
          </span>
        )) : <span>Sin guía de despacho todavía</span>}
      </div>
    </li>
  );
}
