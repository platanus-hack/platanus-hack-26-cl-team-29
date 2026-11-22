// "Compras en grupo" del proveedor: las compras sin proveedor fijo donde compite (su lista entra sola o ofertó a mano),
// con su precio para el volumen que lleva el grupo, el mejor precio y si va ganando. Puede mejorar su oferta con sus
// propios tramos. En Cerradas, las que ganó o perdió. Todo se recalcula con cada `red:evento`.

import { useState, type FormEvent } from 'react';
import { dinero } from '../../../shared/formato.ts';
import { errorDeTramos, precioDeOferta } from '../../../shared/precios.ts';
import { contar } from '../../../shared/texto.ts';
import { estaAbierta } from '../canal/logica.ts';
import { useEnvio } from '../canal/piezas.tsx';
import type { FotoRed, LicitacionCanal, YoProveedor } from '../canal/tipos.ts';
import { cuentaRegresiva } from '../red/formato.ts';
import type { Oferta, ProductoCompra } from '../red/tipos.ts';
import { useAhora } from '../red/useRed.ts';
import { AccionesTramos, aFilas, aTramos, TablaTramos, useTramos } from './tramos.tsx';
import type { PropsAccion } from './Ventas.tsx';
import { FilaProducto } from './FilaProducto.tsx';
import { Pestanas } from '../comprador/Pestanas.tsx';

interface Fila { lic: LicitacionCanal; p: ProductoCompra; mia: Oferta }

export function Compras({ foto, yo, ...props }: PropsAccion & { foto: FotoRed; yo: YoProveedor }) {
  const ahora = useAhora();
  const [pestana, setPestana] = useState<'abiertas' | 'cerradas'>('abiertas');
  const filas: Fila[] = foto.licitaciones.filter(l => !l.proveedorId).flatMap(lic => (lic.productos ?? []).flatMap(p => {
    const mia = p.ofertas?.find(o => o.proveedorId === yo.proveedor.id);
    return mia ? [{ lic, p, mia }] : [];
  }));
  const abiertas = filas.filter(f => estaAbierta(f.lic, ahora));
  const cerradas = filas.filter(f => !estaAbierta(f.lic, ahora)).reverse();
  const lista = pestana === 'abiertas' ? abiertas : cerradas;

  return (
    <div className="bp-pagina">
      <header className="bm-cabecera">
        <div>
          <h1 className="bm-titulo">Compras en grupo</h1>
          <p className="bm-bajada">Cuando unos negocios piden algo de tu lista, compites solo con tus precios. Al cerrar gana el mejor precio para el grupo.</p>
        </div>
      </header>
      <Pestanas etiqueta="Compras en grupo" activa={pestana} onCambio={setPestana}
        pestanas={[['abiertas', 'Abiertas', abiertas.length], ['cerradas', 'Cerradas', cerradas.length]]} />
      {!lista.length ? (
        <p className="bp-nada">
          {pestana === 'abiertas'
            ? 'Todavía no compites en ninguna. Agrega productos a tu lista en Productos: cuando alguien pida uno, entras solo.'
            : 'Aquí quedan las compras que ganaste o perdiste.'}
        </p>
      ) : (
        <ul className="bm-tarjeta bp-filas">
          {lista.map(f => <FilaCompra key={`${f.lic.id}-${f.p.id}`} {...props} fila={f} ahora={ahora} />)}
        </ul>
      )}
    </div>
  );
}

function FilaCompra({ api, token, alCambiar, fila: { lic, p, mia }, ahora }: PropsAccion & { fila: Fila; ahora: number }) {
  const [mejorando, setMejorando] = useState(false);
  const unidades = p.totalUnidades ?? 0;
  const suya = precioDeOferta(mia, unidades);
  const mejor = Math.min(...(p.ofertas ?? []).map(o => precioDeOferta(o, unidades)));
  const abierta = estaAbierta(lic, ahora);
  const gano = p.ganadora?.proveedorId === mia.proveedorId;
  const locales = lic.participantes.filter(x => x.cantidad > 0).length;
  const estado = abierta
    ? (suya <= mejor ? { texto: 'Vas ganando', tono: 'listo' } : { texto: `Te ganan por ${dinero(suya - mejor)}`, tono: 'accion' })
    : gano ? { texto: 'Ganaste', tono: 'listo' } : { texto: p.ganadora ? `Ganó otro a ${dinero(p.ganadora.precioUnitario)}` : 'Cerró sin ganador', tono: 'neutro' };

  return (
    <FilaProducto nombre={p.nombre}
      acciones={<>
        <span className={`bp-estado ${estado.tono}`}>{estado.texto}</span>
        {abierta && !mejorando && <button type="button" className="bm-boton secundario" onClick={() => setMejorando(true)}>Mejorar mi oferta</button>}
      </>}
      debajo={mejorando && <MejorarOferta api={api} token={token} lic={lic} p={p} mia={mia} onListo={() => { setMejorando(false); alCambiar(); }} onCancelar={() => setMejorando(false)} />}>
        <span>
          {contar(locales, 'local', 'locales')} · {contar(unidades, p.unidad, p.unidadPlural)}
          {abierta ? ` · cierra en ${cuentaRegresiva(Date.parse(lic.cierraEn) - ahora)}` : ''}
        </span>
        <span>Tu precio a este volumen: <strong>{dinero(suya)}</strong>{mia.automatica ? ' (desde tu lista)' : ''}</span>
    </FilaProducto>
  );
}

function MejorarOferta({ api, token, lic, p, mia, onListo, onCancelar }: Pick<PropsAccion, 'api' | 'token'> & {
  lic: LicitacionCanal; p: ProductoCompra; mia: Oferta; onListo: () => void; onCancelar: () => void;
}) {
  const t = useTramos(aFilas(mia.tramos?.length ? mia.tramos : [{ desde: 1, precioUnitario: mia.precioUnitario }]));
  const { enviando, error, enviar } = useEnvio();
  const problema = errorDeTramos(aTramos(t.filas));
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    if (problema) return;
    void enviar(async () => { await api.ofertar(token, lic.id, p.id, aTramos(t.filas)); onListo(); }, 'No pudimos guardar tu oferta. Inténtalo de nuevo.');
  };
  return (
    <form className="bp-fila-confirmar bp-mejorar" onSubmit={guardar}>
      <TablaTramos t={t} unidad={p.unidad} unidades={p.unidadPlural} />
      {(problema || error) && <p className="bm-error bp-margen" role="alert">{error || `${problema}.`}</p>}
      <div className="bp-acciones">
        <button className="bm-boton" disabled={enviando || !!problema}>{enviando ? 'Guardando...' : 'Guardar mi oferta'}</button>
        <AccionesTramos t={t} />
        <button type="button" className="bm-boton-texto" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
