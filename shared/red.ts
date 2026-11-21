// Contrato de la red que comparten el backend y las pantallas (docs/decisiones/20261121-1130-contrato-red.md):
// los nombres que viajan por HTTP y por `red:evento` de Socket.io.

export type Rol = 'comprador' | 'proveedor';

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
  | 'red.reiniciada'
  // Folios del SII del proveedor conectado: bajos, reponiéndose o repuestos (`AvisoFolios`, sin secretos).
  | 'sii.folios'
  // Llegaron proveedores y precios de referencia nuevos de Mercado Público (server/mercado-publico/).
  | 'mercado_publico.actualizado';
