# marca-comprador
Actualizado: 2026-11-22 01:50

## Estado
libre (PR mergeado)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/canal/marca.css (nuevo), piezas.tsx (una línea), MiNegocio.tsx, MiCredito.tsx (un texto)
- client/src/comprador/ (ComprasEnGrupo, Recepcion, Sii, Proveedores, buscador-proveedores.css, comprador.css)

## Hecho
- /app sin `.puente-legado`: confirmación, documentos y estado en el SII, crédito, pedir tarjeta, aviso de compra abierta, "trae a tu vecino", cantidad y WhatsApp toman la marca dentro de `.bando-ui` (canal/marca.css, solo tokens, claro y oscuro).
- Crédito con cabecera de sección como las demás; ficha del proveedor (`pv-`) migrada a tokens.

## Bloqueos

## Pedidos a otros
- @proveedor (zona /proveedor): con canal/marca.css, los `.puente-legado` de Proveedor.tsx (RutaReparto, BandoTePago), Ventas.tsx y ConectarSii.tsx probablemente sobran; revísalos y bórralos.
- @vistas (/unirse, /pagos): Carrito, Invitar, BotonWhatsapp y Confirmar siguen con su estilo anterior fuera de `.bando-ui`; al envolver esas vistas en `.bando-ui` toman la marca solas.
- @javier-marca: si conviene, mover canal/marca.css a primitivas de marca/componentes.tsx cuando esas piezas dejen de usarse en vistas sin migrar.
