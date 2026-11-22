# Vender exige poder facturar en el SII

Fecha: 2026-11-22 02:38
Autor: Luciano (con agente)

## Contexto
Un proveedor real se registró por WhatsApp con un RUT sin "Verificación de Actividades": el SII (también en
certificación, maullin) le negó folios de factura. Aun así quedaba vendiendo con "facturas simuladas", así que podía
ganar una compra que no podía facturar y el comprador quedaba sin factura real. Eso rompe la promesa central: todo
queda en el SII. Además el mensaje mostraba una ruta interna del portal (`tope_33/of_solicita_folios_dcto`).

## Decisión
- **Ofrecer sí, ganar no.** Un proveedor que se registró para vender (`vende`) puede crear productos, ofertar y ver la
  demanda siempre; solo compite y gana si hoy puede emitir facturas reales: su SII conectado con certificado,
  resolución y folios (`PuertoSii.puedeFacturar`, en el SII conmutable). Una sola función en el dominio,
  `puedeFacturar(proveedorId)`.
- Sus ofertas y productos quedan marcados `pendienteSii` / `creadorPendienteSii`: se ven, pero no bajan el precio del
  grupo, no cuentan para "cerrar antes" y no entran al cierre (`ofertasQueCompiten` en `shared/precios.ts`, la misma
  regla para la vista, el cierre y las pantallas). Al cerrar se vuelve a revisar: quien conectó su SII después de
  ofertar compite.
- Los proveedores de la semilla de la demo (rivales ficticios y el proveedor fijo de la compra) no se tocan: siguen
  facturando con el SII de la demo o el falso. `DEMO_PROVEEDOR_SIN_CERTIFICADO=1` sigue siendo la prueba explícita de
  vender sin certificado.
- **Rechazos explicados.** `shared/sii-rechazos.ts` traduce los rechazos conocidos del portal (falta de verificación
  de actividad, empresa no autorizada en este ambiente) a qué pasa y qué hacer, para WhatsApp y el panel. El texto
  completo del SII sigue en el paso de la conexión y en el log.
- En `/proveedor`, un aviso con el logo del SII explica que sus ofertas no compiten y deja conectar desde ahí. Por
  WhatsApp, una oferta sin SII responde que quedó anotada pero no compite todavía.

## Consecuencias
- Ningún proveedor real gana una compra que no puede facturar, y nunca se le factura simulado.
- La marca `pendienteSii` de una oferta se actualiza al ofertar, crear un producto y cerrar; si el proveedor conecta su
  SII sin volver a ofertar, la pantalla puede mostrar la marca anterior hasta el cierre, que es lo que decide.

## Actualización (2026-11-22 02:58)
La marca "pendiente del SII" ya no espera al cierre: `red.revisarFacturacion()` vuelve a revisar las compras abiertas
cuando un proveedor termina de conectar su SII por WhatsApp y cada vez que llegan folios (`sii.folios`). Por cada
oferta o producto que pasa a competir (o deja de hacerlo) emite `licitacion.producto` con `cambio: 'facturacion'` y
`compite`, y `licitacion.precio_bajo` si el precio del grupo bajó.
