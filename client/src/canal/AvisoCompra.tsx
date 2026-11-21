// Banner "Compra conjunta abierta cerca de ti" de /app: el mismo aviso que llega por WhatsApp, en vivo (la foto de la red
// se vuelve a pedir con cada `red:evento`). Se ve fuera de la pestaña de la compra mientras el negocio no está dentro.

import { resumenCompraAbierta, TITULO_COMPRA_CERCA } from '../../../shared/avisos.ts';
import { estaAbierta, precioDelGrupo } from './logica.ts';
import { resumenGrupo } from './Carrito.tsx';
import { Icono } from './iconos.tsx';
import { useGuardado } from './useCanal.ts';
import type { LicitacionCanal } from './tipos.ts';

export function AvisoCompraAbierta({ lic, participa, irACompra }: { lic: LicitacionCanal | undefined; participa: boolean; irACompra: () => void }) {
  // Cerrarlo vale solo para esta compra: la próxima vuelve a avisar.
  const [cerrado, cerrar] = useGuardado('bando.app.aviso-cerrado', 'local');
  if (!lic || participa || !estaAbierta(lic, Date.now()) || cerrado === `${lic.id}@${lic.cierraEn}`) return null;
  const { precio } = precioDelGrupo(lic);
  const producto = lic.productos?.[0]?.nombre ?? lic.producto;
  if (precio === undefined || !producto) return null;
  return (
    <aside className="cn-aviso-compra" role="status">
      <Icono nombre="grupo" />
      <div>
        <strong>{TITULO_COMPRA_CERCA}</strong>
        <p>{resumenCompraAbierta({ producto, precio, negocios: resumenGrupo(lic).negocios })}.</p>
        <button type="button" className="boton" onClick={irACompra}>Sumarme</button>
      </div>
      <button type="button" className="cn-aviso-cerrar" aria-label="Cerrar aviso" onClick={() => cerrar(`${lic.id}@${lic.cierraEn}`)}>×</button>
    </aside>
  );
}
