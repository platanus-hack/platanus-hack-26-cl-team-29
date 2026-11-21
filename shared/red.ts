// Contrato de la red que comparten el backend y las pantallas (docs/decisiones/20261121-1130-contrato-red.md):
// los nombres que viajan por HTTP y por `red:evento` de Socket.io.

export type Rol = 'comprador' | 'proveedor';

/**
 * Un negocio tiene un rol principal (`rol`, el que dibujan las pantallas) y, si se registró como proveedor por
 * WhatsApp, `vende`: puede vender y también comprar, pero nunca a sí mismo.
 */
interface ConRol {
  rol: Rol;
  vende?: boolean;
}

/** Puede ofertar y recibir órdenes: un proveedor o un negocio registrado como proveedor. */
export const puedeVender = (n: ConRol): boolean => n.rol === 'proveedor' || n.vende === true;

/** Puede sumarse a una compra: un comprador o un proveedor registrado por WhatsApp. Los proveedores ficticios no compran. */
export const puedeComprar = (n: ConRol): boolean => n.rol === 'comprador' || n.vende === true;

export type EstadoOrden = 'enviada' | 'confirmada' | 'facturada' | 'recibida' | 'reclamada' | 'corregida';

/** Tipos de `red:evento`. Toda acción que cambia datos emite uno. */
export type TipoEventoRed =
  | 'orden.creada'
  | 'orden.confirmada'
  | 'documento.emitido'
  | 'documento.actualizado'
  | 'recepcion.registrada'
  | 'reclamo.registrado'
  | 'nota_credito.emitida'
  | 'nota.cambiada'
  | 'licitacion.participante'
  | 'licitacion.oferta'
  | 'licitacion.cerrada'
  | 'licitacion.precio_bajo'
  | 'licitacion.facturada'
  // Un proveedor sumó un producto a la canasta de la compra conjunta.
  | 'licitacion.producto'
  // Un negocio nuevo, o uno que ahora también vende (registro de proveedor por WhatsApp).
  | 'negocio.registrado'
  | 'red.reiniciada'
  // Folios del SII del proveedor conectado: bajos, reponiéndose o repuestos (`AvisoFolios`, sin secretos).
  | 'sii.folios'
  // Llegaron proveedores y precios de referencia nuevos de Mercado Público (server/mercado-publico/).
  | 'mercado_publico.actualizado'
  // Se avisó por WhatsApp a los compradores registrados que abrió una compra conjunta: `{ licitacionId, negocios }` (solo el conteo).
  | 'avisos.enviados'
  // Llegaron giros del SII o clasificaciones de proveedores al buscador (server/proveedores/).
  | 'proveedores.actualizado'
  // Un negocio se sumó con la invitación de otro: `{ licitacionId, invita, invitado, invitaId?, invitadoId? }` (solo nombres e ids de negocio).
  | 'invitacion.sumada'
  // El catálogo de un proveedor, armado desde sus facturas, empezó a armarse o quedó listo: `{ proveedorId, estado }` (sin productos ni precios).
  | 'catalogo.actualizado'
  // Crédito Bando (server/pagos/): factura emitida → Bando le pagó al proveedor y el comprador paga a plazo.
  // `{ negocioId, proveedorId, ordenId, monto, plazoDias, venceEn }` (monto con IVA; nunca RUT ni datos de la tarjeta).
  | 'credito.otorgado'
  // Se cobró (o falló el cobro de) un crédito en la tarjeta inscrita: lo mismo más `{ ok, estado }`.
  | 'credito.cobrado'
  // Un comprador inscribió su tarjeta en Transbank: `{}` (sin datos de la tarjeta ni del negocio).
  | 'tarjeta.inscrita';
