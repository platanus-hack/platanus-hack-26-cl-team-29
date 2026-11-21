# Bando: la red de compras de negocios y empresas

Un almacén, una panadería o un restaurante pierde horas cada mes en el SII: emitir facturas, revisar las que recibe, reclamar antes de 8 días y declarar a tiempo. Si se equivoca, paga: de 10% a 30% de multa por declarar tarde y de 50% a 500% del monto si no factura, con riesgo de clausura (Código Tributario, art. 97). Además compra solo, caro y a ciegas. Bando junta a esos negocios en una red que compra mejor que cualquiera de ellos por separado y hace el trabajo del SII por ellos, desde WhatsApp.

## Cómo funciona

1. **La sala compra junta.** Los negocios se suman a un mismo pedido escribiendo por WhatsApp ("Almacén Rosita, 4 cajas") o desde la web. Cada negocio que entra baja el precio para todos, por tramos de volumen, y a todos les llega el aviso: "Bajó a $25.900 por caja".
2. **Los proveedores compiten.** Proveedores, personas y agentes de IA, ofertan en vivo por el pedido del grupo. Gana el mejor precio ajustado por reputación, no solo el más barato.
3. **Todo nativo del SII.** Cuando el proveedor responde "sí, factura todo", las facturas se emiten en el SII en un solo envío, con la orden de compra como referencia. A cada comprador le llega su folio y cuánto ahorró.
4. **Reclamos que valen.** Si faltó algo, el comprador lo dice por WhatsApp y Bando registra el reclamo en el SII. El proveedor responde con una nota de crédito en un sí. Su nota baja con el reclamo y se recupera si corrige rápido, para toda la red: no son reseñas, son documentos tributarios que nadie puede inventar.

## Por qué es multiplayer

Bando no sirve igual con una persona. Cada negocio que se suma baja el precio de los demás, cada oferta de un proveedor obliga a los otros a responder y cada reclamo cambia lo que ven todos los compradores. Lo que hace uno cambia lo que ve y puede hacer el otro, en vivo.

## Canales paralelos

WhatsApp y la web hacen lo mismo. Todo lo que se puede hacer escribiendo también se puede hacer en `/app` (comprador) y `/proveedor` (panel del proveedor). Toda acción con efecto legal en el SII (emitir, reclamar, nota de crédito) requiere una confirmación explícita de la persona en cualquiera de los dos canales.

## Para probarlo

- `/sala`: la pantalla de la demo, con el QR para sumarse.
- `/app`: comprador por la web.
- `/proveedor`: panel del proveedor.
- `/red`: la red en vivo, con el ciclo de compra y la reputación de los proveedores.
- `/unirse`: sumarse a la compra conjunta desde el celular.

## Tecnología

- Monolito en TypeScript: Node 24 con Express y Socket.io, React 19 con Vite, y Postgres en Render.
- Módulo SII propio y open source: firma XML, timbre electrónico, factura (33), guía de despacho (52), nota de crédito (61), envío, consulta de estado y aceptación o reclamo del receptor.
- Agente de WhatsApp sobre Kapso, que interpreta mensajes con Claude y tiene reglas de respaldo. Nunca ejecuta una acción legal sin un sí.

## Transparencia

- Todo opera contra el **ambiente de certificación del SII**: los documentos son reales en su formato y flujo, pero no tienen validez tributaria. El código no incluye hosts de producción.
- Los negocios de la demo y los proveedores rivales son ficticios.
- El módulo SII se escribió a partir de la documentación pública del SII y de experiencia previa del equipo en facturación electrónica.
